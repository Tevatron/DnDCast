// DnDCast server — Express + WebSocket relay + auth
// Run: npm start   (after npm install and node setup.js)

import express        from 'express';
import session        from 'express-session';
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
  const dataDir   = opts.dataDir   ?? join(__dirname, 'data');
  const assetsDir = opts.assetsDir ?? join(__dirname, 'assets');

  await mkdir(dataDir, { recursive: true });
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
  const wsTokens = new Map();

  app.use(express.json());
  app.use(session({
    secret:            config.sessionSecret,
    resave:            false,
    saveUninitialized: false,
    cookie:            { sameSite: 'strict', httpOnly: true },
  }));

  // ── Auth middleware ─────────────────────────────────────────────────
  function requireAuth(req, res, next) {
    if (req.session.authed) return next();
    if (req.path === '/login') return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    res.redirect('/login');
  }

  // ── Public routes ───────────────────────────────────────────────────
  app.get('/login', (req, res) => {
    if (req.session.authed) return res.redirect('/');
    res.sendFile(join(PUBLIC_DIR, 'login.html'));
  });

  app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (!password || !compareSync(password, config.passwordHash)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    req.session.authed = true;
    const wsToken = crypto.randomBytes(16).toString('hex');
    wsTokens.set(wsToken, true);
    res.json({ ok: true, wsToken });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
  });

  // ── Protected routes ────────────────────────────────────────────────
  app.use(requireAuth);

  app.get('/api/data', async (req, res) => {
    const [scenes, sessions, campaigns] = await Promise.all([
      readJson(dataDir, 'scenes.json'),
      readJson(dataDir, 'sessions.json'),
      readJson(dataDir, 'campaigns.json'),
    ]);
    res.json({ scenes, sessions, campaigns });
  });

  app.post('/api/save', async (req, res) => {
    const { scenes, sessions, campaigns } = req.body;
    await Promise.all([
      scenes    != null && writeJson(dataDir, 'scenes.json',    scenes),
      sessions  != null && writeJson(dataDir, 'sessions.json',  sessions),
      campaigns != null && writeJson(dataDir, 'campaigns.json', campaigns),
    ].filter(Boolean));
    res.json({ ok: true });
  });

  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    const sub = req.file.mimetype.startsWith('audio/') ? 'audio' : 'images';
    res.json({ path: `assets/${sub}/${req.file.originalname}` });
  });

  app.use('/assets', express.static(assetsDir));
  app.use(express.static(PUBLIC_DIR));

  // ── WebSocket relay ─────────────────────────────────────────────────
  let lastState = null;
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    const url   = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('t');
    if (!token || !wsTokens.has(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });

  wss.on('connection', ws => {
    clients.add(ws);

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'hello') {
        if (lastState) ws.send(JSON.stringify(lastState));
        relay(ws, raw);
        return;
      }

      lastState = msg.stop ? null : msg;
      relay(ws, raw);
    });

    ws.on('close', () => clients.delete(ws));
  });

  function relay(sender, raw) {
    const str = raw.toString();
    for (const client of clients) {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(str);
      }
    }
  }

  return { app, server, wss, wsTokens };
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

// ── Entry point ───────────────────────────────────────────────────────
// Only start listening when run directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let config;
  try {
    config = JSON.parse(await readFile(join(__dirname, 'config.json'), 'utf8'));
  } catch {
    console.error('config.json not found. Run "node setup.js" first.');
    process.exit(1);
  }
  const { server } = await createApp(config);
  const port = config.port ?? 3000;
  server.listen(port, () => {
    console.log(`DnDCast running at http://localhost:${port}`);
    console.log('Expose publicly: cloudflared tunnel --url http://localhost:' + port);
  });
}
