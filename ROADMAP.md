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
- **Make tokens tamper-proof, not just secret:** sign them with an HMAC keyed by
  the existing `config.sessionSecret` (`crypto` is already imported), so the
  server can validate a room token without a lookup and optionally encode an
  expiry. This is the "security piping in the existing stack" — no new
  dependencies.
- **Persist the room registry:** a `rooms.json` (same pattern as the content
  files) so rooms survive restarts, mirroring how `session-file-store` already
  persists sessions. Map: `roomId → { name, ownerLabel, createdAt, expiresAt }`.
- **Authorization on the WS upgrade:** the upgrade handler already parses the
  session and reads `?room=`. Extend it to (a) require a valid/known room token
  and (b) keep enforcing the authenticated session. A bad/expired token →
  refuse the upgrade, same as today's 401 path.
- **Content scoping (interim):** keep JSON files but namespace per room
  (`data/<roomId>/scenes.json`, …), or keep a shared library and let a room
  select which adventures it exposes. Decision point — start shared, scope later.

**Decision point:** does knowing the invite token alone grant player access
(capability model, drops the shared player password), or must players *also*
authenticate? Recommended interim: signed token + the existing player password,
so an leaked link can't be used by a complete stranger. This collapses into real
per-user membership in Phase 3.

### Phase 2 — A database for rooms and (eventually) users

**When:** as soon as we want rooms owned by *accounts*, membership lists, or more
than wholesale-JSON content.

- **Engine choice — start with SQLite (`better-sqlite3`), plan for Postgres.**
  - *Why SQLite first:* the deployment is a single PM2 fork on one box. SQLite is
    file-based (fits alongside today's JSON/sessions), zero-ops, synchronous and
    fast for this scale, and trivially backed up. It removes a whole class of
    "stand up and operate a DB server" work.
  - *Why Postgres later:* the moment we run more than one instance (horizontal
    scale, zero-downtime deploys) SQLite's single-writer model becomes the
    bottleneck. Postgres (managed, e.g. Neon/Supabase/RDS) is the migration
    target. Keep the data layer behind a thin repository module so the swap is
    contained.
- **Access layer:** a lightweight query builder / migrator with first-class
  SQLite *and* Postgres support so the engine swap is a config change — Drizzle
  or Knex. Avoid ORMs that lock us to one engine's quirks.
- **Initial schema (sketch):**
  - `users(id, email, display_name, created_at)`
  - `rooms(id, owner_user_id, name, invite_token, expires_at, created_at)`
  - `room_members(room_id, user_id, role)` — role ∈ {dm, player}
  - Content: either `scenes/adventures/campaigns` tables keyed by an owning
    scope, or a `content_blobs(scope_id, kind, json)` table as a low-friction
    lift of today's files before fully normalizing.
- **Migration path:** import the current JSON into the DB for the existing single
  tenant as a one-off script; keep the JSON readers behind the repository
  interface until the DB path is proven, then retire them.

### Phase 3 — Delegated auth (OAuth2 / OIDC), retire homegrown passwords

**Goal:** stop managing password hashes; users sign in with an identity provider;
email identity makes player invites real.

- **Provider & library:** OIDC via Google to start (most D&D groups have Google
  accounts). Use a maintained library rather than hand-rolling the flow —
  **Auth.js (formerly NextAuth's core)**, **Lucia**, or **`openid-client`** with a
  thin wrapper. Keep `express-session` for the session cookie; identity (the
  `sub`/email) comes from the provider.
- **Roles after OAuth:** role is no longer a shared password — it's
  `room_members.role`. The room *owner* is the DM; invited accounts are players.
  The DM/player password split from today maps cleanly onto room membership.
- **Invite flow, completed:** an invite link carries a signed room token; the
  invitee signs in with Google; on first visit we create/lookup their `user`
  row and insert a `room_members(room, user, 'player')` record. Now access is
  per-account and revocable — a real upgrade over a shared secret.
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
3. **Phase 2 SQLite** once rooms need real ownership/membership.
4. **Phase 3 OAuth2** to retire passwords and make invites per-account.
5. **Phase 4** only when scale/multi-instance actually demands it.
