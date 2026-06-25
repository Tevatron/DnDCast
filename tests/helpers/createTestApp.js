// Shared test helper — creates a fully wired app with a known test password
// and an isolated temp directory for data files.

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import { createApp } from '../../server.js';

export const TEST_PASSWORD        = 'test-password-correct';
export const TEST_PLAYER_PASSWORD = 'test-player-password';

// Pre-hash with cost factor 1 for test speed (bcrypt is slow by design).
export const TEST_CONFIG = {
  passwordHash:       bcrypt.hashSync(TEST_PASSWORD, 1),
  playerPasswordHash: bcrypt.hashSync(TEST_PLAYER_PASSWORD, 1),
  sessionSecret:      'test-session-secret-not-for-production',
  port:               0,
};

// Creates an isolated app + temp data directory.
// Call setup/teardown in beforeAll/afterAll.
export function makeTestContext() {
  let dataDir, app, server;

  async function setup() {
    dataDir = await mkdtemp(join(tmpdir(), 'dndcast-test-'));
    ({ app, server } = await createApp(TEST_CONFIG, { dataDir, inMemoryStore: true }));
    await new Promise(resolve => server.listen(0, resolve));
  }

  async function teardown() {
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }

  return {
    setup,
    teardown,
    get app()      { return app; },
    get server()   { return server; },
    get port()     { return server.address().port; },
    get dataDir()  { return dataDir; },
  };
}

// Log in via the API (DM by default; pass TEST_PLAYER_PASSWORD for a player).
// Returns a Cookie-header string for the session, so a raw `ws` client can
// authenticate its upgrade the same way a browser would.
export async function login(agent, password = TEST_PASSWORD) {
  const res = await agent
    .post('/api/login')
    .send({ password });
  const setCookie = res.headers['set-cookie'] ?? [];
  return setCookie.map(c => c.split(';')[0]).join('; ');
}
