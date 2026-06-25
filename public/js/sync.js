// sync.js — WebSocket-based DM/Cast sync
//
// Same external interface as before: createSync(role, { onState, onHello, onOpen })
// returns { post(snapshot), requestState() }.
//
// DM posts state snapshots; server relays to all cast clients.
// Cast clients send { type:'hello' }; server replies with cached state
// and relays the hello to DM for a fresh snapshot.
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
    const token    = localStorage.getItem('dndcast_wsToken') ?? '';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws?t=${encodeURIComponent(token)}`);

    let didOpen = false;
    ws.addEventListener('open', () => {
      didOpen = true;
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
      if (!didOpen) {
        // Connection was rejected before the handshake completed — token is likely
        // stale after a server restart. Try to reissue via the existing session.
        fetch('/api/ws-token', { method: 'POST' })
          .then(r => r.ok ? r.json() : Promise.reject())
          .then(({ wsToken }) => { localStorage.setItem('dndcast_wsToken', wsToken); connect(); })
          .catch(() => { location.href = '/login'; });
        return;
      }
      setTimeout(connect, 2000);
    });
    ws.addEventListener('error', () => ws?.close());
  }

  connect();
  return api;
}
