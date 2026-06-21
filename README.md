# DnDCast

A browser-based D&D session player. Show fullscreen scene art, play ambient audio, and control everything from a private DM tab — with real-time sync to a cast display on any device.

---

## First-time setup

Requires [Node.js](https://nodejs.org) (v14+).

```
npm install
node setup.js
```

`setup.js` asks you to choose a password. It writes a `config.json` with your hashed password and a session secret. This file is gitignored — never commit it.

---

## Starting the server

```
npm start
```

Open `http://localhost:3000` in your browser. You'll be prompted for your password on first visit.

---

## The three modes

The home page offers three modes:

| Mode | URL | Purpose |
|------|-----|---------|
| **Cast** | `player.html` | Displays scene art and plays audio. This is the tab you display on the TV. |
| **DM Control** | `player.html?role=dm` | Your private control surface. Same controls as Cast plus a notes/script overlay. Muted by default. Every action syncs to the Cast tab in real time. |
| **Editor** | `editor.html` | Create and manage campaigns, sessions, and scenes. |

---

## Running a session

### Option A — Two tabs, same browser (Chrome Tab Cast)

1. Open **Cast** in one tab and **DM Control** in another (same Chrome window).
2. Click **Start Session** in both tabs.
3. In the DM tab, pick a campaign and session.
4. Cast only the Cast tab to your TV: **Chrome menu → Cast… → Sources → Cast tab**.
5. Drive everything from the DM tab. The Cast tab follows automatically.

### Option B — Separate devices (TV native browser or second PC)

1. Expose the server with a public URL (see below).
2. On the TV browser (or second device), navigate to your URL and log in.
3. Open the Cast page. Click Start Session.
4. On your laptop, open DM Control and start your session.
5. Both devices connect to the same WebSocket server and sync automatically.

> **DM audio:** The DM tab is muted by default so only the Cast tab makes sound. Click **🔊 Listen here** in the DM toolbar if you want to hear audio locally too.

---

## Exposing publicly (Cloudflare Tunnel)

To access DnDCast from other devices or over the internet without port-forwarding:

1. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. With the server running, open a second terminal and run:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
3. Cloudflare prints a public HTTPS URL (e.g. `https://random-words.trycloudflare.com`). Share it with anyone who needs access.

For a persistent custom URL (e.g. `dndcast.yourdomain.com`), set up a named tunnel in the Cloudflare dashboard.

---

## Adding content

Use the **Editor** to create campaigns, sessions, and scenes. All data is saved to the server automatically when you save a scene, session, or campaign.

**To add images and audio:**
1. Open the Editor and create or edit a scene.
2. Click **Browse** next to the Image or Audio field.
3. Pick any file from your machine — it uploads to the server and the path is filled in automatically.

Asset files are stored in `assets/images/` and `assets/audio/` on the server machine. These are gitignored.

---

## Controls

### Primary toolbar (always visible)

| Button | Action |
|--------|--------|
| ⏹ | Stop session and return home |
| ⏮ | Previous scene (`←`) |
| ▶ / ⏸ | Play / Pause audio |
| ⏭ | Next scene (`→` or `Space`) |
| ☰ | Open scene list (type to filter) |
| Slider | Volume |
| ⋯ | More options (overflow menu) |
| ⛶ | Fullscreen (`F`) |

### Overflow menu (⋯)

| Button | Action |
|--------|--------|
| ● | Blackout screen (`B`) |
| T | Toggle scene title overlay (`T`) |
| ↺ | Switch session |
| □ | Presentation mode — hides all controls (`P`) |

### DM-only toolbar buttons

| Button | Action |
|--------|--------|
| 📖 | Toggle notes/script overlay (`N`) |
| 🔇 / 🔊 | Silence / listen locally |
| ⊘ | Stage mode — suspends cast updates (`Z`) |

**Stage mode:** While staged, you can freely navigate scenes on the DM tab without updating the Cast display. Disabling stage mode immediately pushes your current state to Cast.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `→` or `Space` | Next scene |
| `←` | Previous scene |
| `B` | Blackout |
| `M` | Mute / Unmute |
| `F` | Fullscreen |
| `T` | Toggle title overlay |
| `P` | Presentation mode |
| `N` | Toggle notes overlay (DM only) |
| `Z` | Toggle stage mode (DM only) |

---

## Troubleshooting

**"Cannot GET /login" or blank page:**
The server isn't running. Start it with `npm start` and navigate to `http://localhost:3000`.

**Cast tab shows "Waiting for DM…" and doesn't update:**
Both tabs must connect to the same server. Make sure they're using the same URL (both `localhost:3000`, or both the same tunnel URL). Check that the server is running.

**No audio after Start Session:**
The browser blocked autoplay. Click ▶ in the control panel to start audio manually.

**Image or audio shows as "not found":**
The file may not have been uploaded. Use the Browse button in the Editor to upload the file — it's copied to the server automatically. Manual file placement in `assets/` also works.

**Scene changes don't appear on Cast:**
Try refreshing both tabs so they reconnect to the WebSocket server.

---

## Pre-session checklist

- [ ] `npm start` is running
- [ ] Logged in on all devices/tabs
- [ ] Cast tab: Start Session clicked
- [ ] DM tab: Start Session clicked, campaign and session selected
- [ ] Cast is displaying on TV (Chrome Cast tab, or TV browser open to URL)
- [ ] Switch a scene on DM — confirm Cast follows
