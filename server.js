// DnDCast server — Express + WebSocket relay + auth
// Run: npm start   (after npm install and node setup.js)

import express        from 'express';
import session        from 'express-session';
import bcrypt from 'bcryptjs';
const { compareSync } = bcrypt;
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import multer from 'multer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dirname, 'data');
const PUBLIC_DIR = join(__dirname, 'public');
const ASSETS_DIR = join(__dirname, 'assets');

// ── Config ────────────────────────────────────────────────────────────
let config;
try {
  config = JSON.parse(await readFile(join(__dirname, 'config.json'), 'utf8'));
} catch {
  console.error('config.json not found. Run "node setup.js" first.');
  process.exit(1);
}

await mkdir(DATA_DIR, { recursive: true });
await mkdir(join(ASSETS_DIR, 'images'), { recursive: true });
await mkdir(join(ASSETS_DIR, 'audio'),  { recursive: true });

// Multer: route uploaded files into assets/images or assets/audio by MIME type.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const sub = file.mimetype.startsWith('audio/') ? 'audio' : 'images';
      cb(null, join(ASSETS_DIR, sub));
    },
    filename: (req, file, cb) => cb(null, file.originalname),
  }),
});

// ── App ───────────────────────────────────────────────────────────────
const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ noServer: true });

app.use(express.json());
app.use(session({
  secret:            config.sessionSecret,
  resave:            false,
  saveUninitialized: false,
  cookie:            { sameSite: 'strict', httpOnly: true },
}));

// ── Auth middleware ───────────────────────────────────────────────────
const wsTokens = new Map(); // token → true (set on login, cleared on logout)

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  if (req.path === '/login') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  res.redirect('/login');
}

// ── Auth routes (no auth required) ───────────────────────────────────
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

// ── Protected routes ──────────────────────────────────────────────────
app.use(requireAuth);

app.get('/api/data', async (req, res) => {
  const [scenes, sessions, campaigns] = await Promise.all([
    readJson('scenes.json'),
    readJson('sessions.json'),
    readJson('campaigns.json'),
  ]);
  res.json({ scenes, sessions, campaigns });
});

app.post('/api/save', async (req, res) => {
  const { scenes, sessions, campaigns } = req.body;
  await Promise.all([
    scenes    != null && writeJson('scenes.json',    scenes),
    sessions  != null && writeJson('sessions.json',  sessions),
    campaigns != null && writeJson('campaigns.json', campaigns),
  ].filter(Boolean));
  res.json({ ok: true });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const sub  = req.file.mimetype.startsWith('audio/') ? 'audio' : 'images';
  res.json({ path: `assets/${sub}/${req.file.originalname}` });
});

// Serve static files and assets
app.use('/assets', express.static(ASSETS_DIR));
app.use(express.static(PUBLIC_DIR));

// ── WebSocket relay ───────────────────────────────────────────────────
// Server stores the last DM state and relays messages between DM and cast clients.
// Auth: login provides a short-lived wsToken passed as ?t= on connect.

let lastState = null;
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  const url   = new URL(req.url, `http://localhost`);
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
      // Cast client announcing itself — send cached state immediately for fast load,
      // then relay the hello to DM so it can push a fresh snapshot too.
      if (lastState) ws.send(JSON.stringify(lastState));
      relay(ws, raw);
      return;
    }

    // DM state snapshot — cache and fan out to all cast clients.
    lastState = msg.stop ? null : msg;
    relay(ws, raw);
  });

  ws.on('close', () => clients.delete(ws));
});

function relay(sender, raw) {
  const str = raw.toString();   // Buffer → UTF-8 string; browsers need text frames
  for (const client of clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(str);
    }
  }
}

// ── JSON helpers ──────────────────────────────────────────────────────
async function readJson(filename) {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, filename), 'utf8'));
  } catch { return []; }
}

async function writeJson(filename, data) {
  await writeFile(join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// ── Start ─────────────────────────────────────────────────────────────
const port = config.port ?? 3000;
server.listen(port, () => {
  console.log(`DnDCast running at http://localhost:${port}`);
  console.log('Expose publicly: cloudflared tunnel --url http://localhost:' + port);
});
