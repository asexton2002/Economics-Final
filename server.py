#!/usr/bin/env python3
"""Economics Showdown: classroom game with rotating contestants and audience votes."""
from __future__ import annotations
import json
import io
import qrcode
import math
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, urlencode

ROOT = Path(__file__).resolve().parent
HOST = '0.0.0.0'
PORT = int(os.environ.get('PORT', '8000'))
LOCK = threading.RLock()
ROOMS = {}
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
MAX_BODY_BYTES = 32_000
MAX_CONTESTANTS = 12
ANSWER_SECONDS = 90
VOTING_SECONDS = 20


def sample_questions():
    with (ROOT / 'questions.json').open('r', encoding='utf-8') as f:
        return json.load(f)


class GameError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def err(message, status=400):
    raise GameError(message, status)


def rand_token():
    return secrets.token_urlsafe(24)


def room_id():
    for _ in range(100):
        code = ''.join(secrets.choice(ALPHABET) for _ in range(5))
        if code not in ROOMS:
            return code
    err('Could not create a room, please try again.', 500)


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))
            return s.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return 'YOUR-LAPTOP-IP'


def check_text(value, maxlen, field):
    if not isinstance(value, str):
        err(f'{field} must be text.')
    value = value.strip()
    if not value or len(value) > maxlen:
        err(f'{field} must be 1–{maxlen} characters.')
    return value


def validate_questions(questions):
    if not isinstance(questions, list) or not 1 <= len(questions) <= 30:
        err('Add between 1 and 30 questions.')
    clean = []
    for q in questions:
        if not isinstance(q, dict):
            err('Each question needs a prompt and host note.')
        prompt = check_text(q.get('prompt'), 500, 'Question')
        note = q.get('note', '')
        if not isinstance(note, str) or len(note) > 900:
            err('Host notes may be up to 900 characters.')
        topic = q.get('topic', 'Economics')
        if not isinstance(topic, str) or len(topic) > 45:
            err('Topic may be up to 45 characters.')
        clean.append({'prompt': prompt, 'note': note.strip(), 'topic': topic.strip() or 'Economics'})
    return clean


def room_and_actor(data):
    code = str(data.get('room', '')).strip().upper()
    room = ROOMS.get(code)
    if not room:
        err('Room not found. Double-check the room code.', 404)
    token = data.get('token')
    if not isinstance(token, str):
        err('Please join the room first.', 403)
    if token == room['host_token']:
        return room, 'host', None
    for contestant in room['contestants']:
        if contestant['token'] == token:
            return room, 'contestant', contestant
    if token in room['audience']:
        return room, 'audience', None
    err('Your session is no longer valid. Join the room again.', 403)


def require_host(role):
    if role != 'host':
        err('Only the host can do that.', 403)


def bump(room):
    room['version'] += 1


def contestant_by_id(room, player_id):
    return next((c for c in room['contestants'] if c['id'] == player_id), None)


def current_seat(room, contestant):
    if contestant is None:
        return None
    return next((seat for seat in ('A', 'B') if room['active'].get(seat) == contestant['id']), None)


def make_schedule(contestants, rounds):
    """Balance appearances and favor new pairings, especially early in the game."""
    ids = [p['id'] for p in contestants]
    turns = {player_id: 0 for player_id in ids}
    match_counts = {}
    last_played = {player_id: -100 for player_id in ids}
    schedule = []
    for idx in range(rounds):
        candidates = []
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                key = tuple(sorted((a, b)))
                projected = {p: turns[p] + (p == a or p == b) for p in ids}
                # Fairness first: minimize the spread in total appearances.
                spread = max(projected.values()) - min(projected.values())
                repeat = match_counts.get(key, 0)
                recency = max(last_played[a], last_played[b])
                # Keep participants who haven't played yet in the first block of rounds.
                candidates.append(((spread, turns[a] + turns[b], repeat,
                                    recency, secrets.randbelow(1000000)), a, b, key))
        _, a, b, key = min(candidates, key=lambda entry: entry[0])
        if secrets.randbelow(2):
            a, b = b, a
        schedule.append({'A': a, 'B': b})
        turns[a] += 1
        turns[b] += 1
        last_played[a] = idx
        last_played[b] = idx
        match_counts[key] = match_counts.get(key, 0) + 1
    return schedule


def new_round(room):
    room['active'] = dict(room['schedule'][room['index']])
    room['answers'] = {'A': None, 'B': None}
    room['votes'] = {}
    room['round_result'] = None
    room['phase'] = 'answering'
    room['ends_at'] = time.time() + ANSWER_SECONDS
    bump(room)


