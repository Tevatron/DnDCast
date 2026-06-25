// sync.js — WebSocket-based DM/Cast sync
//
// Same external interface as before: createSync(role, { onState, onHello, onOpen })
// returns { post(snapshot), requestState() }.
//
// DM posts state snapshots; server relays to all cast clients.
// Cast clients send { type:'hello' }; server replies with cached state
// and relays the hello to DM for a fresh snapshot.
// The WebSocket upgrade is authenticated by the session cookie the browser
// sends automatically — no token needed, so reconnects survive server restarts.
// Auto-reconnects on disconnect with 2s backoff.
// Sends a keepalive ping every 30s to prevent Cloudflare's 100s idle timeout.

export function createSync(role, handlers = {}) {
  const { onState, onHello, onOpen } = handlers;
  let ws = null;
  let pingInterval = null;

  const api = {
    post(snapshot) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(snapshot));
    },
    requestState() {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'hello' }));
    },
  };

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.addEventListener('open', () => {
      if (role === 'player') api.requestState();
      if (onOpen) onOpen();
      pingInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 30000);
    });

    ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'hello') { if (onHello) onHello(); }
      else                      { if (onState) onState(msg); }
    });

    ws.addEventListener('close', () => {
      clearInterval(pingInterval);
      pingInterval = null;
      ws = null;
      setTimeout(connect, 2000);
    });
    ws.addEventListener('error', () => ws?.close());
  }

  connect();
  return api;
}
