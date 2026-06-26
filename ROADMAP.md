# DnDCast Roadmap

A forward-looking plan, written against the current architecture so each step is
an increment on what already exists rather than a rewrite.

## Where we are today (baseline)

- **Server:** Express + a `ws` WebSocket relay. Relay state lives in an in-memory
  `Map<roomId, { lastState, clients }>`, with `roomId` taken from the page's
  `?room=` param (defaulting to `'default'`). Empty rooms are garbage-collected.
- **Auth:** a single shared **DM** password and an optional shared **player**
  password (bcrypt hashes in `config.json`). `express-session` with
  `session-file-store` persists sessions across restarts. The session carries
  `{ authed, role }`; the WebSocket upgrade re-uses the same session cookie.
- **Authorization:** `requireDM` gates the editor, content writes, and `/api/data`.
  Players receive only a server-sanitized active-scene view (`playerView`).
- **Content:** flat JSON files — `scenes.json`, `adventures.json`,
  `campaigns.json` — read/written wholesale. Single-tenant: one content set per
  deployment.
- **Deploy:** one PM2 fork on a single box, fronted by a Cloudflare Tunnel.

The `?room=` seam already exists but every client joins `'default'`, so today
everyone shares one sync group. That seam is the hook the rooms work hangs on.

---

## Part A — UI / quality-of-life features

Roughly priority-ordered. Effort is a rough T-shirt size.

### Near-term (high value, low risk)

1. **Edit existing scenes from DM mode** (S). We added quick *create* (the drawer
   "+ New"). The natural complement is editing the current scene in place (notes,
   image, audio) without opening the editor. Reuse the quick-scene modal,
   pre-filled, writing back to the scene by id.
2. **Thumbnails in the scene drawer & editor picker** (M). A small image preview
   per row makes long lists scannable. Cheap win now that scenes can carry
   multiple images (show the first).
3. **Connection / sync status indicator** (S). A subtle dot on the DM and cast
   tabs: connected / reconnecting / offline, driven by the existing `sync.js`
   open/close/keepalive events. Removes the "is the cast actually following?"
   guesswork that kicked off the whole cookie-auth saga.
4. **Crossfade image transitions** (S–M). When stepping images within a scene (or
   between scenes), fade between backgrounds instead of hard-cutting. The audio
   controller already crossfades; mirror the pattern for `#scene-display`.
5. **Keyboard shortcut help overlay** (S). A `?` overlay listing the existing
   shortcuts (arrows, space, B, M, F, T, P, N, Z). They're undiscoverable today.
6. **Asset library picker** (M). `/api/upload` already stores files under
   `assets/`. Add a read-only `/api/assets` listing so the editor and the DM
   quick-add can pick an *existing* image/audio instead of re-uploading. Pairs
   well with drag-and-drop upload onto the editor.

### Mid-term (more involved)

7. **Drag-and-drop reorder in the DM scene drawer** (M). We added DnD to the
   editor's adventure list; bring the same affordance to the live drawer so the
   DM can re-sequence on the fly (persists via `/api/save`).
8. **Undo for destructive editor actions** (M). Deleting a scene/adventure is
   immediate and silent apart from a confirm. Keep a short in-memory undo stack
   with a toast ("Deleted — Undo").
9. **Per-scene transition/Ken Burns options** (M). Optional slow pan/zoom on
   static art; per-scene opt-in field. Pure cosmetic polish for atmosphere.
10. **Soundtrack/now-playing affordance** (S). With the new adventure soundtrack,
    show the DM what's actually playing (scene track vs. inherited soundtrack vs.
    silenced) so the audio state is never a mystery.
11. **Presence list per room** (M). Show the DM how many cast/player clients are
    connected (derivable from `room.clients`). Becomes much more useful once
    rooms are first-class (Part B).

### Polish / smaller