def public_pair(room, pairing):
    return {seat: contestant_by_id(room, pairing[seat])['name'] for seat in ('A', 'B')}


def state_for(room, role, contestant, token):
    phase = room['phase']
    question = room['questions'][room['index']]
    seat = current_seat(room, contestant)
    players = {}
    for s in ('A', 'B'):
        player = contestant_by_id(room, room['active'][s]) if room['active'][s] else None
        players[s] = {
            'name': player['name'] if player else None,
            'score': player['score'] if player else 0,
            'submitted': room['answers'][s] is not None,
            'joined': player is not None,
        }
    ranked = sorted(room['contestants'], key=lambda p: (-p['score'], p['joined_order']))
    standings = []
    for p in ranked:
        standings.append({'id': p['id'], 'name': p['name'], 'score': p['score'],
                          'turns': p['turns'], 'is_me': contestant is not None and contestant['id'] == p['id'],
                          'active_seat': current_seat(room, p)})
    result = {
        'room': room['code'], 'version': room['version'], 'phase': phase,
        'server_time': time.time(), 'ends_at': room.get('ends_at'),
        'role': role, 'seat': seat,
        'name': 'Host' if role == 'host' else (contestant['name'] if contestant else room['audience'][token]['name']),
        'round': room['index'] + 1, 'rounds': len(room['questions']),
        'topic': question['topic'], 'prompt': question['prompt'],
        'players': players, 'contestants': standings,
        'contestant_count': len(room['contestants']), 'max_contestants': MAX_CONTESTANTS,
        'audience_count': len(room['audience']),
        'submitted_count': sum(v is not None for v in room['answers'].values()),
        'votes_cast': len(room['votes']), 'history': room['history'],
        'lan_url': f"http://{lan_ip()}:{PORT}/?room={room['code']}",
    }
    if role == 'host':
        result['questions'] = room['questions']
        result['host_note'] = question['note'] if phase in ('grading', 'results', 'ended') else ''
    if role == 'contestant':
        result['own_answer'] = room['answers'][seat] if seat else None
    if role == 'audience' or (role == 'contestant' and not seat):
        result['my_vote'] = room['votes'].get(token)
    if phase in ('voting', 'grading', 'results', 'ended'):
        result['answers'] = room['answers']
    if phase in ('grading', 'results', 'ended'):
        counts = {s: sum(1 for value in room['votes'].values() if value == s) for s in ('A','B')}
        total = len(room['votes'])
        result['vote_counts'] = counts
        result['vote_percent'] = {s: round(counts[s] * 100 / total) if total else 0 for s in ('A','B')}
    if phase in ('results', 'ended'):
        result['round_result'] = room['round_result']
    if phase == 'results' and room['index'] + 1 < len(room['schedule']):
        result['next_pair'] = public_pair(room, room['schedule'][room['index']+1])
    return result


