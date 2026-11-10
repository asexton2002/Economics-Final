'use strict';
(() => {
  const app = document.querySelector('#app');
  const toastNode = document.querySelector('#toast');
  const KEY = 'economics-showdown-session-v2';
  let session = null;
  let atHome = false;
  let state = null;
  let polling = false;
  let busy = false;
  let editing = false;
  let editorDraft = [];
  let answerDraft = '';
  let grades = { A: null, B: null };
  let toastTimer;
  let serverOffsetMs = 0;
  const qs = new URLSearchParams(location.search).get('room') || '';

  try { session = JSON.parse(localStorage.getItem(KEY)); } catch { session = null; }
  function h(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])); }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function setSession(v) { session = v; if(v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); }
  function toast(message, error = false) {
    toastNode.textContent = message;
    toastNode.className = `show${error ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastNode.className = ''; }, 3300);
  }
  async function api(action, payload = {}, withSession = true) {
    const data = withSession && session ? {room:session.room, token:session.token, ...payload} : payload;
    let response;
    try { response = await fetch(`/api/${action}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
    catch { throw new Error('Cannot reach the game server. Check Wi-Fi and try again.'); }
    let result;
    try { result = await response.json(); } catch { throw new Error('The server returned an unexpected response.'); }
    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }
  function isDraftFocused() { const el = document.activeElement; return el && (el.id === 'answerDraft' || el.classList.contains('edit-field')); }
  async function refresh() {
    if (!session || polling || atHome) return;
    polling = true;
    try {
      const incoming = await api('state');
      const changed = !state || incoming.version !== state.version || incoming.role !== state.role;
      const phaseChanged = state && (incoming.phase !== state.phase || incoming.round !== state.round);
      if (state && (incoming.round !== state.round || incoming.phase === 'lobby' && state.phase !== 'lobby')) {
        answerDraft = '';
        grades = {A:null,B:null};
      }
      serverOffsetMs = incoming.server_time * 1000 - Date.now();
      state = incoming;
      if (changed && (!isDraftFocused() || phaseChanged)) render();
    } catch (e) {
      if (/session is no longer valid|join the room first|room not found/i.test(e.message)) {
        setSession(null); state = null; editing = false; render(); toast('Your session ended. Rejoin the room.', true);
      }
      // Temporary network disconnects can recover on the next poll.
    } finally { polling = false; }
  }
  async function command(action, payload = {}, options = {}) {
    if (busy) return;
    busy = true;
    try {
      const result = await api(action, payload, !['create','join'].includes(action));
      if (action === 'create' || action === 'join') {
        setSession({room:result.room, token:result.token, role:result.role});
        answerDraft = ''; grades = {A:null,B:null}; editing = false; atHome = false; state = null;
        await refresh();
      } else {
        if (action === 'next' || action === 'start') { answerDraft = ''; grades = {A:null,B:null}; }
        if (action === 'set_questions' || action === 'save_default_questions') editing = false;
        if (result && result.phase) { serverOffsetMs = result.server_time * 1000 - Date.now(); state = result; render(); }
      }
      if (options.success) toast(options.success);
    } catch (e) { toast(e.message, true); }
    finally { busy = false; }
  }
  const brand = `<span class="brand-mark" aria-hidden="true">ϟ</span><span class="brand-long">ECONOMICS </span>SHOWDOWN`;
  function topbar(s) {
    if (!s) return `<header class="topbar"><div class="brand">${brand}</div><div class="topright"><span class="tag">ROTATING PLAYERS EDITION</span></div></header>`;
    const label = s.role === 'host' ? '🎙 HOST' : s.role === 'audience' ? '🗳 AUDIENCE' : s.seat ? `🎮 NOW PLAYING ${s.seat}` : '🎮 CONTESTANT';
    return `<header class="topbar"><div class="brand">${brand}</div><div class="topright"><span class="tag">ROOM <span class="room-badge">${h(s.room)}</span></span><span class="tag">${label}</span>${s.role === 'host' ? '<button class="link-button" data-action="go-home">← Back to Home</button>' : ''}<button class="link-button" data-action="leave">Leave this device</button></div></header>`;
  }
  function intro() {
    const roomFromUrl = /^[A-Z0-9]{4,8}$/i.test(qs) ? qs.toUpperCase() : '';
    return `${topbar(null)}<main class="hero-grid"><section>
      <div class="eyebrow">THE CLASSROOM GAME SHOW</div>
      <h1 class="hero-title">THINK FAST.<br><span class="gradient">WIN VOTES.</span><br>KNOW ECON.</h1>
      <p class="hero-sub">Everyone joins first. Two contestants answer each question, the others vote, and new players rotate in every round.</p>
      <div class="hero-metrics"><div class="metric"><strong>2</strong>answer per round</div><div class="metric"><strong>12</strong>contestant spots</div><div class="metric"><strong>+500</strong>accuracy bonus</div></div>
    </section><section class="panel welcome-panel"><h2 class="panel-head">Ready to play?</h2><p class="subtle small">Host a new game or enter your classroom room code.</p>
      ${session && session.role === 'host' ? '<button class="btn btn-outline btn-full" data-action="resume-host">↩ Resume your hosted game</button>' : ''}<button class="btn btn-primary btn-full" data-action="create">⚡ Create a new game · Host</button>
      <div class="divider">OR JOIN AN EXISTING GAME</div>
      <form id="joinForm"><div class="form-row"><div><label for="roomInput">Room code</label><input id="roomInput" class="field" required maxlength="8" autocapitalize="characters" autocomplete="off" placeholder="ABCDE" value="${h(roomFromUrl)}"></div><div><label for="nameInput">Your name</label><input id="nameInput" class="field" required maxlength="28" placeholder="Your nickname" autocomplete="off"></div></div>
      <div class="form-group"><label>Join as</label><div class="role-chooser"><label class="role-choice"><input type="radio" name="role" value="contestant" checked>🎮 Contestant<br><span class="subtle small">Take turns answering and vote when waiting</span></label><label class="role-choice"><input type="radio" name="role" value="audience">🗳 Audience<br><span class="subtle small">Vote every round, no competing</span></label></div></div>
      <button class="btn btn-pink btn-full inner-space" type="submit">Join game →</button>
      </form><p class="footer-note">All contestants stay joined across rounds. No accounts needed.</p></section></main>`;
  }
  function timerBadge(s) {
    if (!['answering','voting'].includes(s.phase) || !s.ends_at) return '';
    const seconds = Math.max(0, Math.ceil((s.ends_at * 1000 - Date.now() - serverOffsetMs)/1000));
    return `<span class="tag timer-tag${seconds<=10?' timer-urgent':''}">⏱ <span data-countdown>${seconds}</span>s ${s.phase==='answering'?'TO ANSWER':'TO VOTE'}</span>`;
  }
  function updateCountdown() {
    if (!state || !state.ends_at || !['answering','voting'].includes(state.phase)) return;
    const seconds = Math.max(0, Math.ceil((state.ends_at*1000 - Date.now() - serverOffsetMs)/1000));
    document.querySelectorAll('[data-countdown]').forEach(el => {el.textContent=seconds;el.closest('.timer-tag')?.classList.toggle('timer-urgent',seconds<=10);});
    if (seconds === 0) {
      document.querySelectorAll('#answerDraft, #answerForm button[type=submit], [data-choice]').forEach(el=>el.disabled=true);
      const reveal = document.querySelector('[data-action=reveal]'); if (reveal) reveal.disabled=false;
    }
  }
  function phaseHead(s) {
    const names = {lobby:'WAITING ROOM',answering:'ANSWER TIME',voting:'AUDIENCE VOTING',grading:'HOST JUDGING',results:'ROUND RESULTS',ended:'GAME OVER'};
    return `<div class="game-kicker"><span class="tag is-live">● ${names[s.phase] || 'LIVE'}</span><span class="tag">ROUND ${s.round} / ${s.rounds}</span><span class="tag">${h(s.topic)}</span>${timerBadge(s)}</div>`;
  }
  function scoreboard(s) {
    if (!s.players.A.joined || !s.players.B.joined) return '';
    return `<div class="scoreboard" aria-label="This round's contestants">${seatScore(s,'A')}<div class="versus">VS</div>${seatScore(s,'B')}</div>`;
  }
  function seatScore(s, seat) {
    const p = s.players[seat];
    return `<div class="score-card ${seat.toLowerCase()}"><div><div class="seat">ANSWER ${seat} · THIS ROUND</div><div class="player-name">${s.anonymous_round ? '🔒 Identity hidden' : h(p.name || 'Waiting…')}</div></div><div class="score-value">${s.anonymous_round ? '—' : fmt(p.score)}</div></div>`;
  }
  function leaderboard(s) {
    if (s.anonymous_round) return '<section class="panel inner-space"><h2 class="section-head">🔒 Leaderboard paused for blind voting</h2><p class="subtle small">Player identities and scores will appear again once voting closes.</p></section>';
    return `<section class="panel inner-space"><div class="upper-actions"><h2 class="section-head">🏆 All-contestant leaderboard</h2><span class="tag">${s.contestant_count} CONTESTANTS</span></div>
      <div class="leaderboard-list">${s.contestants.map((p,i)=>`<div class="leader-row${p.active_seat ? ' currently-playing' : ''}${p.is_me ? ' is-me' : ''}"><span class="rank">#${i+1}</span><div class="leader-name"><strong>${h(p.name)}${p.is_me ? ' (you)' : ''}</strong><span class="subtle small">${p.active_seat ? 'Answering this round · '+p.active_seat : 'Waiting / voting'} · ${p.turns} turn${p.turns===1?'':'s'} played</span></div><strong class="leader-points">${fmt(p.score)}</strong></div>`).join('') || '<p class="subtle">Contestants will appear here when they join.</p>'}</div>
    </section>`;
  }
  function question(s) {
    return `<section class="question-panel"><div class="section-label">QUESTION ${s.round} · ${h(s.topic)}</div><div class="question-big">${h(s.prompt)}</div></section>`;
  }
  function invite(s) {
    const url = (['localhost','127.0.0.1'].includes(location.hostname)) ? s.lan_url : `${location.origin}/?room=${encodeURIComponent(s.room)}`;
    return `<div class="qr-wrap"><img src="/qr?room=${encodeURIComponent(s.room)}" width="188" height="188" alt="Scan to join room ${h(s.room)}" class="room-qr"><div><strong>SCAN TO JOIN</strong><p class="subtle small">Scan this QR code with a phone camera. Enter a nickname and join as a contestant. No app needed.</p></div></div><div class="invite"><input class="field" aria-label="Shareable classroom link" id="inviteURL" value="${h(url)}" readonly><button class="btn btn-secondary btn-sm" data-action="copy">Copy link</button></div><p class="subtle small">Players use this link or enter code <strong>${h(s.room)}</strong>. Once publicly hosted, phones can join from Wi-Fi or cellular data.</p>`;
  }
  function lobby(s) {
    const people = s.contestants.map(p => `<div class="seat-panel"><div><div class="p-name">🎮 ${h(p.name)} ${p.is_me ? '(you)' : ''}</div></div>${s.role === 'host' ? `<button data-action="remove-contestant" data-player-id="${h(p.id)}" class="btn btn-outline btn-sm">Remove</button>` : '<span class="tag">READY</span>'}</div>`).join('') || '<p class="subtle">Waiting for contestants to join…</p>';
    if (s.role !== 'host') {
      const me = s.role === 'audience' ? 'You joined the audience.' : `You're in, ${h(s.name)}!`;
      return `${phaseHead(s)}<section class="panel waiting"><div class="wait-icon">🎟️</div><span class="tag is-live">YOU'RE IN</span><h2>${me}</h2><p>${s.role === 'contestant' ? 'You will automatically be selected for rounds, and can vote on other rounds.' : 'You can vote on every question.'} Keep this page open.</p><div class="code-large">${h(s.room)}</div><p>${s.contestant_count} contestants ready · ${s.audience_count} audience members</p></section><section class="panel inner-space"><h2 class="section-head">Contestants joining</h2><div class="contestant-list">${people}</div></section>`;
    }
    const need = Math.ceil(s.contestant_count/2);
    const enoughQuestions = s.rounds >= need;
    return `${phaseHead(s)}<div class="game-title">Everyone joins. Everybody gets a turn.</div>
    <div class="layout-two"><section class="panel"><div class="section-label">INVITE THE CLASS</div><div class="code-large">${h(s.room)}</div>${invite(s)}
      <div class="status-grid"><div class="status-box"><strong>${fmt(s.contestant_count)}</strong><p>Contestants</p></div><div class="status-box"><strong>${fmt(s.audience_count)}</strong><p>Audience</p></div><div class="status-box"><strong>${fmt(s.rounds)}</strong><p>Questions</p></div></div>
      <p class="hint inner-space">Everyone who wants to compete selects <strong>Contestant</strong>. There are ${s.max_contestants} spots. Nonactive contestants vote like the audience.</p></section>
      <section class="panel"><div class="upper-actions"><div class="section-label">CONTESTANT ROSTER</div><span class="tag">${s.contestant_count} / ${s.max_contestants}</span></div><div class="contestant-list inner-space">${people}</div>
        <p class="subtle small">The game schedules two contestants for each question and balances turns automatically.</p>
        ${!enoughQuestions ? `<p class="hint">Add at least ${need} questions so everyone can answer once.</p>` : ''}
        <button data-action="start" class="btn btn-primary btn-full inner-space" ${s.contestant_count<2 || !enoughQuestions ? 'disabled' : ''}>▶ Start game · ${s.rounds} rounds</button>
      </section></div>
      <section class="panel inner-space"><div class="upper-actions"><div><h2 class="section-head">Your economics questions</h2><div class="subtle small">${s.rounds} ready-to-play prompts. Edit before starting.</div></div><button class="btn btn-outline btn-sm" data-action="toggle-edit">${editing ? 'Cancel editing' : '✎ Edit questions'}</button></div>
      ${editing ? editor() : `<div class="question-list">${s.questions.map((q,i)=>`<span class="question-chip">${i+1}. ${h(q.topic)}</span>`).join('')}</div><div class="hint">You can edit questions and private grading notes.</div>`}</section>`;
  }
  function editor() {
    return `<div class="editor-wrap inner-space">${editorDraft.map((q,i)=>`<div class="editor-row"><div class="editor-label"><strong>Question ${i+1}</strong><button class="link-button" data-action="remove-question" data-index="${i}" ${editorDraft.length === 1 ? 'disabled' : ''}>Remove question</button></div><label>Question prompt<input class="field edit-field" data-index="${i}" data-field="prompt" value="${h(q.prompt)}" maxlength="500" required></label><div class="q-fields"><label>Topic<input class="field edit-field" data-index="${i}" data-field="topic" value="${h(q.topic)}" maxlength="45"></label><label>Private host grading notes<textarea class="field edit-field" data-index="${i}" data-field="note" maxlength="900">${h(q.note)}</textarea></label></div></div>`).join('')}</div><div class="editor-actions"><button data-action="add-question" class="btn btn-outline btn-sm" ${editorDraft.length === 30 ? 'disabled' : ''}>+ Add question</button><button data-action="save-questions" class="btn btn-outline">Save for this room</button><button data-action="save-default-questions" class="btn btn-primary">Save as default questions</button></div>`;
  }
  function answerPhase(s) {
    const common = `${phaseHead(s)}${scoreboard(s)}${question(s)}`;
    if (s.role === 'host') {
      return `${common}<section class="panel inner-space"><h2 class="section-head">This round's two contestants are answering…</h2>
      <div class="layout-two">${['A','B'].map(seat=>`<div class="status-box"><span class="seat">ANSWER ${seat} · ${h(s.players[seat].name)}</span><strong style="color:${s.players[seat].submitted ? 'var(--cyan)' : 'var(--gold)'}">${s.players[seat].submitted ? '✓ Answer submitted' : '✎ Writing…'}</strong><p>${s.players[seat].submitted ? 'Their answer is locked.' : 'Waiting for their response.'}</p></div>`).join('')}</div>
      <div class="toolbar"><span class="subtle small">${s.submitted_count}/2 answers received</span><button class="btn btn-pink" data-action="reveal" ${s.submitted_count !== 2 && s.ends_at*1000 > Date.now()+serverOffsetMs ? 'disabled' : ''}>Reveal answers & open voting →</button><button class="btn btn-outline btn-sm" data-action="force_reveal">Override: reveal now</button><button class="btn btn-outline btn-sm" data-action="skip_round">Skip this round</button></div></section>${leaderboard(s)}`;
    }
    if (s.role === 'contestant' && s.seat) {
      if (s.own_answer !== null) return `${common}<section class="panel waiting inner-space"><div class="wait-icon">✅</div><h2>Answer locked in!</h2><p>“${h(s.own_answer)}”</p><p>Waiting for the other player and the host.</p></section>`;
      return `${common}<section class="panel inner-space"><h2 class="section-head">It's your turn, ${h(s.name)}!</h2><p class="subtle">Give your strongest economics answer. Be accurate — and win over the crowd.</p><form id="answerForm"><textarea ${s.ends_at*1000 <= Date.now()+serverOffsetMs?'disabled':''} id="answerDraft" class="answer-box" maxlength="280" required placeholder="Type your response here…">${h(answerDraft)}</textarea><div class="upper-actions"><div id="charCount" class="answer-count">${answerDraft.length}/280 characters</div><button class="btn btn-primary" type="submit" ${s.ends_at*1000 <= Date.now()+serverOffsetMs?'disabled':''}>Lock in my answer →</button></div></form></section>`;
    }
    return `${common}<section class="panel waiting inner-space"><div class="wait-icon">🗳️</div><h2>${s.role==='contestant' ? 'Not your answering turn — you get to vote!' : 'The answers are being written.'}</h2><p>You'll choose the better answer as soon as voting opens. ${s.role==='contestant' ? 'Your answering turn is scheduled automatically.' : ''}</p><span class="tag">${s.submitted_count} / 2 submitted</span></section>${leaderboard(s)}`;
  }
  function answerCards(s, allowVote=false) {
    return `<div class="layout-two inner-space">${['A','B'].map(seat=>{
      const chosen = s.my_vote === seat;
      const cl = `tile ${seat.toLowerCase()}${allowVote ? ' vote-card' : ''}${chosen ? ' chosen' : ''}`;
      const child = `<div class="tile-head"><span class="tile-number">${seat}</span><span class="seat">${s.anonymous_round ? 'Anonymous answer' : h(s.players[seat].name)}</span></div><div class="tile-answer">${h(s.answers[seat] || 'No answer submitted')}</div>${allowVote ? `<div class="vote-call">${chosen ? '✓ Your vote is locked in' : 'TAP TO VOTE FOR THIS ANSWER →'}</div>` : ''}`;
      return allowVote ? `<button class="${cl}" data-choice="${seat}" ${s.my_vote || s.ends_at*1000 <= Date.now()+serverOffsetMs ? 'disabled' : ''}>${child}</button>` : `<article class="${cl}">${child}</article>`;
    }).join('')}</div>`;
  }
  function votePhase(s) {
    const common = `${phaseHead(s)}${scoreboard(s)}${question(s)}`;
    const canVote = s.role === 'audience' || (s.role === 'contestant' && !s.seat);
    return `${common}${answerCards(s, canVote)}
      <section class="panel inner-space"><div class="upper-actions"><div><h2 class="section-head">${canVote ? s.my_vote ? 'Thanks for voting!' : 'Who gave the better answer?' : s.seat ? 'You answered — sit this vote out.' : 'The audience decides.'}</h2>
      <p class="subtle small">${canVote ? s.my_vote ? `You voted for Answer ${s.my_vote}. Votes can't be changed.` : 'Tap Answer A or Answer B above. You get one vote.' : 'Only non-answering contestants and audience members can vote.'}</p></div><span class="tag is-live">🗳 ${fmt(s.votes_cast)} VOTES CAST</span></div>
      ${s.role === 'host' ? `<div class="toolbar"><button class="btn btn-pink" data-action="close">Close voting & grade answers →</button><button class="btn btn-outline btn-sm" data-action="skip_round">Skip this round</button></div>` : ''}</section>${leaderboard(s)}`;
  }
  function percentBar(s,seat) {
    const p = s.vote_percent?.[seat] ?? 0;
    return `<div class="tile ${seat.toLowerCase()}"><div class="tile-head"><span class="tile-number">${seat}</span><strong>${h(s.players[seat].name)}</strong></div><div class="vote-display"><div><span class="stat-big">${p}%</span><div class="stat-label">Audience vote</div></div><div class="text-right"><span class="stat-big">${fmt(s.vote_counts?.[seat] ?? 0)}</span><div class="stat-label">votes</div></div></div><div class="vote-bar-bg"><div class="vote-bar" style="width:${p}%"></div></div></div>`;
  }
  function gradingPhase(s) {
    const common = `${phaseHead(s)}${scoreboard(s)}${question(s)}${answerCards(s)}`;
    if (s.role !== 'host') return `${common}<section class="panel waiting inner-space"><div class="wait-icon">⚖️</div><h2>Our host is grading the answers!</h2><p>Audience voting has ended. The accuracy bonuses will be revealed soon.</p></section>`;
    return `${common}<div class="layout-two inner-space">${percentBar(s,'A')}${percentBar(s,'B')}</div>
    <section class="panel inner-space"><div class="upper-actions"><div><h2 class="section-head">Host: award accuracy points</h2><p class="subtle small">Vote points are automatic: each vote is worth 100 points.</p></div><span class="tag">${fmt(s.votes_cast)} TOTAL VOTES</span></div>
    <div class="grade-controls">${['A','B'].map(seat=>`<div class="grade-panel ${seat.toLowerCase()}"><label for="grade${seat}">PLAYER ${seat} · ${h(s.players[seat].name)}</label><select id="grade${seat}" class="field" data-grade="${seat}"><option value="" ${grades[seat]===null?'selected':''}>Choose accuracy grade…</option><option value="500" ${grades[seat]===500?'selected':''}>Fully correct · +500</option><option value="250" ${grades[seat]===250?'selected':''}>Partially correct · +250</option><option value="0" ${grades[seat]===0?'selected':''}>Incorrect · +0</option></select></div>`).join('')}</div>
    <div class="host-notes"><div class="section-label">🔒 PRIVATE HOST ANSWER GUIDE</div><p>${h(s.host_note || 'Review the main economics concept and assign the accuracy points.')}</p></div>
    <div class="toolbar"><button class="btn btn-primary" data-action="publish" ${grades.A===null || grades.B===null ? 'disabled' : ''}>Publish points & reveal results →</button></div></section>`;
  }
  function resultWinner(s) {
    const a = s.round_result?.A?.round_total || 0, b = s.round_result?.B?.round_total || 0;
    return a === b ? 'It’s a round tie!' : `${h(s.players[a > b ? 'A' : 'B'].name)} wins the round!`;
  }
  function resultPhase(s) {
    const details = `<div class="result-banner"><div class="result-confetti">✦ 🎉 ✦</div><span class="round-bubble">ROUND ${s.round} COMPLETE</span><h1 class="winner winner-gradient">${resultWinner(s)}</h1><p class="subtle">Audience votes + economic accuracy = total points.</p></div>
    <div class="layout-two">${['A','B'].map(seat=>{
      const res = s.round_result[seat];
      return `<article class="tile ${seat.toLowerCase()}"><div class="tile-head"><span class="tile-number">${seat}</span><strong>${h(res.name)}</strong></div>
      <div class="point-row"><span>Audience votes (${res.percent}%)</span><strong>+${fmt(res.vote_points)}</strong></div>
      <div class="point-row"><span>Economics accuracy</span><strong>+${fmt(res.accuracy_points)}</strong></div>
      <div class="point-row"><span>Points this round</span><strong class="point-total">+${fmt(res.round_total)}</strong></div>
      <div class="point-row"><span>Game total</span><strong>${fmt(res.total)}</strong></div></article>`;
    }).join('')}</div>`;
    return `${phaseHead(s)}${scoreboard(s)}${details}${s.next_pair ? `<div class="next-pair">UP NEXT · ${h(s.next_pair.A)} vs. ${h(s.next_pair.B)}</div>` : ''}${leaderboard(s)}${s.role === 'host' ? `<div class="toolbar"><button class="btn btn-primary" data-action="next">${s.round >= s.rounds ? 'See final leaderboard 🏆' : 'Next contestants & question →'}</button></div>` : `<section class="panel waiting inner-space"><p>Waiting for the host to continue.</p></section>`}`;
  }
  function endPhase(s) {
    const top = s.contestants[0]?.score ?? 0;
    const winners = s.contestants.filter(p=>p.score===top);
    const winner = winners.length>1 ? 'IT’S A TIE!' : `${h(winners[0]?.name || 'THE CLASS')} IS THE CHAMPION!`;
    return `<div class="result-banner"><span class="tag is-live">🏆 GAME COMPLETE</span><div class="result-confetti inner-space">✦ 🏆 ✦</div><h1 class="winner winner-gradient">${winner}</h1><p class="subtle">${s.rounds} economics rounds · ${s.contestant_count} contestants · everyone got a turn.</p></div>${leaderboard(s)}
    <section class="panel inner-space"><h2 class="section-head">Round-by-round recap</h2><div style="overflow-x:auto"><table class="history-table"><thead><tr><th>Round</th><th>Question</th><th>Answer A</th><th>Answer B</th></tr></thead><tbody>${s.history.map(r=>`<tr><td>${r.round}</td><td>${h(r.prompt)}</td><td>${h(r.score.A.name)} +${fmt(r.score.A.round_total)}</td><td>${h(r.score.B.name)} +${fmt(r.score.B.round_total)}</td></tr>`).join('')}</tbody></table></div>
    ${s.role==='host' ? `<div class="toolbar"><button data-action="reset" class="btn btn-primary">Play again ↻</button></div>` : ''}</section>`;
  }
  function footer() {return `<p class="footer-note">Economics Showdown · Built for live classroom play · Host decides when rounds advance.</p>`;}
  function render() {
    if (!state || atHome) { app.innerHTML = intro(); return; }
    let body;
    switch(state.phase) {
      case 'lobby':body=lobby(state);break;
      case 'answering':body=answerPhase(state);break;
      case 'voting':body=votePhase(state);break;
      case 'grading':body=gradingPhase(state);break;
      case 'results':body=resultPhase(state);break;
      case 'ended':body=endPhase(state);break;
      default: body='<div class="screen-msg">Loading game…</div>';
    }
    app.innerHTML = `${topbar(state)}<main>${body}</main>${footer()}`;
  }
  async function shareLink() {
    const link = document.getElementById('inviteURL')?.value || location.href;
    try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(link); toast('Invite link copied!'); }
    catch { const el = document.getElementById('inviteURL'); if (el) {el.focus();el.select();} toast('Select the link above to copy it.'); }
  }
  app.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'joinForm') {
      const role = document.querySelector('input[name="role"]:checked')?.value || 'audience';
      await command('join',{room:document.getElementById('roomInput').value.trim().toUpperCase(),name:document.getElementById('nameInput').value.trim(),role});
    }
    if (e.target.id === 'answerForm') {
      await command('answer',{answer:answerDraft});
    }
  });
  app.addEventListener('input', e => {
    if (e.target.id === 'answerDraft') {
      answerDraft = e.target.value;
      const c = document.querySelector('#charCount'); if (c) c.textContent = `${answerDraft.length}/280 characters`;
    }
    if (e.target.classList.contains('edit-field')) {
      const i = Number(e.target.dataset.index), field=e.target.dataset.field;
      if (editorDraft[i] && ['prompt','topic','note'].includes(field)) editorDraft[i][field] = e.target.value;
    }
  });
  app.addEventListener('change', e => {
    if (e.target.dataset.grade) {
      const seat = e.target.dataset.grade;
      grades[seat] = e.target.value === '' ? null : Number(e.target.value);
      const publish = document.querySelector('[data-action="publish"]');
      if (publish) publish.disabled = grades.A===null || grades.B===null;
    }
  });
  app.addEventListener('click', async e => {
    const vote = e.target.closest('[data-choice]');
    if (vote) {await command('vote',{choice:vote.dataset.choice});return;}
    const target = e.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    switch(action) {
      case 'create': await command('create',{}, {success:'Game room created!'});break;
      case 'go-home':
        atHome = true; render(); break;
      case 'resume-host':
        atHome = false; if (state) render(); else await refresh(); break;
      case 'leave':
        if (!confirm('Leave this device? Your contestant spot stays reserved until the host removes you from the lobby.')) return;
        setSession(null);state=null;editing=false;atHome=false;render();break;
      case 'copy': await shareLink();break;
      case 'start': await command('start');break;
      case 'reveal': await command('reveal');break;
      case 'force_reveal': if(confirm('Reveal now? Missing answers will show as no answer.')) await command('force_reveal');break;
      case 'skip_round': if(confirm('Skip this question? Both contestants earn 0 points.')) await command('skip_round');break;
      case 'close': await command('close');break;
      case 'next': await command('next');break;
      case 'reset':
        if (confirm('Reset all scores and return to lobby? All contestants remain joined.')) await command('reset');
        break;
      case 'publish': await command('publish',{grades});break;
      case 'remove-contestant':
        if (confirm('Remove this contestant from the lobby?')) await command('remove_contestant',{player_id:target.dataset.playerId});
        break;
      case 'toggle-edit':
        editing=!editing;
        if (editing) editorDraft=state.questions.map(q=>({...q}));
        render();break;
      case 'add-question':
        if (editorDraft.length<30) {editorDraft.push({topic:'Economics',prompt:'',note:''});render();}
        break;
      case 'remove-question':
        if (editorDraft.length>1) {editorDraft.splice(Number(target.dataset.index),1);render();}
        break;
      case 'save-default-questions':
        if (confirm('Save these as the default questions for future rooms on this server? Changes on free cloud hosts may be lost after a restart.')) await command('save_default_questions',{questions:editorDraft},{success:'Default questions saved on this server!'});
        break;
      case 'save-questions':
        await command('set_questions',{questions:editorDraft},{success:'Questions saved for this game!'});
        break;
    }
  });
  render();
  if (session) refresh();
  setInterval(refresh, 1400);
  setInterval(updateCountdown, 200);
})();