- Loading spinner + graceful fade for slow images.
- Blackout fade-in/out instead of instant.
- Remember last-used image `fit` per scene in the editor.
- Mobile DM ergonomics pass (larger touch targets in landscape).

---

## Part B — Rooms, users, security, and auth roadmap

The throughline: **evolve the `?room=` seam into first-class, access-controlled
rooms, then back rooms/users with a database, then hand authentication off to an
OAuth2/OIDC provider** — each phase shippable on its own.

### Phase 1 — First-class rooms + invite links (no database yet)

**Goal:** a DM can create a named room and share a link that drops players
straight into it, with rooms isolated from one another.

- **Room identity:** replace the implicit `'default'` with generated room ids.
  Use an unguessable token (e.g. `crypto.randomBytes(16).toString('base64url')`)
  rather than sequential ids.
- **Invite links:** DM creates a room → server returns
  `https://dnd-cast.com/player.html?room=<token>` (optionally a tidy `/r/<token>`
  that redirects). The token is the capability to *join* that room.
- **The link grants player access (capability model).** Knowing a valid,
  unexpired invite link is sufficient to join as a player — no separate player
  password. This is the agreed model: simpler to share, and the expiry is what
  bounds the risk.
- **Make tokens tamper-proof AND short-lived:** sign them with an HMAC keyed by
  the existing `config.sessionSecret` (`crypto` is already imported) and bake an
  **expiry (~7 days)** into the signed payload. The server validates signature +
  expiry without a lookup; an old leaked link simply stops working. This is the
  "security piping in the existing stack" — no new dependencies. (DMs can
  re-share a fresh link each week; later we can add explicit revoke.)
- **Persist the room registry:** a `rooms.json` (same pattern as the content
  files) so rooms survive restarts, mirroring how `session-file-store` already
  persists sessions. Map: `roomId → { name, ownerLabel, createdAt, expiresAt }`.
- **Authorization on the WS upgrade:** the upgrade handler already parses the
  session and reads `?room=`. Extend it to require a valid, unexpired room token
  for the room being joined. A bad/expired token → refuse the upgrade, same as
  today's 401 path. (The DM still authenticates as themselves; only *players*
  ride in on the capability link.)
- **Content scoping — heading toward DM-owned content.** The agreed end state is
  that all content is owned by the DM (user) who created it, not global or
  per-room. In Phase 1 (pre-accounts) that means scoping content to the room's
  owner identity; once accounts exist (Phase 2/3) it becomes a real
  `owner_user_id`. A room exposes a selection of its DM's content.

### Phase 2 — A storage seam (build the seam, not the second backend yet)

**The valuable, low-cost move is the interface — not running two backends in
lockstep.** What prevents a future big-bang rewrite is the *seam* plus a contract
test suite, not a live second implementation. So we build the seam now, keep the
file store as the only real backend, and defer the actual SQLite build until a
concrete trigger arrives.

- **Introduce the `Store` interface now.** Define a repository module the rest of
  the app talks to and move today's direct `readJson`/`writeJson` behind it.
  Design its operations in **entity/intent terms** — `getContent(ownerId)`,
  `saveContent(...)`, `getRoom(id)`, `createRoom(...)`, `getUser(...)`,
  `addMember(...)` — i.e. *SQL-shaped*, not "read file X", so the seam won't need
  reshaping when a DB backend lands. This is the high-value 80%, worth doing
  regardless of whether SQLite ever ships.
- **Keep `FileStore` as the only real implementation for now.** It stays the
  default and what production runs. **Harden the data model (ownership, rooms,
  security) entirely within the file store, behind the interface** — none of that
  work requires SQL to be present.
- **Validate the seam against SQL once, then set it down.** Do a single SQLite
  *spike* to confirm the interface fits a real query/transaction model, but do
  **not** commit to maintaining a second backend in lockstep. Lockstep dual
  backends mean 2× cost on every change for a backend nobody runs yet, and risk an
  abstraction designed before we've felt the SQL shape.
