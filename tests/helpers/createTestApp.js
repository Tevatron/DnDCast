// Shared test helper — creates a fully wired app with a known test password
// and an isolated temp directory for data files.

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import bcrypt from 'bcryptjs';
import { createApp } from '../../server.js';

export const TEST_PASSWORD = 'test-password-correct';

// Pre-hash with cost factor 1 for test speed (bcrypt is slow by design).
export const TEST_CONFIG = {
  passwordHash:  bcrypt.hashSync(TEST_PASSWORD, 1),
  sessionSecret: 'test-session-secret-not-for-production',
  port:          0,
};

// Creates an isolated app + temp data directory.
// Call setup/teardown in beforeAll/afterAll.
export function makeTestContext() {
  let dataDir, app, server, wsTokens;

  async function setup() {
    dataDir = await mkdtemp(join(tmpdir(), 'dndcast-test-'));
    ({ app, server, wsTokens } = await createApp(TEST_CONFIG, { dataDir }));
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
    get wsTokens() { return wsTokens; },
    get port()     { return server.address().port; },
  };
}

// Log in via the API and return the agent (cookie jar) + wsToken.
export async function login(agent) {
  const res = await agent
    .post('/api/login')
    .send({ password: TEST_PASSWORD });
  return res.body.wsToken;
}
