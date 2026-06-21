# DnDCast — DM Scene Player

A browser-based fullscreen scene player for D&D sessions. Show ambient artwork and play music for each scene. Control it from your phone and mirror the screen to your TV.

---

## Quick Start (Local Hosting on Windows)

Run one of these commands in the `DnDCast` folder:

**Option A — Python (usually pre-installed):**
```
python -m http.server 8080
```

**Option B — Node.js:**
```
npx serve .
```

Then open in your browser:
```
http://localhost:8080
```

> **Note:** the app loads as ES modules, so it must be served over `http://`
> (the dev server above) — opening the `.html` files via `file://` won't work.

---

## The Three Modes

Opening `http://localhost:8080` shows a **home page** with three modes:

1. **Player** (`player.html`) — displays scene art and plays audio. This is the
   tab you cast to the TV. On its own it works exactly like before; when a DM
   tab is open, it follows the DM.
2. **DM Control** (`player.html?role=dm`) — your private control surface. Same
   controls as the player, plus a readable **notes + script overlay** over the
   art. Every action (scene change, play/pause, volume, blackout…) is sent to
   the Player tab. This tab is muted by default and is **not** meant to be cast.
3. **Editor** (`editor.html`) — create and edit campaigns, sessions, and scenes.

### Running DM + Player together (recommended)
The DM and Player tabs talk to each other directly via the browser
(BroadcastChannel) — **no server beyond the static file host**. They must be in
the **same browser on the same machine**:

1. Open **Player** in one tab and **DM Control** in another (same Chrome/Edge).
2. Tap **Start Session** in both. In the DM tab, pick a campaign/session.
3. Cast only the Player tab: **Chrome menu → Cast… → Sources → Cast tab**, then
   pick your Samsung TV (or a Chromecast). The DM tab stays private on your PC.
4. Drive everything from the DM tab. Use **🔊 Listen here** in the DM tab if you
   also want to hear the audio locally; otherwise only the cast tab makes sound.

> Cross-device control (DM on a different device than the Player) would require
> a relay server and is intentionally out of scope for this static-site setup.

---

## Connecting from Your Phone (Same Wi-Fi)

1. Start the local server on your PC (above).
2. Find your PC's local IP address:
   ```
   ipconfig
   ```
   Look for `IPv4 Address` under your Wi-Fi adapter — something like `192.168.1.23`.

3. On your phone (connected to the same Wi-Fi), open:
   ```
   http://192.168.1.23:8080
   ```
   Replace `192.168.1.23` with your actual PC IP.

**If the page won't load:**
- Make sure your PC and phone are on the same Wi-Fi network.
- Check that Windows Firewall is not blocking Python or Node on port 8080.
  - Go to: Windows Security → Firewall → Allow an app → add Python or Node.
- Try a different port like `3000` or `5173`.
- Do not use `localhost` from your phone — that refers to the phone itself.

---

## Phone → Samsung TV Setup

1. Open the app on your phone using the PC's local IP.
2. Tap **Start Session** to unlock audio playback.
3. Turn on **Do Not Disturb** on your phone to avoid notifications during the session.
4. Set your phone to **landscape orientation** (rotate the phone sideways).
5. Keep the screen awake — see the note below.
6. Mirror or cast your phone screen to the Samsung TV:
   - **Android:** Use *Screen Mirror*, *Smart View*, or *Quick Connect* in the notification shade or Settings.
   - **iOS:** Use *Screen Mirroring* from Control Center if your Samsung TV supports AirPlay.
7. Tap **□** (presentation mode button) in the app to hide all controls for a clean TV view.
8. Tap the small **gold dot** in the top-right corner to bring controls back.

