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

## Connect accounts (phase 2)

1. In Claude Code, connect Gmail, Google Drive and Google Calendar (claude.ai Settings > Connectors, or `/mcp`).
2. Run `claude mcp list` and note the tool names, for example `mcp__claude_ai_Gmail__search_threads`.
3. Put the read tools in `read_tools` and the sending/changing tools in `write_tools` in `config/accounts.json`.
4. Press **⟳ Accounts** in the HUD. Connected accounts turn green.

YouTube, Classroom and TikTok need an MCP server that uses your own developer app (planned for phase 2). Play Store and PlayStation Store have no API for your purchases, so they stay grey.

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
