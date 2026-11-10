# Economics Showdown — Version 4 (review build)

Five contestants plus one host. Ten questions, two answering players per round, automatic balanced rotation, three contestants voting, 90-second answer timer, and 20-second voting timer.

## Run on Windows
1. Extract the ZIP fully, open the extracted folder, and double-click **start_windows.bat**. Python 3 is required.
2. On your computer, open http://localhost:8000. Click Create a new game · Host.
3. Share the room code and reachable classroom URL with five phones; they must be on the same accessible network unless the server has been publicly deployed.
4. Five people choose Contestant; you are the Host on your laptop. Two contestants answer at a time; others vote.
5. Answer windows last 90 seconds; voting lasts 20 seconds. The host can reveal early, close voting early, or skip an unfinished round.
6. As host, select Edit Questions in the lobby to edit prompts, topics, and hidden grading notes. Save for this room or Save as default questions (writes questions.json on the host machine).
7. **← Back to Home** in the host top bar shows the home screen, keeping your room and host session available. Choose **Resume your hosted game** to return.

## Scoring
Each vote = **100 points**; full economic accuracy = **500**, partial = **250**, incorrect = **0**. With 5 contestants / 10 questions, each answers 4 rounds.

## Persistence
The question editor's Save as default action writes questions.json on the running server. Locally these changes survive restarts. On free or ephemeral cloud hosts, files may be reset on redeploy/restart; to guarantee long-term persistence online use a persistent database or commit edits to GitHub. Active rooms and scores live in server memory and are lost on server restarts. Host token protects grading and question editing; use a private host device.

## Testing and limitations
Run `python -m unittest discover -s tests -v` for automated test checks. Use your phone and laptop to test actual network access before class. This build is not hosted publicly yet. To use the same address as the previous version, shut down the old server first.

## Public QR lobby
The host lobby automatically shows a per-room QR code. Install dependencies with `pip install -r requirements.txt`, then start via `python server.py` or `start_windows.bat`.
