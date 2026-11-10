# Publish Economics Showdown v5 (QR lobby)

## 1. Upload to GitHub
Create a GitHub repository, then upload **the contents of this folder** (not the outer folder). Keep `assets/` intact. Do not upload previous versions as nested folders.

## 2. Deploy on Render
- Visit https://dashboard.render.com and choose New → Web Service.
- Connect the GitHub repository.
- Runtime: Python; Instance: Free if available.
- Build command: `pip install -r requirements.txt`
- Start command: `python server.py`
- Leave Root Directory blank.
- Deploy and open the resulting HTTPS .onrender.com URL.

## 3. Have your 5 contestants join
Host opens the site, creates a room, and projects the lobby screen. Each contestant scans the automatically generated QR code and enters their name. The QR code leads to the real public URL and fills in the room code; students don't need your hotspot or Python. Start after all five have joined.

## Cautions
- This app stores rooms and scores in memory. If the service goes to sleep/restarts, the active game disappears. Test beforehand, avoid redeploying during play.
- Host question edits saved to the server's local disk may be lost on cloud restarts. To preserve permanent changes, edit `questions.json` in GitHub and redeploy; do so only between games.
- The free hosting tier may be subject to sleep/restart and resource limits. It is not a production-hardened public service; share the room code only with intended participants.
- QR codes on localhost use localhost, so use the public HTTPS site when testing from other phones. For local Wi-Fi play, a device joining by local address will receive a local-address QR instead.
