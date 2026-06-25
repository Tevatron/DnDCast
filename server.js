// DnDCast server — Express + WebSocket relay + auth
// Run: npm start   (after npm install and node setup.js)

import express        from 'express';
import session        from 'express-session';
import FileStore      from 'session-file-store';
import bcrypt         from 'bcryptjs';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto         from 'crypto';
import multer         from 'multer';

const { compareSync } = bcrypt;
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

// ── App factory (exported for tests) ─────────────────────────────────
// opts.dataDir and opts.assetsDir let tests redirect file I/O to
// temporary directories without touching real data.

export async function createApp(config, opts = {}) {
  const dataDir     = opts.dataDir     ?? join(__dirname, 'data');
  const assetsDir   = opts.assetsDir   ?? join(__dirname, 'assets');
  const sessionsDir = opts.sessionsDir ?? join(__dirname, 'sessions');

  await mkdir(dataDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(join(assetsDir, 'images'), { recursive: true });
  await mkdir(join(assetsDir, 'audio'),  { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const sub = file.mimetype.startsWith('audio/') ? 'audio' : 'images';
        cb(null, join(assetsDir, sub));
      },
      filename: (req, file, cb) => cb(null, file.originalname),
    }),
  });

  const app    = express();
  const server = createServer(app);
  const wss    = new WebSocketServer({ noServer: true });

  const SessionFileStore = FileStore(session);
  // Tests pass inMemoryStore:true to avoid file-system session state between requests.
  const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
  const store = opts.inMemoryStore
    ? undefined
    : new SessionFileStore({ path: sessionsDir, ttl: SESSION_TTL, retries: 1, logFn: () => {} });

  // Held in a variable so the same session can be parsed on the WebSocket upgrade.
  const sessionMiddleware = session({
    ...(store ? { store } : {}),
    secret:            config.sessionSecret,
    resave:            false,
    saveUninitialized: false,
    cookie:            { sameSite: 'strict', httpOnly: true, maxAge: SESSION_TTL * 1000 },
  });

  app.use(express.json());
  app.use(sessionMiddleware);

  // ── Auth middleware ─────────────────────────────────────────────────
  // Sessions carry a role: 'dm' (full access) or 'player' (restricted). Legacy
  // sessions authed before roles existed are treated as 'dm'.
  const roleOf = req => req.session.role ?? (req.session.authed ? 'dm' : null);

  function requireAuth(req, res, next) {
    if (req.session.authed) return next();
    if (req.path === '/login') return next();
    if (req.path.startsWith('/_test_/')) return next(); // test helpers — no route exists in prod
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    res.redirect('/login');
  }

  // DM-only routes (editor, content writes). Players are authenticated but
  // forbidden here — the server is the authority, not the client's ?role= param.
  function requireDM(req, res, next) {
    if (roleOf(req) === 'dm') return next();
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Forbidden' });
    res.redirect('/');
  }

  // ── Public routes ───────────────────────────────────────────────────
  app.get('/login', (req, res) => {
    if (req.session.authed) return res.redirect('/');
    res.sendFile(join(PUBLIC_DIR, 'login.html'));
  });

  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    let role = null;
    if (password && compareSync(password, config.passwordHash)) role = 'dm';
    else if (password && config.playerPasswordHash && compareSync(password, config.playerPasswordHash)) role = 'player';
    if (!role) return res.status(401).json({ error: 'Wrong password' });
    req.session.authed = true;
    req.session.role   = role;
    res.json({ ok: true, role });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ── Protected routes ────────────────────────────────────────────────
  app.use(requireAuth);

  // API responses must never be cached — stale data causes visible bugs
  // (e.g. a cached empty adventures list after adventures.json is created).
  app.use('/api/', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  // Lets the client discover its own role so it can't self-promote to DM via the URL.
  app.get('/api/me', (req, res) => res.json({ role: roleOf(req) }));

  // Full dataset is DM-only. Player-role users never receive scene metadata
  // (titles, notes, read-aloud, other scenes) — only the live sanitized scene
  // pushed over the WebSocket. See playerView() below.
  app.get('/api/data', requireDM, async (req, res) => {
    const [scenes, adventures, campaigns] = await Promise.all([
      readJson(dataDir, 'scenes.json'),
      readJson(dataDir, 'adventures.json'),
      readJson(dataDir, 'campaigns.json'),
    ]);
    res.json({ scenes, adventures, campaigns });
  });

  app.post('/api/save', requireDM, async (req, res) => {
    const { scenes, adventures, campaigns } = req.body;
    await Promise.all([
      scenes     != null && writeJson(dataDir, 'scenes.json',     scenes),
      adventures != null && writeJson(dataDir, 'adventures.json', adventures),
      campaigns  != null && writeJson(dataDir, 'campaigns.json',  campaigns),
    ].filter(Boolean));
    contentCache = null;   // invalidate the relay's resolution cache
    res.json({ ok: true });
  });

  app.post('/api/upload', requireDM, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    const sub = req.file.mimetype.startsWith('audio/') ? 'audio' : 'images';
    res.json({ path: `assets/${sub}/${req.file.originalname}` });
  });

  // Gate the editor page itself (it's otherwise served by express.static below)
  // so player-role users can't open the editing UI at all.
  app.get('/editor.html', requireDM, (req, res) => res.sendFile(join(PUBLIC_DIR, 'editor.html')));

  app.use('/assets', express.static(assetsDir));
  app.use(express.static(PUBLIC_DIR));

  // ── WebSocket relay (per-room) ──────────────────────────────────────
  // Each room is an independent sync group with its own cached lastState and
  // client set; a DM's snapshot only reaches clients in the same room. With no
  // ?room= the client joins the 'default' room, so today everyone shares one
  // group and behaviour is unchanged — this is the seam for sharing distinct
  // adventures by id later.
  const rooms = new Map();
  function getRoom(id) {
    let room = rooms.get(id);
    if (!room) { room = { lastState: null, clients: new Set() }; rooms.set(id, room); }
    return room;
  }

  server.on('upgrade', (req, socket, head) => {
    // Authenticate via the session cookie the browser already sends. The session
    // is file-persisted, so it survives server restarts — unlike an in-memory
    // token, which left reconnecting clients permanently rejected after a restart.
    sessionMiddleware(req, {}, () => {
      if (!req.session?.authed) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const roomId = new URL(req.url, 'http://localhost').searchParams.get('room') || 'default';
      const role   = roleOf(req);
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, roomId, role));
    });
  });

  wss.on('connection', (ws, roomId, role) => {
    const room = getRoom(roomId);
    ws.role = role;
    room.clients.add(ws);

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'ping') return;   // keepalive — don't relay or cache

      if (msg.type === 'hello') {
        // Reply to the joiner with the room's current state, in the shape its
        // role is allowed to see, then poke the DM to push fresh state.
        if (room.lastState) sendState(ws, room.lastState);
        for (const client of room.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) client.send(raw.toString());
        }
        return;
      }

      // A DM state broadcast. Cache it raw; deliver per-role to everyone else.
      room.lastState = msg.stop ? null : msg;
      for (const client of room.clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) sendState(client, msg);
      }
    });

    ws.on('close', () => {
      room.clients.delete(ws);
      if (room.clients.size === 0) rooms.delete(roomId);   // GC empty rooms
    });
  });

  // Deliver a DM state object to one client. DM-role clients get it raw (they
  // already have the full dataset); player-role clients get only a sanitized,
  // server-resolved view of the active scene — no titles, notes, read-aloud,
  // ids, or any other scene.
  async function sendState(client, state) {
    if (client.role === 'player') {
      const view = await playerView(state);
      if (view) client.send(JSON.stringify(view));
    } else {
      client.send(JSON.stringify(state));
    }
  }

  // Cache of content used to resolve a scene index for players; invalidated on save.
  let contentCache = null;
  async function loadContent() {
    if (!contentCache) {
      const [scenes, adventures] = await Promise.all([
        readJson(dataDir, 'scenes.json'),
        readJson(dataDir, 'adventures.json'),
      ]);
      contentCache = { scenes, adventures };
    }
    return contentCache;
  }

  // Mirror of the client's sceneAudio (app.js): scene audio with adventure
  // soundtrack fallback. scene.silent overrides the soundtrack with silence.
  function sceneAudio(scene, adventure) {
    if (scene.silent) return { audio: null };
    if (scene.audio)  return { audio: scene.audio, loopAudio: scene.loopAudio !== false };
    if (adventure && adventure.soundtrack) return { audio: adventure.soundtrack, loopAudio: true };
    return { audio: null };
  }

  // Mirror of the client's scene-list resolution (resolveAdventureScenesForActive).
  function resolveScenes(state, scenes, adventures) {
    const id  = state.activeAdventureId;
    const pub = scenes.filter(s => !s.privateTo);   // exclude scenes private to an owner
    if (id === 'all' || !id) return pub;
    const adv = adventures.find(a => a.id === id);
    let list = adv ? (adv.scenes || []).map(sid => scenes.find(s => s.id === sid)).filter(Boolean) : pub;
    if (!list.length) list = pub;
    return list;
  }

  // The ONLY scene data a player ever receives: visuals + audio + playback flags.
  async function playerView(state) {
    if (!state || state.stop) return { type: 'view', stop: true };
    const { scenes, adventures } = await loadContent();
    const list  = resolveScenes(state, scenes, adventures);
    const scene = state.sceneIndex >= 0 ? list[state.sceneIndex] : null;
    if (!scene) return { type: 'view', waiting: true };
    const adv   = adventures.find(a => a.id === state.activeAdventureId);
    const track = sceneAudio(scene, adv);
    // Volume/mute are intentionally omitted — players control their own loudness.
    return {
      type:      'view',
      image:     scene.image ?? null,
      audio:     track.audio,
      loopAudio: track.loopAudio ?? true,
      fit:       scene.fit ?? null,
      paused:    !!state.paused,
      blackout:  !!state.blackout,
    };
  }

  function resetWsState() {
    for (const room of rooms.values()) {
      for (const client of room.clients) client.close();
    }
    rooms.clear();
  }

  return { app, server, wss, resetWsState };
}