def route(data, action):
    with LOCK:
        if action == 'create':
            code = room_id()
            token = rand_token()
            room = {'code': code, 'host_token': token, 'phase': 'lobby', 'index': 0,
                    'questions': validate_questions(sample_questions()),
                    'contestants': [], 'audience': {}, 'schedule': [], 'active': {'A': None, 'B': None},
                    'answers': {'A': None, 'B': None}, 'votes': {},
                    'round_result': None, 'history': [], 'version': 1, 'created': time.time(), 'ends_at': None}
            ROOMS[code] = room
            return {'room': code, 'token': token, 'role': 'host'}
        if action == 'join':
            code = str(data.get('room', '')).strip().upper()
            room = ROOMS.get(code)
            if not room:
                err('No game found with that code.', 404)
            role = data.get('role')
            if role not in ('audience', 'contestant'):
                err('Choose Contestant or Audience.')
            name = check_text(data.get('name'), 28, 'Name')
            token = rand_token()
            if role == 'audience':
                room['audience'][token] = {'name': name}
            else:
                if room['phase'] != 'lobby':
                    err('The game has already started. You can still join as audience.')
                if len(room['contestants']) >= MAX_CONTESTANTS:
                    err(f'All {MAX_CONTESTANTS} contestant spots are filled. Join as audience.')
                if any(p['name'].casefold() == name.casefold() for p in room['contestants']):
                    err('That contestant nickname is already taken. Pick another one.')
                room['contestants'].append({'id': secrets.token_hex(8), 'name': name,
                                            'token': token, 'score': 0, 'turns': 0,
                                            'joined_order': len(room['contestants'])})
            bump(room)
            return {'room': code, 'token': token, 'role': role}
        room, role, contestant = room_and_actor(data)
        seat = current_seat(room, contestant)
        if room['phase'] == 'voting' and room.get('ends_at') and time.time() >= room['ends_at']:
            room['phase'] = 'grading'
            room['ends_at'] = None
            bump(room)
        if action == 'state':
            return state_for(room, role, contestant, data['token'])
        if action == 'set_questions':
            require_host(role)
            if room['phase'] != 'lobby':
                err('Questions can only be edited before starting the game.')
            room['questions'] = validate_questions(data.get('questions'))
            room['index'] = 0
            bump(room)
        elif action == 'save_default_questions':
            require_host(role)
            if room['phase'] != 'lobby':
                err('Edit default questions only before starting.')
            content = validate_questions(data.get('questions'))
            tmp = ROOT / 'questions.json.tmp'
            try:
                tmp.write_text(json.dumps(content, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
                os.replace(tmp, ROOT / 'questions.json')
            except OSError:
                err('Could not save question defaults on this server. Check write access.', 500)
            room['questions'] = content
            room['index'] = 0
            bump(room)
        elif action == 'remove_contestant':
            require_host(role)
            if room['phase'] != 'lobby':
                err('You can only remove contestants from the lobby.')
            target = data.get('player_id')
            before = len(room['contestants'])
            room['contestants'] = [p for p in room['contestants'] if p['id'] != target]
            if len(room['contestants']) == before:
                err('Contestant not found.')
            bump(room)
        elif action == 'start':
            require_host(role)
            if room['phase'] != 'lobby':
                err('The game has already started.')
            n = len(room['contestants'])
            if n < 2:
                err('At least two contestants need to join before starting.')
            if len(room['questions']) * 2 < n:
                err(f'Add at least {math.ceil(n/2)} questions so every contestant gets a turn.')
            for player in room['contestants']:
                player['score'] = 0
                player['turns'] = 0
            room['schedule'] = make_schedule(room['contestants'], len(room['questions']))
            new_round(room)
        elif action == 'answer':
            if role != 'contestant' or not seat:
                err('Only the two contestants playing this round can answer.', 403)
            if room['phase'] != 'answering' or time.time() >= room['ends_at']:
                err('The 90-second answer window is closed.')
            if room['answers'][seat] is not None:
                err('Your answer is already submitted.')
            room['answers'][seat] = check_text(data.get('answer'), 280, 'Answer')
            bump(room)
        elif action in ('reveal', 'force_reveal'):
            require_host(role)
            if room['phase'] != 'answering':
                err('Answers are not being collected.')
            if action == 'reveal' and not all(v is not None for v in room['answers'].values()) and time.time() < room['ends_at']:
                err('Wait for both answers or the 90-second timer. Use host override if needed.')
            room['phase'] = 'voting'
            room['ends_at'] = time.time() + VOTING_SECONDS
            bump(room)
        elif action == 'vote':
            if role not in ('audience', 'contestant') or (role == 'contestant' and seat):
                err('The two answering contestants cannot vote this round.', 403)
            if room['phase'] != 'voting' or time.time() >= room['ends_at']:
                err('Voting is closed.')
            if data['token'] in room['votes']:
                err('You have already voted in this round.')
            choice = data.get('choice')
            if choice not in ('A','B'):
                err('Choose Answer A or Answer B.')
            room['votes'][data['token']] = choice
            bump(room)
        elif action == 'close':
            require_host(role)
            if room['phase'] != 'voting':
                err('Voting is not open.')
            room['phase'] = 'grading'
            room['ends_at'] = None
            bump(room)
        elif action == 'publish':
            require_host(role)
            if room['phase'] != 'grading':
                err('Close voting before assigning scores.')
            grades = data.get('grades')
            if not isinstance(grades, dict) or any(type(grades.get(s)) is not int or grades[s] not in (0,250,500) for s in ('A','B')):
                err('Grade both answers: 0, 250, or 500 points.')
            counts = {s: sum(1 for v in room['votes'].values() if v == s) for s in ('A','B')}
            total = len(room['votes'])
            scores = {}
            for s in ('A','B'):
                player = contestant_by_id(room, room['active'][s])
                vote_score = 100 * counts[s]
                total_round = vote_score + grades[s]
                player['score'] += total_round
                player['turns'] += 1
                scores[s] = {'name': player['name'], 'votes': counts[s],
                             'percent': round(100*counts[s]/total) if total else 0,
                             'vote_points': vote_score, 'accuracy_points': grades[s],
                             'round_total': total_round, 'total': player['score']}
            room['round_result'] = scores
            room['history'].append({'round': room['index'] + 1,
                                    'prompt': room['questions'][room['index']]['prompt'], 'score': scores})
            room['phase'] = 'results'
            room['ends_at'] = None
            bump(room)
        elif action == 'skip_round':
            require_host(role)
            if room['phase'] not in ('answering', 'voting', 'grading'):
                err('Only an unfinished round may be skipped.')
            room['round_result'] = {}
            for key in ('A', 'B'):
                player = contestant_by_id(room, room['active'][key])
                player['turns'] += 1
                room['round_result'][key] = {'name': player['name'], 'votes': 0, 'percent': 0, 'vote_points': 0, 'accuracy_points': 0, 'round_total': 0, 'total': player['score']}
            room['history'].append({'round': room['index'] + 1, 'prompt': room['questions'][room['index']]['prompt'] + ' (skipped)', 'score': room['round_result']})
            room['phase'] = 'results'
            room['ends_at'] = None
            bump(room)
        elif action == 'next':
            require_host(role)
            if room['phase'] != 'results':
                err('Publish results before advancing.')
            if room['index'] + 1 >= len(room['questions']):
                room['phase'] = 'ended'
                bump(room)
            else:
                room['index'] += 1
                new_round(room)
        elif action == 'reset':
            require_host(role)
            if room['phase'] not in ('lobby', 'results', 'ended'):
                err('Finish the round before restarting the game.')
            room['phase'] = 'lobby'
            room['ends_at'] = None
            room['index'] = 0
            room['active'] = {'A': None, 'B': None}
            room['schedule'] = []
            room['answers'] = {'A': None, 'B': None}
            room['votes'] = {}
            room['round_result'] = None
            room['history'] = []
            for player in room['contestants']:
                player['score'] = 0
                player['turns'] = 0
            bump(room)
        else:
            err('Unknown action.', 404)
        return state_for(room, role, contestant, data['token'])


class Handler(BaseHTTPRequestHandler):
    server_version = 'EconomicsShowdown/2.0'

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == '/qr':
            from urllib.parse import parse_qs
            code = parse_qs(parsed.query).get('room', [''])[0].strip().upper()
            if len(code) != 5 or any(c not in ALPHABET for c in code):
                self.send_error(400, 'Invalid room code')
                return
            # Generate a per-room join QR from this request's public address.
            host = self.headers.get('Host', '').strip()
            if not host or any(c in host for c in '/\\?#@ '):
                self.send_error(400, 'Invalid host')
                return
            forwarded_scheme = self.headers.get('X-Forwarded-Proto', '').split(',')[0].strip().lower()
            scheme = forwarded_scheme if forwarded_scheme in ('http', 'https') else 'http'
            invite_url = f'{scheme}://{host}/?' + urlencode({'room': code})
            qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=3)
            qr.add_data(invite_url)
            qr.make(fit=True)
            output = io.BytesIO()
            qr.make_image(fill_color='black', back_color='white').save(output, format='PNG')
            content = output.getvalue()
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(content)
            return
        if path in ('/', '/index.html'):
            file = ROOT / 'index.html'
            mime = 'text/html; charset=utf-8'
        elif path == '/assets/app.js':
            file = ROOT / 'assets' / 'app.js'
            mime = 'application/javascript; charset=utf-8'
        elif path == '/assets/styles.css':
            file = ROOT / 'assets' / 'styles.css'
            mime = 'text/css; charset=utf-8'
        elif path == '/assets/icon.svg':
            file = ROOT / 'assets' / 'icon.svg'
            mime = 'image/svg+xml'
        else:
            self.send_error(404)
            return
        try:
            content = file.read_bytes()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith('/api/'):
            self._json({'error': 'Not found'}, 404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BODY_BYTES:
                err('Request size is not valid.', 413)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                err('Request must be a JSON object.')
            result = route(data, path.removeprefix('/api/'))
            self._json(result)
        except GameError as e:
            self._json({'error': str(e)}, e.status)
        except (ValueError, json.JSONDecodeError):
            self._json({'error': 'Invalid request.'}, 400)
        except Exception as e:
            print('Internal error:', repr(e), flush=True)
            self._json({'error': 'Server error. Please try again.'}, 500)

    def _json(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(payload)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        if not self.path.startswith('/api/state'):
            print('%s - %s' % (self.address_string(),fmt%args), flush=True)


if __name__ == '__main__':
    print('\n' + '=' * 56)
    print(' ECONOMICS SHOWDOWN — ROTATING CONTESTANTS EDITION')
    print('=' * 56)
    print(f' Host opens:      http://localhost:{PORT}')
    print(f' Other devices:   http://{lan_ip()}:{PORT}')
    print(' Make sure everyone is on the same Wi-Fi / hotspot.')
    print(' Stop server: Ctrl+C')
    print('=' * 56 + '\n', flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
