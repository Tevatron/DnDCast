import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { makeTestContext, login, TEST_PLAYER_PASSWORD } from '../helpers/createTestApp.js';

const ctx = makeTestContext();
beforeAll(() => ctx.setup());
afterAll(() => ctx.teardown());

function wsUrl(port, room) {
  return room ? `ws://localhost:${port}/ws?room=${encodeURIComponent(room)}`
              : `ws://localhost:${port}/ws`;
}

// Connect a WebSocket (authenticated via session cookie) and wait for open or fail.
// Pass a room to join a specific sync group; omit it to join the 'default' room.
function connect(port, cookie, room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(port, room), { headers: cookie ? { Cookie: cookie } : {} });
    ws.once('open',  () => resolve(ws));
    ws.once('error', reject);
    // If server closes immediately (401), treat as rejection
    ws.once('close', (code) => {
      if (code !== 1000) reject(new Error('Connection closed with code ' + code));
    });
  });
}

// Send a message and wait for a response on a target socket.
function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), 2000);
    ws.once('message', data => { clearTimeout(timer); resolve(JSON.parse(data.toString())); });
  });
}

async function getCookie() {
  const agent = request.agent(ctx.app);
  return login(agent);
}

describe('WebSocket auth', () => {
  it('rejects connection with no session cookie', async () => {
    await expect(connect(ctx.port, '')).rejects.toThrow();
  });

  it('rejects connection with an invalid session cookie', async () => {
    await expect(connect(ctx.port, 'connect.sid=s%3Abogus.invalid')).rejects.toThrow();
  });

  it('accepts connection with a valid session cookie', async () => {
    const cookie = await getCookie();
    const ws = await connect(ctx.port, cookie);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

describe('WebSocket relay', () => {
  it('relays a state snapshot from DM to cast client', async () => {
    const [cookieA, cookieB] = await Promise.all([getCookie(), getCookie()]);
    const dmWs   = await connect(ctx.port, cookieA);
    const castWs = await connect(ctx.port, cookieB);

    const snapshot = { activeAdventureId: 'adv-1', sceneIndex: 2, paused: false };
    const receivedPromise = waitForMessage(castWs);

    dmWs.send(JSON.stringify(snapshot));
    const received = await receivedPromise;

    expect(received).toEqual(snapshot);
    dmWs.close();
    castWs.close();
  });

  it('does not echo messages back to the sender', async () => {
    const cookie = await getCookie();
    const ws = await connect(ctx.port, cookie);

    let gotEcho = false;
    ws.on('message', () => { gotEcho = true; });

    ws.send(JSON.stringify({ sceneIndex: 0 }));
    await new Promise(r => setTimeout(r, 100)); // give server time to relay

    expect(gotEcho).toBe(false);
    ws.close();
  });

  it('sends cached lastState to a cast client that says hello', async () => {
    const [cookieA, cookieB] = await Promise.all([getCookie(), getCookie()]);
    const dmWs = await connect(ctx.port, cookieA);

    // DM broadcasts a state
    const state = { activeAdventureId: 'adv-2', sceneIndex: 3 };
    dmWs.send(JSON.stringify(state));
    await new Promise(r => setTimeout(r, 50)); // let server store lastState

    // Cast client joins late and sends hello
    const castWs = await connect(ctx.port, cookieB);
    const receivedPromise = waitForMessage(castWs);
    castWs.send(JSON.stringify({ type: 'hello' }));

    const received = await receivedPromise;
    expect(received).toEqual(state);

    dmWs.close();
    castWs.close();
  });

  it('relays hello from cast to DM so DM can push fresh state', async () => {
    const [cookieA, cookieB] = await Promise.all([getCookie(), getCookie()]);
    const dmWs   = await connect(ctx.port, cookieA);
    const castWs = await connect(ctx.port, cookieB);

    const helloReceivedPromise = waitForMessage(dmWs);
    castWs.send(JSON.stringify({ type: 'hello' }));
    const msg = await helloReceivedPromise;

    expect(msg.type).toBe('hello');
    dmWs.close();
    castWs.close();
  });

  it('clears lastState when DM sends stop', async () => {
    const [cookieA, cookieC] = await Promise.all([getCookie(), getCookie()]);
    const dmWs = await connect(ctx.port, cookieA);

    // Establish a state then clear it
    dmWs.send(JSON.stringify({ sceneIndex: 1 }));
    await new Promise(r => setTimeout(r, 50));
    dmWs.send(JSON.stringify({ stop: true }));
    await new Promise(r => setTimeout(r, 50));

    // New cast client says hello — should receive nothing (no lastState)
    const castWs = await connect(ctx.port, cookieC);
    let gotMessage = false;
    castWs.on('message', () => { gotMessage = true; });
    castWs.send(JSON.stringify({ type: 'hello' }));
    await new Promise(r => setTimeout(r, 100));

    expect(gotMessage).toBe(false);
    dmWs.close();
    castWs.close();
  });
});

describe('WebSocket rooms', () => {
  it('does not relay between different rooms', async () => {
    const [cookieA, cookieB, cookieC] = await Promise.all([getCookie(), getCookie(), getCookie()]);
    const dmA   = await connect(ctx.port, cookieA, 'room-1');
    const castA = await connect(ctx.port, cookieB, 'room-1');
    const castB = await connect(ctx.port, cookieC, 'room-2');

    // A listener in the other room must never receive room-1 traffic.
    let leaked = false;
    castB.on('message', () => { leaked = true; });

    const received = waitForMessage(castA);
    dmA.send(JSON.stringify({ sceneIndex: 5 }));
    expect(await received).toEqual({ sceneIndex: 5 });

    await new Promise(r => setTimeout(r, 100));
    expect(leaked).toBe(false);

    dmA.close();
    castA.close();
    castB.close();
  });

  it('caches lastState independently per room', async () => {
    const [cookieA, cookieB] = await Promise.all([getCookie(), getCookie()]);
    const dm = await connect(ctx.port, cookieA, 'room-x');
    dm.send(JSON.stringify({ sceneIndex: 7 }));
    await new Promise(r => setTimeout(r, 50)); // let server store lastState for room-x

    // A late joiner in a DIFFERENT room says hello — gets no cached state.
    const otherRoom = await connect(ctx.port, cookieB, 'room-y');
    let got = false;
    otherRoom.on('message', () => { got = true; });
    otherRoom.send(JSON.stringify({ type: 'hello' }));
    await new Promise(r => setTimeout(r, 100));

    expect(got).toBe(false);
    dm.close();
    otherRoom.close();
  });
});

describe('Player-role sanitized view', () => {
  async function cookie(password) {
    return login(request.agent(ctx.app), password);
  }

  it('sends players only visuals/audio + playback — never titles, notes, or read-aloud', async () => {
    // Seed spoilery content as DM.
    const dmAgent = request.agent(ctx.app);
    await login(dmAgent);
    await dmAgent.post('/api/save').send({
      scenes: [{ id: 'boss', title: 'The Lich King', image: 'assets/images/lich.jpg',
                 audio: 'assets/audio/doom.mp3', notes: 'SECRET', dmScript: 'Read this aloud', loopAudio: true }],
      adventures: [{ id: 'adv', title: 'Campaign', scenes: ['boss'] }],
    });

    const player = await connect(ctx.port, await cookie(TEST_PLAYER_PASSWORD), 'sanitize-room');
    const dm     = await connect(ctx.port, await cookie(),                    'sanitize-room');

    const received = waitForMessage(player);
    dm.send(JSON.stringify({
      activeAdventureId: 'adv', sceneIndex: 0, paused: false,
      volume: 1, muted: false, blackout: false, titleVisible: true,
    }));
    const view = await received;

    expect(view).toEqual({
      type: 'view', image: 'assets/images/lich.jpg', audio: 'assets/audio/doom.mp3',
      loopAudio: true, fit: null, paused: false, blackout: false,
    });
    // Belt-and-suspenders: no spoiler fields leaked.
    for (const k of ['title', 'notes', 'dmScript', 'id', 'sceneIndex', 'activeAdventureId', 'titleVisible']) {
      expect(view[k]).toBeUndefined();
    }

    player.close();
    dm.close();
  });

  it('falls back to the adventure soundtrack, but honors a scene custom track and silent override', async () => {
    const dmAgent = request.agent(ctx.app);
    await login(dmAgent);
    await dmAgent.post('/api/save').send({
      scenes: [
        { id: 'a', image: 'img/a.jpg' },                                   // no audio → soundtrack
        { id: 'b', image: 'img/b.jpg', audio: 'assets/audio/b.mp3' },      // custom track wins
        { id: 'c', image: 'img/c.jpg', silent: true },                     // silent overrides soundtrack
      ],
      adventures: [{ id: 'adv', title: 'A', scenes: ['a', 'b', 'c'], soundtrack: 'assets/audio/theme.mp3' }],
    });

    const player = await connect(ctx.port, await cookie(TEST_PLAYER_PASSWORD), 'st-room');
    const dm     = await connect(ctx.port, await cookie(),                    'st-room');

    async function viewFor(sceneIndex) {
      const received = waitForMessage(player);
      dm.send(JSON.stringify({ activeAdventureId: 'adv', sceneIndex, paused: false }));
      return received;
    }

    expect(await viewFor(0)).toMatchObject({ audio: 'assets/audio/theme.mp3', loopAudio: true }); // fallback
    expect(await viewFor(1)).toMatchObject({ audio: 'assets/audio/b.mp3' });                       // custom
    expect(await viewFor(2)).toMatchObject({ audio: null });                                       // silent

    player.close();
    dm.close();
  });

  it('excludes scenes private to an owner from the "all scenes" pool', async () => {
    const dmAgent = request.agent(ctx.app);
    await login(dmAgent);
    await dmAgent.post('/api/save').send({
      scenes: [
        { id: 'pub1', image: 'img/1.jpg' },
        { id: 'secret', image: 'img/secret.jpg', privateTo: 'some-campaign' },
        { id: 'pub2', image: 'img/2.jpg' },
      ],
      adventures: [],
    });

    const player = await connect(ctx.port, await cookie(TEST_PLAYER_PASSWORD), 'priv-room');
    const dm     = await connect(ctx.port, await cookie(),                    'priv-room');

    async function viewFor(sceneIndex) {
      const received = waitForMessage(player);
      dm.send(JSON.stringify({ activeAdventureId: 'all', sceneIndex, paused: false }));
      return received;
    }

    // The private scene is skipped, so the pool is [pub1, pub2] — index 1 is pub2.
    expect(await viewFor(0)).toMatchObject({ image: 'img/1.jpg' });
    expect(await viewFor(1)).toMatchObject({ image: 'img/2.jpg' });

    player.close();
    dm.close();
  });

  it('resolves the active image within a multi-image scene by imageIndex', async () => {
    const dmAgent = request.agent(ctx.app);
    await login(dmAgent);
    await dmAgent.post('/api/save').send({
      scenes: [{ id: 'gallery', images: ['img/a.jpg', 'img/b.jpg', 'img/c.jpg'] }],
      adventures: [{ id: 'adv', title: 'A', scenes: ['gallery'] }],
    });

    const player = await connect(ctx.port, await cookie(TEST_PLAYER_PASSWORD), 'img-room');
    const dm     = await connect(ctx.port, await cookie(),                    'img-room');

    async function imageAt(imageIndex) {
      const received = waitForMessage(player);
      dm.send(JSON.stringify({ activeAdventureId: 'adv', sceneIndex: 0, imageIndex, paused: false }));
      return (await received).image;
    }

    expect(await imageAt(0)).toBe('img/a.jpg');
    expect(await imageAt(2)).toBe('img/c.jpg');
    expect(await imageAt(9)).toBe('img/c.jpg');   // clamped to the last image

    player.close();
    dm.close();
  });

  it('tells players to wait when the DM has no scene selected', async () => {
    const player = await connect(ctx.port, await cookie(TEST_PLAYER_PASSWORD), 'wait-room');
    const dm     = await connect(ctx.port, await cookie(),                    'wait-room');

    const received = waitForMessage(player);
    dm.send(JSON.stringify({ activeAdventureId: 'adv', sceneIndex: -1, paused: true, volume: 1 }));
    expect(await received).toEqual({ type: 'view', waiting: true });

    player.close();
    dm.close();
  });
});
