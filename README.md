# DnDCast

A browser-based D&D session player. Show fullscreen scene art, play ambient audio, and control everything from a private DM tab — with real-time sync to a cast display on any device.

---

## Quick start

**First time only:**
1. Install [Node.js](https://nodejs.org) (v20 or later)
2. Start the server:
   - **Windows:** double-click `start.bat`
   - **Mac:** open Terminal, drag the DnDCast folder in, run `npm start`
   - **Linux:** open a terminal in the DnDCast folder, run `npm start`
3. The first launch asks you to choose a password, then the server is running at `http://localhost:3000`

**Every time after that:** same step 2 above — enter your password when prompted.

That's it. The rest of this document is for when you want to do more.

---

## The three modes

The home page has three cards:

| Mode | What it's for |
|------|--------------|
| **Cast** | The display tab — shows scene art and plays audio. This is what you cast or show on the TV. |
| **DM Control** | Your private control surface. Notes and script are visible only here. Every action syncs to Cast in real time. |
| **Editor** | Build your campaigns, sessions, and scenes. Upload art and audio. |

---

## Running a session

### Option A — Chrome Tab Cast (same computer)

1. Open **Cast** in one tab and **DM Control** in another.
2. Click **Start Session** in both tabs.
3. In DM, pick your campaign and session.
4. Cast the Cast tab to your TV: **Chrome menu → Cast → Sources → Cast tab**.
5. Control everything from the DM tab.

### Option B — TV native browser (same network)

If your TV and PC are on the same Wi-Fi, the TV browser can reach the server directly — no public URL needed.

1. Find your machine's local IP:
   - **Windows:** run `ipconfig` — look for **IPv4 Address** under your Wi-Fi adapter
   - **Mac:** run `ipconfig getifaddr en0`
   - **Linux:** run `hostname -I`
   
   It will look something like `192.168.1.23`.
2. On the TV browser, navigate to `http://192.168.1.23:3000` and log in.
3. Open Cast, click Start Session.
4. On your laptop, open DM Control and start your session. Both sync automatically.

> **DM audio:** The DM tab is muted by default so only the Cast tab makes sound. Click **🔊** in the DM toolbar to hear audio locally too.

---

## Adding content

Open **Editor** from the home page.

- **Scenes** — set a title, upload an image, upload an audio track, write DM notes and read-aloud script.
- **Sessions** — group scenes in play order using the checkbox picker.
- **Campaigns** — group sessions.

Everything saves to the server automatically. No manual file management needed — just click Browse to upload an image or audio file from anywhere on your machine.

---

## Getting a public URL (optional)

If you want to access DnDCast from **outside your home network** — a venue, a friend's house, or anywhere not on your Wi-Fi — you need a public URL. This is optional; most home setups don't need it.

### Temporary URL (no account required)

Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then while the server is running:

```
cloudflared tunnel --url http://localhost:3000
```

It prints a URL like `https://random-words.trycloudflare.com`. Share it with anyone who needs access. The URL changes every time you restart.

### Persistent custom URL

For a permanent address like `dndcast.yourdomain.com`:

1. Create a free [Cloudflare account](https://cloudflare.com) and add a domain you own.
2. Run `cloudflared login` to authorize.
3. Create a named tunnel: `cloudflared tunnel create dndcast`
4. Configure `~/.cloudflared/config.yml` to route your domain to `http://localhost:3000`.
5. Add the DNS record: `cloudflared tunnel route dns dndcast dndcast.yourdomain.com`
6. Install as a background service so it runs automatically on startup:
   - **Windows:** `cloudflared service install`
   - **Mac:** `sudo cloudflared service install`
   - **Linux:** follow [Cloudflare's systemd guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/run-tunnel/as-a-service/linux/)

---

## Deploying to a separate production directory

If you're developing actively, keep a separate production folder so code changes don't accidentally affect a running session:

```
git clone <your-repo> /path/to/dndcast-prod
cd /path/to/dndcast-prod
npm install
node setup.js
```

Set `"port": 3001` in the generated `config.json` so dev (3000) and prod (3001) don't collide.

Deploy updates when ready:
```
cd /path/to/dndcast-prod
git pull
npm install
```

---

## Controls reference

### Primary toolbar

| Button | Action | Key |
|--------|--------|-----|
| ⏹ | Stop and return home | |
| ⏮ | Previous scene | `←` |
| ▶ / ⏸ | Play / Pause | |
| ⏭ | Next scene | `→` or `Space` |
| ☰ | Scene list (type to filter) | |
| ⋯ | More options | |
| ⛶ | Fullscreen | `F` |

### Overflow menu (⋯)

| Button | Action | Key |
|--------|--------|-----|
| ● | Blackout | `B` |
| T | Scene title overlay | `T` |
| ↺ | Switch session | |
| □ | Presentation mode | `P` |

### DM-only

| Button | Action | Key |
|--------|--------|-----|
| 📖 | Notes/script overlay | `N` |
| 🔇 / 🔊 | Silence / listen locally | |
| ⊘ | Stage mode — freeze cast updates | `Z` |

**Stage mode:** Navigate freely on DM without updating the Cast display. Disable to push current state to Cast instantly.

---

## Troubleshooting

**Page won't load / "Cannot GET /login"** — The server isn't running. Double-click `start.bat`.

**Cast shows "Waiting for DM…"** — Both tabs need to use the same URL. If using a tunnel, make sure both tabs use the tunnel URL, not localhost.

**No audio after Start Session** — Browser blocked autoplay. Click ▶ to start manually.

**Image or audio not found** — Use the Browse button in the Editor to upload the file rather than placing it manually.

**Scene changes don't appear on Cast** — Refresh both tabs to reconnect to the server.

---

## Pre-session checklist

- [ ] Server is running (`start.bat`)
- [ ] Logged in on all tabs / devices
- [ ] Cast tab: Start Session clicked
- [ ] DM tab: Start Session clicked, session selected
- [ ] Cast is visible on TV
- [ ] Test: change a scene on DM, confirm Cast follows
