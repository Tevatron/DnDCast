import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { makeTestContext, login } from '../helpers/createTestApp.js';

const ctx = makeTestContext();
beforeAll(() => ctx.setup());
afterAll(() => ctx.teardown());

function wsUrl(port) {
  return `ws://localhost:${port}/ws`;
}

// Connect a WebSocket (authenticated via session cookie) and wait for open or fail.
function connect(port, cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(port), { headers: cookie ? { Cookie: cookie } : {} });
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
