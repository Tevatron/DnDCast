import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeTestContext, login } from '../helpers/createTestApp.js';

const ctx = makeTestContext();
beforeAll(() => ctx.setup());
afterAll(() => ctx.teardown());

// Convenience: authenticated agent for each suite.
async function authedAgent() {
  const agent = request.agent(ctx.app);
  await login(agent);
  return agent;
}

describe('GET /api/data', () => {
  it('returns empty arrays when data dir has no files', async () => {
    const agent = await authedAgent();
    const res = await agent.get('/api/data');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scenes: [], sessions: [], campaigns: [] });
  });

  it('returns data from files when they exist', async () => {
    const scenes = [{ id: 'test', title: 'Test Scene' }];
    const agent = await authedAgent();
    await agent.post('/api/save').send({ scenes });
    const res = await agent.get('/api/data');
    expect(res.status).toBe(200);
    expect(res.body.scenes).toEqual(scenes);
  });
});

describe('POST /api/save', () => {
  it('saves scenes and returns ok:true', async () => {
    const agent = await authedAgent();
    const scenes = [{ id: 'scene-1', title: 'Scene One' }];
    const res = await agent.post('/api/save').send({ scenes });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('persists scenes readable via GET /api/data', async () => {
    const agent = await authedAgent();
    const sessions = [{ id: 'sess-1', title: 'Session One', scenes: [] }];
    await agent.post('/api/save').send({ sessions });
    const res = await agent.get('/api/data');
    expect(res.body.sessions).toEqual(sessions);
  });

  it('saves all three collections in one call', async () => {
    const agent = await authedAgent();
    const payload = {
      scenes:    [{ id: 'sc', title: 'S' }],
      sessions:  [{ id: 'se', title: 'S', scenes: [] }],
      campaigns: [{ id: 'ca', title: 'C' }],
    };
    await agent.post('/api/save').send(payload);
    const res = await agent.get('/api/data');
    expect(res.body.scenes).toEqual(payload.scenes);
    expect(res.body.sessions).toEqual(payload.sessions);
    expect(res.body.campaigns).toEqual(payload.campaigns);
  });

  it('partial save only overwrites supplied keys', async () => {
    const agent = await authedAgent();
    // Save initial state
    await agent.post('/api/save').send({
      scenes:    [{ id: 'original', title: 'Original' }],
      campaigns: [{ id: 'camp', title: 'Camp' }],
    });
    // Overwrite only campaigns
    await agent.post('/api/save').send({
      campaigns: [{ id: 'new-camp', title: 'New Camp' }],
    });
    const res = await agent.get('/api/data');
    // Scenes should be unchanged
    expect(res.body.scenes).toEqual([{ id: 'original', title: 'Original' }]);
    expect(res.body.campaigns).toEqual([{ id: 'new-camp', title: 'New Camp' }]);
  });
});

describe('POST /api/upload', () => {
  it('uploads an image file and returns the asset path', async () => {
    const agent = await authedAgent();
    const res = await agent
      .post('/api/upload')
      .attach('file', Buffer.from('fake-png-data'), {
        filename: 'test-image.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('assets/images/test-image.png');
  });

  it('uploads an audio file and returns the audio asset path', async () => {
    const agent = await authedAgent();
    const res = await agent
      .post('/api/upload')
      .attach('file', Buffer.from('fake-mp3-data'), {
        filename: 'test-track.mp3',
        contentType: 'audio/mpeg',
      });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe('assets/audio/test-track.mp3');
  });

  it('returns 400 when no file is attached', async () => {
    const agent = await authedAgent();
    const res = await agent.post('/api/upload');
    expect(res.status).toBe(400);
  });
});