> **Keep Awake:** Mobile browsers may lock the screen during long sessions and interrupt audio. Before your session, disable auto-lock in your phone settings, or use a keep-awake app or browser extension (search "keep awake" in your phone's app store).

---

## Adding Your Own Scenes

1. Drop image files into `assets/images/` and audio files into `assets/audio/`.
2. Edit `scenes.json` to add or change scenes. Each scene:

```json
{
  "id": "my-scene",
  "title": "Scene Title",
  "image": "assets/images/my-scene.jpg",
  "audio": "assets/audio/my-track.mp3",
  "notes": "DM notes — only visible in the control panel.",
  "loopAudio": true
}
```

- `id` — unique identifier (no spaces)
- `title` — displayed as the scene title overlay
- `image` — path to image (JPG, PNG, WebP)
- `audio` — path to audio (MP3, OGG, WAV)
- `notes` — private DM notes, hidden in presentation mode
- `loopAudio` — `true` to loop, `false` to play once (default: `true`)

---

## Controls

| Button | Action |
|--------|--------|
| ⏮ | Previous scene |
| ☰ | Open scene list |
| ▶ / ⏸ | Play / Pause audio |
| ⏭ | Next scene |
| ● | Blackout screen |
| T | Toggle scene title overlay |
| ⛶ | Fullscreen |
| □ | Presentation mode (hide all controls) |
| Slider | Volume |

**Tap the left or right 30% of the screen** to go to the previous or next scene (works when controls are hidden).

**Tap anywhere** to show controls (they auto-hide after 3 seconds).

**Tap the gold dot** (top-right) to exit presentation mode.

**Notes ▸** — expand DM notes for the current scene.

### Keyboard Shortcuts (Desktop)

| Key | Action |
|-----|--------|
| `→` or `Space` | Next scene |
| `←` | Previous scene |
| `B` | Blackout |
| `M` | Mute / Unmute |
| `F` | Fullscreen |
| `T` | Toggle title overlay |
| `P` | Presentation mode |

---

## Global Settings

Edit the `CONFIG` block at the top of `app.js`:

```js
const CONFIG = {
  fadeMs: 600,               // audio crossfade duration in ms
  autoHideMs: 3000,          // ms before controls auto-hide
  objectFit: 'cover',        // 'cover' or 'contain' for scene images
  blackoutPausesAudio: true, // false = audio continues during blackout
};
```

To permanently change the image fit, edit `objectFit` here. You can also temporarily override it by running in the browser console:
```js
localStorage.setItem('dndcast_objectFit', 'contain');
location.reload();
```

---

## Cloud Deployment (Optional)

The app is a static site with no backend, so it deploys anywhere that serves static files.

> **Note:** Audio and images must be included in your repository or served from the same host. Large files may hit platform size limits.

### GitHub Pages

1. Push the project to a GitHub repository.
2. Go to Settings → Pages → Branch: `main`, folder: `/ (root)`.
3. The app will be live at `https://yourusername.github.io/repository-name/`.

### Cloudflare Pages

1. Push the project to GitHub or GitLab.
2. In the Cloudflare dashboard → Workers & Pages → Create → Connect to Git.
3. Set build command to *(empty)* and output directory to `/`.
4. Deploy.

### Azure Static Web Apps

1. Push the project to GitHub.
2. In the Azure Portal → Create resource → Static Web App.
3. Connect to your GitHub repo and set:
   - App location: `/`
   - Output location: `/`
   - No build command needed.
4. Deploy.

---

## Troubleshooting

**No audio after Start Session:**
The browser blocked autoplay. Tap the **▶** button in the control panel to start audio manually. This can happen if the page was open in the background before you tapped.

**Audio doesn't change when switching scenes:**
Make sure you tapped **Start Session** first. Scene changes only trigger audio after the session has started.

**Image or audio shows as "not found":**
The path in `scenes.json` doesn't match the actual file location. Paths are relative to `index.html`. Example: `"assets/images/tavern.jpg"` means the file is at `DnDCast/assets/images/tavern.jpg`.

**Works on localhost but not from the phone:**
- PC and phone must be on the same Wi-Fi.
- Use the PC's local IP address from `ipconfig`, not `localhost`.
- Check Windows Firewall settings for Python or Node.

**Screen goes dark during the session:**
Disable auto-lock in your phone's display settings before the session, or use a keep-awake app.

**Fullscreen button doesn't work on mobile:**
Some mobile browsers restrict `requestFullscreen` unless the page is added to the home screen. Mirroring the phone screen to the TV is a reliable alternative to fullscreen.

---

## Pre-Session Checklist

- [ ] Local server is running on the PC
- [ ] App opens from the phone using the PC's IP address
- [ ] **Do Not Disturb** is on
- [ ] Screen auto-lock is disabled (or keep-awake is active)
- [ ] Phone is in landscape orientation
- [ ] **Start Session** has been tapped (audio unlocked)
- [ ] Mirroring / casting is active on the TV
- [ ] Presentation mode is on (clean TV view)
