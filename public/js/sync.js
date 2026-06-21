// sync.js — WebSocket-based DM/Cast sync
//
// Same external interface as before: createSync(role, { onState, onHello })
// returns { post(snapshot), requestState() }.
//
// DM posts state snapshots; server relays to all cast clients.
// Cast clients send { type:'hello' }; server replies with cached state
// and relays the hello to DM for a fresh snapshot.
// Auto-reconnects on disconnect with 2s backoff.

export function createSync(role, handlers = {}) {
  const { onState, onHello } = handlers;
  let ws = null;

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

    ws.addEventListener('open', () => {
      if (role === 'player') api.requestState();
    });

    ws.addEventListener('message', e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'hello') { if (onHello) onHello(); }
      else                      { if (onState) onState(msg); }
    });

    ws.addEventListener('close', () => { ws = null; setTimeout(connect, 2000); });
    ws.addEventListener('error', () => ws?.close());
  }

  connect();
  return api;
}