// ── JSON helpers ──────────────────────────────────────────────────────
async function readJson(dir, filename) {
  try {
    return JSON.parse(await readFile(join(dir, filename), 'utf8'));
  } catch { return []; }
}

async function writeJson(dir, filename, data) {
  await writeFile(join(dir, filename), JSON.stringify(data, null, 2));
}

// ── First-time setup (inline) ─────────────────────────────────────────
async function runSetup() {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(q, resolve));

  console.log('\nWelcome to DnDCast! First-time setup.\n');
  const password = await ask('Choose a DM password: ');
  if (!password.trim()) { console.error('Password cannot be empty.'); process.exit(1); }
  const playerPassword = (await ask('Choose a PLAYER password (optional — blank to disable player logins): ')).trim();

  const { hashSync } = bcrypt;
  const config = {
    passwordHash:  hashSync(password, 10),
    ...(playerPassword ? { playerPasswordHash: hashSync(playerPassword, 10) } : {}),
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    port:          3000,
  };
  await writeFile(join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
  console.log('\nSetup complete!\n');
  rl.close();
  return config;
}

// ── Cloudflare Tunnel (optional) ──────────────────────────────────────
function tryStartTunnel(port) {
  import('child_process').then(({ spawn }) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = data => {
      const match = data.toString().match(/https:\/\/\S+\.trycloudflare\.com/);
      if (match) console.log(`\nPublic URL: ${match[0]}\n`);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', () => {}); // cloudflared not installed — silently skip
  });
}

// ── Entry point ───────────────────────────────────────────────────────
// Only starts listening when run directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url) || process.env.NODE_APP_INSTANCE !== undefined) {
  let config;
  try {
    config = JSON.parse(await readFile(join(__dirname, 'config.json'), 'utf8'));
  } catch {
    if (!process.stdin.isTTY) {
      console.error('config.json not found. Run "node setup.js" to create it.');
      process.exit(1);
    }
    config = await runSetup();
  }

  const { server } = await createApp(config);
  const port = config.port ?? 3000;
  server.listen(port, () => {
    console.log(`DnDCast running at http://localhost:${port}`);
    if (config.tunnel === true) tryStartTunnel(port);
  });
}
