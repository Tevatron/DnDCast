import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { makeTestContext, login, TEST_PLAYER_PASSWORD } from '../helpers/createTestApp.js';

const ctx = makeTestContext();
beforeAll(() => ctx.setup());
afterAll(() => ctx.teardown());

function dm() {
  const agent = request.agent(ctx.app);
  return login(agent).then(() => agent);
}

describe('Ad-hoc notes API', () => {
  it('lets a DM create, list, update, and delete a note', async () => {
    const agent = await dm();

    // Create
    const created = await agent.post('/api/notes')
      .send({ scope: 'campaign', scopeId: 'camp-1', title: '  Prophecy  ', body: '  remember the prophecy  ' });
    expect(created.status).toBe(200);
    const note = created.body.note;
    expect(note.id).toBeTruthy();
    expect(note.scope).toBe('campaign');
    expect(note.scopeId).toBe('camp-1');
    expect(note.title).toBe('Prophecy');               // trimmed
    expect(note.body).toBe('remember the prophecy');   // trimmed
    expect(note.authorId).toBe('dm-superuser');         // placeholder owner
    expect(note.createdAt).toBeTruthy();

    // List
    const listed = await agent.get('/api/notes');
    expect(listed.status).toBe(200);
    expect(listed.body.notes.some(n => n.id === note.id)).toBe(true);

    // Update
    const updated = await agent.put('/api/notes/' + note.id).send({ body: 'changed' });
    expect(updated.status).toBe(200);
    expect(updated.body.note.body).toBe('changed');
    expect(updated.body.note.updatedAt).not.toBe(note.createdAt);

    // Delete
    const deleted = await agent.delete('/api/notes/' + note.id);
    expect(deleted.status).toBe(200);
    const after = await agent.get('/api/notes');
    expect(after.body.notes.some(n => n.id === note.id)).toBe(false);
  });

  it('rejects invalid note payloads', async () => {
    const agent = await dm();
    expect((await agent.post('/api/notes').send({ scope: 'bogus', scopeId: 'x', body: 'hi' })).status).toBe(400);
    expect((await agent.post('/api/notes').send({ scope: 'scene', body: 'hi' })).status).toBe(400);   // no scopeId
    expect((await agent.post('/api/notes').send({ scope: 'scene', scopeId: 's', body: '   ' })).status).toBe(400);
  });

  it('404s when updating or deleting a missing note', async () => {
    const agent = await dm();
    expect((await agent.put('/api/notes/nope').send({ body: 'x' })).status).toBe(404);
    expect((await agent.delete('/api/notes/nope')).status).toBe(404);
  });

  it('forbids player-role users from the notes API', async () => {
    const agent = request.agent(ctx.app);
    await login(agent, TEST_PLAYER_PASSWORD);
    expect((await agent.get('/api/notes')).status).toBe(403);
    expect((await agent.post('/api/notes').send({ scope: 'scene', scopeId: 's', body: 'hi' })).status).toBe(403);
  });
});
