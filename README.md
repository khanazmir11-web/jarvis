# JARVIS (testing phase)

This is your own JARVIS HUD. Your accounts, memory and cyber-security knowledge show up as glowing bubbles in a graph. You chat with it (typed or by voice), steer the graph with hand gestures, and nothing happens on a real account until you press **Approve**.

## Run it on your device

Needs Python 3.9+, Claude Code (`claude`) logged in with your Claude subscription, and Chrome or Edge.

```bash
cd jarvis/app
./start.sh            # then open http://127.0.0.1:8720
```

On Windows, double-click `start.bat` instead. It finds the Claude Code that comes with the Claude desktop app and opens the browser for you.

No pip installs are needed. Don't set `ANTHROPIC_API_KEY`: it switches you from your subscription to paid per-token billing.

## Install it as an app

Open http://127.0.0.1:8720 in Chrome or Edge and click the install icon in the address bar (or menu > "Install JARVIS"). It gets its own window, a dock/taskbar icon and the JARVIS logo. The app still only runs on your computer.

## Talk to it on WhatsApp (private to you)

This uses Meta's official WhatsApp Business Cloud API. Unofficial "link your personal WhatsApp" libraries break WhatsApp's terms and can get your number banned, so JARVIS doesn't use them.

1. Go to developers.facebook.com, create an app (type "Business") and add the WhatsApp product.
2. Under WhatsApp > API Setup, add a phone number for JARVIS to use: a spare SIM or a virtual number. Meta's free test number is fine for trying it out. Add your own number as the recipient.
3. Create a permanent token: Business Settings > System Users > add a user, give it the whatsapp_business_messaging permission, then generate a token.
4. Fill in the `JARVIS_WA_*` lines in `.env` (copy them from `.env.example`).
5. Give the bridge a public HTTPS address. The easiest is Tailscale Funnel: `tailscale funnel 8721`. Only the WhatsApp bridge is exposed. The HUD stays private.
6. In Meta > WhatsApp > Configuration, set the Callback URL to that address and the Verify token to your `JARVIS_WA_VERIFY_TOKEN`, then subscribe to `messages`.
7. Run `./start.sh` (it starts the bridge too) and send JARVIS a WhatsApp message.

Privacy: every webhook must carry Meta's signature made with your App Secret, and only your number gets an answer. Messages from anyone else are silently ignored and logged as a warning. From your phone, send `pending`, `approve <id>` or `reject <id>` to handle proposals.

## YouTube (read-only)

claude.ai has no connector for your own YouTube account, so JARVIS ships its own small one, `youtube_mcp.py`. It only has the `youtube.readonly` permission: it can see your channel, subscriptions, playlists and new uploads, and search, but can never post, like, comment or delete.

