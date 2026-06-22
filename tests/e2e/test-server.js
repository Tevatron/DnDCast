// Starts a real HTTP server with known test credentials for Playwright e2e tests.
// Playwright's webServer config runs this before tests begin.

import bcrypt   from 'bcryptjs';
import { mkdtemp } from 'fs/promises';
import { tmpdir }  from 'os';
import { join }    from 'path';
import { createApp } from '../../server.js';

const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-test-password';
const E2E_PORT     = parseInt(process.env.E2E_PORT ?? '3999');

const config = {
  passwordHash:  bcrypt.hashSync(E2E_PASSWORD, 1),
  sessionSecret: 'e2e-session-secret',
  port:          E2E_PORT,
};

// Isolated temp dir so e2e tests don't touch the real data/ directory.
const dataDir = await mkdtemp(join(tmpdir(), 'dndcast-e2e-'));

const { app, server, resetWsState } = await createApp(config, { dataDir, inMemoryStore: true });

// Test-only routes — not mounted in production.
app.post('/_test_/reset', (req, res) => { resetWsState(); res.json({ ok: true }); });

server.listen(E2E_PORT, () => {
  console.log(`DnDCast e2e server listening on http://localhost:${E2E_PORT}`);
});