- **Build `SqliteStore` for real when a trigger arrives** — accounts, multi-user,
  or the data model has stabilized. At that point the interface + a parameterized
  **contract test suite** (run against whichever backends exist) make adding it
  safe and incremental, not a rewrite.
- **Schema the interface should anticipate (so the seam is SQL-shaped):**
  - `users(id, email, display_name, created_at)`
  - `rooms(id, owner_user_id, name, invite_token, expires_at, created_at)`
  - `room_members(room_id, user_id, role)` — role ∈ {dm, player}
  - Content owned per user (`owner_user_id`); a `content_blobs(owner_id, kind,
    json)` shape lifts today's files with minimal friction, normalizing later.
- **Postgres is then just a third implementation, not a rewrite:** with the seam
  in place and a query tool that targets both (Drizzle or Knex), moving to managed
  Postgres (Neon/Supabase/RDS) for horizontal scale is adding a backend, not
  re-plumbing the app.

### Phase 3 — Delegated auth (OAuth2 / OIDC), retire homegrown passwords

**Goal:** stop managing password hashes; users sign in with an identity provider;
email identity makes player invites real.

- **Providers — Google + Discord.** Google first (nearly everyone has an
  account), with **Discord** as the agreed second: it's the most natural fit for
  a tabletop/gaming audience (groups already coordinate there) and arguably the
  most-used "next" login for this crowd. The provider list is config-driven so
  adding a third later (Apple/Microsoft) is trivial.
- **Library:** use a maintained one rather than hand-rolling flows —
  **Auth.js (NextAuth core)**, **Lucia**, or **`openid-client`** with a thin
  wrapper. Note Discord is plain OAuth2 (not full OIDC), so prefer a library that
  handles both OIDC and bare OAuth2 providers cleanly. Keep `express-session` for
  the session cookie; identity (provider `sub` + email) maps to a `users` row.
- **Roles after OAuth:** role is no longer a shared password — it's
  `room_members.role`. The room *owner* is the DM; invited accounts are players.
  The DM/player password split from today maps cleanly onto room membership.
- **Invite flow, completed:** an invite link carries a signed room token; the
  invitee signs in with Google or Discord; on first visit we create/lookup their
  `user` row and insert a `room_members(room, user, 'player')` record. Access is
  now per-account and revocable — though the capability link from Phase 1 remains
  a valid lighter-weight path for casual players who don't want an account.
- **Transition:** run OAuth alongside the existing password login behind a flag,
  migrate the single existing DM to an account, then remove
  `passwordHash`/`playerPasswordHash`. `sameSite: 'strict'` cookies already cover
  most CSRF surface; add explicit CSRF tokens for state-changing POSTs during
  this phase.

### Phase 4 — Multi-tenant hardening & scale

- **Per-room WS authorization** becomes membership-based (check
  `room_members`), not just "is authenticated".
- **Horizontal scale:** the relay's in-memory `Map` only works within one
  process. To run multiple instances, move room fan-out to **Redis pub/sub** (or
  a managed equivalent), keyed by room id. Until then, the single PM2 instance is
  a deliberate, documented constraint.
- **Operational:** per-IP/login rate limiting, structured audit logging for room
  creation/joins, automated backups (DB + assets), and an asset store decision
  (local disk vs. object storage like S3/R2) once content volume grows.

---

## Suggested sequencing

1. Ship the **near-term QoL** items (Part A 1–6) — independent, low-risk, immediate.
2. **Phase 1 rooms + signed invite links** on the current JSON/session stack — the
   biggest product unlock without a DB.
3. **Phase 2 storage seam** — introduce the `Store` interface (SQL-shaped) and
   harden the data model within the file store; spike SQLite to validate the seam
   but defer building the second backend until a real trigger.
4. **Phase 3 OAuth2** to retire passwords and make invites per-account.
5. **Phase 4** only when scale/multi-instance actually demands it.
