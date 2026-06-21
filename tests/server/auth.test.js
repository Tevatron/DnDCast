import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeTestContext, TEST_PASSWORD, login } from '../helpers/createTestApp.js';

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

  it('returns ok:true and a wsToken for correct password', async () => {
    const res = await request(ctx.app)
      .post('/api/login')
      .send({ password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.wsToken).toBe('string');
    expect(res.body.wsToken.length).toBe(32); // 16 bytes hex = 32 chars
  });

  it('registers the wsToken in the server token map', async () => {
    const res = await request(ctx.app)
      .post('/api/login')
      .send({ password: TEST_PASSWORD });
    expect(ctx.wsTokens.has(res.body.wsToken)).toBe(true);
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