1. In [Google Cloud Console](https://console.cloud.google.com): create a project, enable **YouTube Data API v3**, set up the **OAuth consent screen** (External, Testing, add yourself as a test user), then **Credentials > Create credentials > OAuth client ID > Desktop app** and download the JSON.
2. Save it as `%USERPROFILE%\.jarvis\youtube_client.json` (outside this folder, never in git, never in a chat).
3. Double-click `connect-youtube.bat`. It signs you in, adds the connector to Claude Code, and checks it works.
4. In JARVIS press **⟳ Accounts**. The YouTube bubble turns green.

To disconnect: delete `%USERPROFILE%\.jarvis\youtube_token.json` and run `claude mcp remove --scope user youtube`.

## Google Classroom (read-only)

`classroom_mcp.py` works like the YouTube connector and uses the same Google Cloud project and client file. It can list your classes, work due soon that you haven't handed in, recent coursework and teacher announcements. It can't hand in, post or change anything.

1. In the same Google Cloud project, enable the **Google Classroom API**: https://console.cloud.google.com/apis/library/classroom.googleapis.com
2. Double-click `connect-classroom.bat` and sign in. Tick every box (all three are read-only).
3. In JARVIS press **⟳ Accounts**.

To disconnect: delete `%USERPROFILE%\.jarvis\classroom_token.json` and run `claude mcp remove --scope user classroom`.

## Web links in the bubbles

Every account bubble opens its website: double-click it, select it and press **Open ↗**, or say/type "open YouTube". Pages open in your normal browser, so wherever you're signed in there, you're signed in here.

Add your own pages under **Web links** in the left panel (name, address, and which main circle it hangs off). They're saved in `logs/links.json` on your PC only. Addresses with look-alike letters (`xn--`) or an `@` trick are refused, since those are classic phishing links.

## Connect accounts

1. On claude.ai go to Settings > Connectors and connect Gmail, Google Calendar and Google Drive.
2. In JARVIS press **⟳ Accounts**. It asks Claude Code which tools are really connected on this PC, allows the read-only ones in chat, and keeps every tool that sends, changes or deletes behind your Approve button. The result is saved in `logs/accounts_state.json` (not in git).

## What runs by itself

- **Morning briefing**: the first time you open JARVIS each day (after 5am) it reads your calendar and email and talks you through the day. Press ☀ Brief any time.
- **Background watch**: every hour (`JARVIS_WATCH_MINUTES`, 0 = off) it checks your accounts read-only and lists findings in Alerts. Phishing is marked red and the account bubble pulses.
- **Live threat feed**: once a day it pulls the newest actively exploited vulnerabilities from CISA's public list and shows them as pulsing red bubbles under Cyber Security.

## Voice

- **JARVIS voice**: put a free Fish Audio key in `.env` as `FISH_AUDIO_API_KEY`. Without it, the browser voice is used.
- **"Hey Jarvis"**: click 👂 to cycle between the browser's speech service, 🔒 private mode, and off. Private mode turns speech into text on your PC with faster-whisper (`python -m pip install faster-whisper`, the first use downloads a ~150 MB model).

## Desktop icon and start with Windows

Double-click `install-shortcuts.bat` once.

## How it looks and talks

- **Core:** the big geometric circle in the middle is JARVIS. Lines go out to the main circles (Google, Social, Stores, E-learning, Infra, Cyber Security, Memory & Learning).
- **Zoom:** zoom in with the scroll wheel, a two-hand pinch, or a click on a main circle to reveal the small circles (each account and note) attached to it.
- **Glow:** every line glows and pulses while JARVIS talks or while you speak into the mic.
- **Personality:** dry, witty and a little sarcastic. The sarcasm switches off for security warnings, money, or anything you're worried about.
- **Voice:** replies are read aloud with your browser's British voice. Use 🔊 to turn it off. A Fish Audio "Jarvis" voice is a later phase.

## What the bubbles mean

| Colour | Meaning |
|---|---|
| Green / grey / dark | Account connected / planned / not possible |
| Red | Threats (prompt injection, phishing, deepfakes, token theft...) |
| Amber | Defences JARVIS uses |
| Purple / blue | Memory and learning notes |

Every note in `vault/` is a bubble, and every `[[link]]` in a note draws a line.

## Hand gestures (✋ Camera)

- ☝ Point with your index finger to move the cursor.
- 🤏 Pinch your thumb and index finger to select the bubble under the cursor.
- Keep pinching and move your hand to drag the whole graph.
- ✋ Hold an open palm for 1 second to reset the view.
- 🤏🤏 Pinch with both hands, then move them apart to zoom in or together to zoom out.

Video is processed in your browser (MediaPipe) and never uploaded.

## Safety model

| Rule | Where |
|---|---|
| Chat is read-only. Shell, file-write and web-fetch tools are always blocked. | `config/policy.json` |
| Actions on accounts become proposals. You approve each one, and it runs with only that account's tools. | server.py `approve()` |
| Self-learning becomes a proposed note. It joins memory only when you approve it. | `proposals/` then `vault/` |
| Scanner flags injection phrases, credential requests, bulk exfiltration, encoded blobs and data-leaking URLs. | server.py `scan()` |
| Every chat, proposal, approval and action is logged. | `logs/audit.jsonl` |
| Listens on 127.0.0.1 only. It checks a per-start token plus Host/Origin, so other websites can't control it. | server.py `Handler` |
| Security panel re-checks all of this every 15 seconds. | HUD left panel |

JARVIS never edits `config/policy.json`. Only you do.

## Monitoring

`python3 monitor.py` runs one read-only check of your connected accounts. Alerts go to `logs/alerts.jsonl`, and anything it wants to do lands in **Awaiting your OK**. To run it every 30 minutes, add a cron job (see the top of monitor.py). Sending monitoring alerts to your WhatsApp is planned for phase 3.

## Files

```
server.py        HUD server (stdlib): graph, chat, approvals, security checks
whatsapp.py      private WhatsApp bridge (official Cloud API, owner-only, signed webhooks)
monitor.py       one monitoring pass
config/          accounts.json (bubbles + tools), policy.json (safety switches)
vault/           memory notes = bubbles (security/, memory/)
web/             index.html, hud.js (graph + panels), gestures.js (camera), style.css
proposals/ logs/ created at runtime, git-ignored
```
