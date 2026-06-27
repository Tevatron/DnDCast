# DnDCast

A browser-based D&D session player. Show fullscreen scene art (one or more images per scene), play per-scene audio or a looping adventure soundtrack, and control everything from a private DM tab — with real-time sync to a cast display and to remote players on any device. The DM also gets private notes, read-aloud script, and an ad-hoc notebook that never reach the table.

---

## Quick start

**First time only:**
1. Install [Node.js](https://nodejs.org) (v20 or later)
2. Start the server:
   - **Windows:** double-click `start.bat`
   - **Mac:** open Terminal, drag the DnDCast folder in, run `npm start`
   - **Linux:** open a terminal in the DnDCast folder, run `npm start`
3. The first launch asks you to choose a DM password (and, optionally, a separate **player** password — press Enter to skip). The server then runs at `http://localhost:3000`

**Every time after that:** same step 2 above — enter your password when prompted.

That's it. The rest of this document is for when you want to do more.

---

## The three modes

The home page has three cards:

| Mode | What it's for |
|------|--------------|
| **Cast** | The display tab — shows scene art and plays audio. This is what you cast or show on the TV. |
| **DM Control** | Your private control surface. Notes and script are visible only here. Every action syncs to Cast in real time. |
| **Editor** | Build your campaigns, adventures, and scenes. Upload art and audio. |

Remote **players** can also log in with a separate password (see [Player access](#player-access-optional)) — they follow the DM on their own device without seeing any spoilers.

---

## Running a session

### Option A — Chrome Tab Cast (same computer)

1. Open **Cast** in one tab and **DM Control** in another.
2. Click **Start Session** in both tabs.
3. In DM, pick your campaign and adventure.
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
4. On your laptop, open DM Control and start your adventure. Both sync automatically.

> **DM audio:** The DM tab is muted by default so only the Cast tab makes sound. Click **🔊** in the DM toolbar to hear audio locally too.

---

## Adding content

Open **Editor** from the home page. Three tabs:

**Scenes** — the building blocks. Each scene has:
- a **title**
- one or more **images** — add several to flip through *within* a scene (same notes/audio); each image has its own **Contain** / **Cover** fit
- an optional **audio** track — leave it blank to inherit the adventure soundtrack, or tick **No music** to force silence on that scene
- **DM notes** and **read-aloud script** — private to the DM tab; never shown on Cast or to players
- **Private to** — optionally lock a scene to a specific campaign or adventure so it stays out of the "all scenes" pool and other adventures' pickers

**Adventures** — an ordered list of scenes.
- Click **+ Add scene** to search and add scenes; drag the ⠿ handle (or use ↑/↓) to reorder.
- Set a **Soundtrack** of one or more tracks — it plays as a continuous, looping playlist on any scene that has no audio of its own.

**Campaigns** — group adventures.

Click **Browse** to upload an image or audio file from anywhere on your machine (Chrome/Edge). Everything saves automatically, and you'll be warned before navigating away from a panel with unsaved edits.

---

## Player access (optional)

During first-time setup you can set a second **player** password (leave it blank to disable). Anyone logging in with it joins as a **player**: they reach only the Cast view and follow whatever the DM is presenting — the **current scene's art and audio only**.

Players never receive scene titles, DM notes, read-aloud script, scene ids, or any other scene — the server sends them just the active visuals and sound. They keep local control of their own **volume** and **fullscreen**, and can **log out** from the home page or the ⋯ menu. This lets you share the public URL with remote players so each watches on their own device without anything that would spoil the campaign.

---

## DM tools during a session

From the DM tab while running an adventure:

- **Step through images** — if a scene has several images, **Next/Prev** (`→`/`←`) walks through them before advancing to the next scene. The counter shows e.g. `▦ 2/3`.
- **Create a scene on the fly** — open the scene list (☰) and click **+ New** to author a scene without opening the Editor. Upload art/audio and either **Add & Show** it immediately or **Add only** to file it for later. Scenes created this way are automatically private to the current adventure.
- **Edit a scene** — the ✎ pencil beside any scene in the list opens it for quick edits.
- **Notebook (📓)** — jot ad-hoc notes tied to the current **campaign, adventure, or scene**. The tray lists notes for where you are now (scene → adventure → campaign); click one to read it, or **+ New note** to add one. Notes are private to you and only surface in the context they belong to. *(DM-only for now.)*

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

**Keep the server running with PM2** so it survives machine restarts:
```
npm install -g pm2
pm2 start server.js --name dndcast
pm2 save
pm2 startup   # follow the printed instructions to register the startup hook
```

**Deploy updates when ready** — double-click `deploy.bat` (Windows) or run `./deploy.sh` (Mac/Linux) from the prod folder. The script pulls `main`, installs any new dependencies, and restarts the server via PM2.

> The deploy scripts assume PM2 is running the server under the name `dndcast`. If you're running the server another way (e.g. manually with `npm start`), just restart it yourself after `git pull && npm install`.

---

## Controls reference

### Primary toolbar

| Button | Action | Key |
|--------|--------|-----|
| ⏹ | Stop and return home | |
| ⏮ | Previous scene (or image within a scene) | `←` |
| ▶ / ⏸ | Play / Pause | |
| ⏭ | Next scene (or image within a scene) | `→` or `Space` |
| ☰ | Scene list (type to filter; **+ New** scene for DM) | |
| 📓 | Notebook *(DM only)* | |
| 🔊 / 🔇 | Volume slider — click the speaker to mute | `M` |
| ⋯ | More options | |
| ⛶ | Fullscreen | `F` |

### Overflow menu (⋯)

| Button | Action | Key |
|--------|--------|-----|
| ● | Blackout | `B` |
| T | Scene title overlay | `T` |
| ↺ | Switch adventure | |
| □ | Presentation mode | `P` |
| 📖 | Notes/script overlay *(DM only)* | `N` |
| ⊘ | Stage mode — freeze cast updates *(DM only)* | `Z` |
| ⌂ | Home (back to the mode chooser) | |
| ⏻ | Log out | |

**Stage mode:** Navigate freely on DM without updating the Cast display. Disable to push current state to Cast instantly.

**DM audio:** the DM tab starts **muted** so only Cast makes sound — raise the volume slider (or click 🔇) to monitor locally. Each device (DM, Cast, every player) controls its own volume independently.

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
- [ ] DM tab: Start Session clicked, adventure selected
- [ ] Cast is visible on TV
- [ ] Test: change a scene on DM, confirm Cast follows
