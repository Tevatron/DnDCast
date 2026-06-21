import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { makeTestContext, login } from '../helpers/createTestApp.js';

const ctx = makeTestContext();
beforeAll(() => ctx.setup());
afterAll(() => ctx.teardown());

function wsUrl(port, token) {
  return `ws://localhost:${port}/ws?t=${token}`;
}

// Connect a WebSocket and wait for it to open (or fail).
function connect(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl(port, token));
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

async function getToken() {
  const agent = request.agent(ctx.app);
  return login(agent);
}

describe('WebSocket auth', () => {
  it('rejects connection with no token', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${ctx.port}/ws`);
        ws.once('open',  () => { ws.close(); reject(new Error('Should not open')); });
        ws.once('error', resolve);
        ws.once('close', () => resolve()); // server destroyed socket
      })
    ).resolves.not.toThrow();
  });

  it('rejects connection with an invalid token', async () => {
    await expect(connect(ctx.port, 'not-a-real-token-abc123')).rejects.toThrow();
  });

  it('accepts connection with a valid token', async () => {
    const token = await getToken();
    const ws = await connect(ctx.port, token);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});

describe('WebSocket relay', () => {
  it('relays a state snapshot from DM to cast client', async () => {
    const [tokenA, tokenB] = await Promise.all([getToken(), getToken()]);
    const dmWs   = await connect(ctx.port, tokenA);
    const castWs = await connect(ctx.port, tokenB);

    const snapshot = { activeSessionId: 'sess-1', sceneIndex: 2, paused: false };
    const receivedPromise = waitForMessage(castWs);

    dmWs.send(JSON.stringify(snapshot));
    const received = await receivedPromise;

    expect(received).toEqual(snapshot);
    dmWs.close();
    castWs.close();
  });

  it('does not echo messages back to the sender', async () => {
    const token = await getToken();
    const ws = await connect(ctx.port, token);

    let gotEcho = false;
    ws.on('message', () => { gotEcho = true; });

    ws.send(JSON.stringify({ sceneIndex: 0 }));
    await new Promise(r => setTimeout(r, 100)); // give server time to relay

    expect(gotEcho).toBe(false);
    ws.close();
  });

  it('sends cached lastState to a cast client that says hello', async () => {
    const [tokenA, tokenB] = await Promise.all([getToken(), getToken()]);
    const dmWs = await connect(ctx.port, tokenA);

    // DM broadcasts a state
    const state = { activeSessionId: 'sess-2', sceneIndex: 3 };
    dmWs.send(JSON.stringify(state));
    await new Promise(r => setTimeout(r, 50)); // let server store lastState

    // Cast client joins late and sends hello
    const castWs = await connect(ctx.port, tokenB);
    const receivedPromise = waitForMessage(castWs);
    castWs.send(JSON.stringify({ type: 'hello' }));

    const received = await receivedPromise;
    expect(received).toEqual(state);

    dmWs.close();
    castWs.close();
  });

  it('relays hello from cast to DM so DM can push fresh state', async () => {
    const [tokenA, tokenB] = await Promise.all([getToken(), getToken()]);
    const dmWs   = await connect(ctx.port, tokenA);
    const castWs = await connect(ctx.port, tokenB);

    const helloReceivedPromise = waitForMessage(dmWs);
    castWs.send(JSON.stringify({ type: 'hello' }));
    const msg = await helloReceivedPromise;

    expect(msg.type).toBe('hello');
    dmWs.close();
    castWs.close();
  });

  it('clears lastState when DM sends stop', async () => {
    const [tokenA, tokenB, tokenC] = await Promise.all([
      getToken(), getToken(), getToken(),
    ]);
    const dmWs = await connect(ctx.port, tokenA);

    // Establish a state then clear it
    dmWs.send(JSON.stringify({ sceneIndex: 1 }));
    await new Promise(r => setTimeout(r, 50));
    dmWs.send(JSON.stringify({ stop: true }));
    await new Promise(r => setTimeout(r, 50));

    // New cast client says hello — should receive nothing (no lastState)
    const castWs = await connect(ctx.port, tokenC);
    let gotMessage = false;
    castWs.on('message', () => { gotMessage = true; });
    castWs.send(JSON.stringify({ type: 'hello' }));
    await new Promise(r => setTimeout(r, 100));

    expect(gotMessage).toBe(false);
    dmWs.close();
    castWs.close();
  });
});
