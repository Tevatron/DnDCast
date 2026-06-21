// =====================================================================
// sync.js — cross-tab state sync between the DM tab and the Player tab.
//
// Same-origin tabs in the same browser only (no backend). Uses
// BroadcastChannel, with a localStorage 'storage'-event fallback for
// browsers that lack it. DM posts state snapshots; Player applies them
// and only ever posts a 'hello' to request the current state on load.
// =====================================================================

const CHANNEL  = 'dndcast';
const LS_KEY   = 'dndcast_sync';

export function createSync(role, handlers = {}) {
  const { onState, onHello } = handlers;
  let seq      = 0;          // outgoing sequence number
  let lastSeen = -1;         // highest incoming seq applied (dedupe)

  let channel = null;
  try { channel = new BroadcastChannel(CHANNEL); } catch (_) { /* fallback only */ }

  function deliver(msg) {
    if (!msg || msg.role === role) return;            // ignore our own messages
    if (typeof msg.seq === 'number') {
      if (msg.seq <= lastSeen) return;                // stale / duplicate
      lastSeen = msg.seq;
    }
    if (msg.type === 'state' && onState) onState(msg.payload);
    if (msg.type === 'hello' && onHello) onHello();
  }

  if (channel) channel.onmessage = e => deliver(e.data);

  // Fallback: writes to localStorage fire 'storage' in *other* same-origin tabs.
  window.addEventListener('storage', e => {
    if (e.key !== LS_KEY || !e.newValue) return;
    try { deliver(JSON.parse(e.newValue)); } catch (_) {}
  });

  function send(type, payload) {
    const msg = { role, type, payload, seq: ++seq, t: Date.now() };
    if (channel) channel.postMessage(msg);
    try { localStorage.setItem(LS_KEY, JSON.stringify(msg)); } catch (_) {}
  }

  return {
    post: snapshot => send('state', snapshot),  // DM → Player
    requestState: () => send('hello'),          // Player → DM
  };
}
