import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeTestContext, TEST_PASSWORD, TEST_PLAYER_PASSWORD, login } from '../helpers/createTestApp.js';

const ctx = makeTestContext();
beforeAll(() => ctx.setup());
afterAll(() => ctx.teardown());

describe('Unauthenticated access', () => {
  it('redirects GET / to /login', async () => {
    const res = await request(ctx.app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('redirects GET /player.html to /login', async () => {
    const res = await request(ctx.app).get('/player.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('returns 401 JSON for unauthenticated GET /api/data', async () => {
    const res = await request(ctx.app).get('/api/data');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 JSON for unauthenticated POST /api/save', async () => {
    const res = await request(ctx.app).post('/api/save').send({});
    expect(res.status).toBe(401);
  });

  it('serves /login without auth', async () => {
    const res = await request(ctx.app).get('/login');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/login', () => {
  it('returns 401 for wrong password', async () => {
    const res = await request(ctx.app)
      .post('/api/login')
      .send({ password: 'definitely-wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Wrong password');
  });

  it('returns 401 for missing password', async () => {
    const res = await request(ctx.app)
      .post('/api/login')
      .send({});
    expect(res.status).toBe(401);
  });

  it('returns ok:true and sets a session cookie for correct password', async () => {
    const res = await request(ctx.app)
      .post('/api/login')
      .send({ password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/connect\.sid=/);
  });
});

describe('Session-protected routes', () => {
  it('allows access to /api/data after login', async () => {
    const agent = request.agent(ctx.app);
    await login(agent);
    const res = await agent.get('/api/data');
    expect(res.status).toBe(200);
  });

  it('redirects authenticated user from /login to /', async () => {
    const agent = request.agent(ctx.app);
    await login(agent);
    const res = await agent.get('/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('loses access after logout', async () => {
    const agent = request.agent(ctx.app);
    await login(agent);

    await agent.post('/api/logout');

    const res = await agent.get('/api/data');
    expect(res.status).toBe(401);
  });
});

describe('Roles & access control', () => {
  it('assigns role "dm" for the DM password', async () => {
    const res = await request(ctx.app).post('/api/login').send({ password: TEST_PASSWORD });
    expect(res.body.role).toBe('dm');
  });

  it('assigns role "player" for the player password', async () => {
    const res = await request(ctx.app).post('/api/login').send({ password: TEST_PLAYER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('player');
  });

  it('/api/me reports the session role', async () => {
    const dm = request.agent(ctx.app);
    await login(dm);
    expect((await dm.get('/api/me')).body.role).toBe('dm');

    const player = request.agent(ctx.app);
    await login(player, TEST_PLAYER_PASSWORD);
    expect((await player.get('/api/me')).body.role).toBe('player');
  });

  it('forbids player-role from /api/data, /api/save, and /api/upload', async () => {
    const player = request.agent(ctx.app);
    await login(player, TEST_PLAYER_PASSWORD);
    expect((await player.get('/api/data')).status).toBe(403);
    expect((await player.post('/api/save').send({ scenes: [] })).status).toBe(403);
    expect((await player.post('/api/upload')).status).toBe(403);
  });

  it('redirects player-role away from the editor page', async () => {
    const player = request.agent(ctx.app);
    await login(player, TEST_PLAYER_PASSWORD);
    const res = await player.get('/editor.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('allows DM-role to reach /api/save and the editor page', async () => {
    const dm = request.agent(ctx.app);
    await login(dm);
    expect((await dm.post('/api/save').send({})).status).toBe(200);
    expect((await dm.get('/editor.html')).status).toBe(200);
  });
});
