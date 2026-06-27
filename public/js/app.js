// =====================================================================
// DnDCast — app.js (shared player + DM entry point)
//
// Loaded by player.html as an ES module. The URL's ?role= param selects:
//   • role "player" — the cast tab: shows art, plays audio, FOLLOWS the DM.
//   • role "dm"     — control tab: full UI + notes/script overlay; BROADCASTS
//                     every action to the Player and stays silent locally.
//
// Content: scenes.json / adventures.json / campaigns.json (via editor.html).
// Tunables: js/config.js.
// =====================================================================

import { CONFIG } from './config.js';
import { AudioController } from './audio.js';
import { createSync } from './sync.js';
import { filterList } from './utils.js';

// ── Role ─────────────────────────────────────────────────────────────
// DM mode requires BOTH ?role=dm AND a DM-level session. The server is the
// authority (/api/me), so a player-level user can't self-promote by editing the
// URL. Fail closed to 'player' if the role can't be read.
const wantsDM     = new URLSearchParams(location.search).get('role') === 'dm';
const sessionRole = await fetch('/api/me')
  .then(r => r.ok ? r.json() : { role: 'player' })
  .then(d => d.role)
  .catch(() => 'player');
const role = (wantsDM && sessionRole === 'dm') ? 'dm' : 'player';
const isDM = role === 'dm';
// A 'player'-level session is RESTRICTED: it has no dataset and receives only
// sanitized active-scene pushes from the server. (A DM-level session viewing as
// a cast tab is a full, trusted follower — not restricted.)
const isRestricted = sessionRole === 'player';
document.body.dataset.role = role;
let playerImageSrc = null;   // restricted-player render diffing
let playerAudioSrc = null;
let playerPlaylistKey = null; // restricted-player soundtrack-playlist diffing

// Adventure soundtrack playlist (continuous background music across scenes
// that have no audio of their own). Shared by DM/cast (resolved from data) and
// the restricted player (driven by the server's view.playlist).
let soundtrackList    = [];
let soundtrackIndex   = 0;
let playingSoundtrack = false;

// ── State ────────────────────────────────────────────────────────────
let allScenes     = [];
let allAdventures = [];
let allCampaigns  = [];
let currentScenes = [];
let activeCampaignId  = null;
let activeAdventureId = null;

let currentIndex     = -1;        // -1 = nothing shown yet
let currentImageIndex = 0;        // which image within the current scene
let volume           = 1;
let sessionStarted   = false;
let titleVisible     = false;
let presentationMode = false;
let blackoutActive   = false;
let notesOpen        = false;
let wantPlaying      = true;       // DM's logical play/pause intent (broadcast)
let dmOverlayVisible = true;       // DM notes/script overlay
let isDMStaged       = false;      // when true, broadcastState() is a no-op

let imageGeneration = 0;
let hideTimer       = null;
let cursorTimer     = null;

const audio = new AudioController(CONFIG.fadeMs);

// DM broadcasts state; Player applies it. (See wiring in init.)
const sync = createSync(role, {
  onState: isDM ? null : (isRestricted ? applyPlayerView : applyRemoteState),
  onHello: isDM ? () => broadcastState() : null,
  onOpen:  isDM ? () => { if (sessionStarted) broadcastState(); } : null,
});

// ── DOM refs ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dmBadge            = $('dm-badge');
const dmStageBadge       = $('dm-stage-badge');
const dmStageBtn         = $('dm-stage-btn');
const startOverlay       = $('start-overlay');
const startBtn           = $('start-btn');
const startSubtitle      = $('start-subtitle');
const waitingOverlay     = $('waiting-overlay');
const playSoloBtn        = $('play-solo-btn');
const campaignOverlay    = $('campaign-overlay');
const campaignList       = $('campaign-list');
const adventureOverlay   = $('adventure-overlay');
const adventurePickerList= $('adventure-picker-list');
const adventureLabel     = $('adventure-label');
const switchAdventureBtn = $('switch-adventure-btn');
const homeBtn            = $('home-btn');
const sceneDisplay       = $('scene-display');
const scenePlaceholder   = $('scene-placeholder');
const placeholderTitle   = $('placeholder-title');
const placeholderError   = $('placeholder-error');
const blackoutEl         = $('blackout');
const dmNotesOverlay     = $('dm-notes-overlay');
const dmNotesText        = $('dm-notes-text');
const dmScriptText       = $('dm-script-text');
const dmOverlayBtn       = $('dm-overlay-btn');
const titleOverlay       = $('title-overlay');
const controls           = $('controls');
const presentDot         = $('present-dot');
const drawerBackdrop     = $('drawer-backdrop');
const sceneDrawer        = $('scene-drawer');
const sceneList          = $('scene-list');
const closeDrawerBtn     = $('close-drawer-btn');
const drawerSearch       = $('drawer-search');
const notesToggleBtn     = $('notes-toggle-btn');
const notesContent       = $('notes-content');
const errorMsg           = $('error-msg');
const overflowWrap       = $('overflow-wrap');
const overflowBtn        = $('overflow-btn');
const overflowPanel      = $('overflow-panel');
const logoutBtn          = $('logout-btn');
const homeNavBtn         = $('home-nav-btn');
const homeLogoutBtn      = $('home-logout-btn');
const sceneCounter       = $('scene-counter');
const prevBtn            = $('prev-btn');
const nextBtn            = $('next-btn');
const scenesBtn          = $('scenes-btn');
const playPauseBtn       = $('play-pause-btn');
const blackoutBtn        = $('blackout-btn');
const titleBtn           = $('title-btn');
const fullscreenBtn      = $('fullscreen-btn');
const presentBtn         = $('present-btn');
const volumeSlider       = $('volume-slider');
const muteBtn            = $('mute-btn');
const tapPrev            = $('tap-prev');
const tapNext            = $('tap-next');
const drawerAddBtn       = $('drawer-add-btn');
const quickSceneOverlay  = $('quick-scene-overlay');
const qsForm             = $('quick-scene-form');
const qsTitle            = $('qs-title');
const qsImage            = $('qs-image');
const qsImageBrowse      = $('qs-image-browse');
const qsImageFile        = $('qs-image-file');
const qsAudio            = $('qs-audio');
const qsAudioBrowse      = $('qs-audio-browse');
const qsAudioFile        = $('qs-audio-file');
const qsSilent           = $('qs-silent');
const qsNotes            = $('qs-notes');
const qsScript           = $('qs-script');
const qsFit              = $('qs-fit');
const qsLoop             = $('qs-loop');
const qsStatus           = $('qs-status');
const qsHeading          = $('qs-heading');
const qsSave             = $('qs-save');
const qsSaveOnly         = $('qs-save-only');
const qsCloseBtn         = $('qs-close-btn');
const qsCancel           = $('qs-cancel');
const notebookBtn        = $('notebook-btn');
const notebookBackdrop   = $('notebook-backdrop');
const notebookDrawer     = $('notebook-drawer');
const notebookCloseBtn   = $('notebook-close-btn');
const notebookList       = $('notebook-list');
const notebookEmpty      = $('notebook-empty');
const noteNewBtn         = $('note-new-btn');
const noteModal          = $('note-modal');
const noteView           = $('note-view');
const noteViewTag        = $('note-view-tag');
const noteViewTitle      = $('note-view-title');
const noteViewBody       = $('note-view-body');
const noteViewClose      = $('note-view-close');
const noteEditBtn        = $('note-edit-btn');
const noteDeleteBtn      = $('note-delete-btn');
const noteEditForm       = $('note-edit-form');
const noteEditHeading    = $('note-edit-heading');
const noteEditClose      = $('note-edit-close');
const noteScopeSelect    = $('note-scope-select');
const noteTitle          = $('note-title');
const noteText           = $('note-text');
const noteSaveBtn        = $('note-save-btn');
const noteCancelBtn      = $('note-cancel-btn');
const noteStatus         = $('note-status');

// ── Init / wiring ────────────────────────────────────────────────────
function init() {
  loadState();
  volumeSlider.value = volume;
  audio.volume = volume;
  updateMuteIcon();
  audio.onStateChange = updatePlayPauseBtn;     // button only; broadcasts are explicit
  audio.onError = (src, blocked) =>
    showError(blocked ? 'Tap ▶ to start audio (autoplay blocked).' : 'Audio not found: ' + src);
  audio.onEnded = onAudioEnded;                 // advance the soundtrack playlist
  sceneDisplay.style.backgroundSize = CONFIG.objectFit;
  applyPresentationMode();
  applyRoleUI();

  startBtn.addEventListener('click',          startSession);
  playSoloBtn.addEventListener('click',       playSolo);
  switchAdventureBtn.addEventListener('click',openAdventureFlow);
  homeBtn.addEventListener('click',           goHome);

  prevBtn.addEventListener('click', () => changeScene(-1));
  nextBtn.addEventListener('click', () => changeScene(1));
  // Tap zones advance the scene — disabled in cast mode to prevent
  // accidental scene changes when touching the cast tab.
  tapPrev.addEventListener('click', () => { if (isDM) { showControls(); changeScene(-1); } });
  tapNext.addEventListener('click', () => { if (isDM) { showControls(); changeScene(1); } });

  scenesBtn.addEventListener('click', openDrawer);
  closeDrawerBtn.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);
  drawerSearch.addEventListener('input', filterDrawer);

  playPauseBtn.addEventListener('click',  togglePlayPause);
  blackoutBtn.addEventListener('click',   toggleBlackout);
  titleBtn.addEventListener('click',      toggleTitle);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  presentBtn.addEventListener('click',    togglePresentation);
  presentDot.addEventListener('click',    togglePresentation);
  notesToggleBtn.addEventListener('click',toggleNotes);
  overflowBtn.addEventListener('click',   e => { e.stopPropagation(); toggleOverflow(); });
  overflowPanel.addEventListener('click', () => closeOverflow());
  document.addEventListener('click',     e => { if (!overflowWrap.contains(e.target)) closeOverflow(); });

  dmOverlayBtn.addEventListener('click',  toggleDmOverlay);
  dmStageBtn.addEventListener('click',    toggleDmStage);
  const logout = () => fetch('/api/logout', { method: 'POST' }).then(() => { location.href = '/login'; });
  logoutBtn.addEventListener('click',     logout);
  homeLogoutBtn.addEventListener('click', logout);
  homeNavBtn.addEventListener('click',    () => { location.href = 'index.html'; });
  volumeSlider.addEventListener('input',  onVolumeChange);
  muteBtn.addEventListener('click',       e => { e.preventDefault(); toggleMute(); });

  // Quick add/edit-scene (DM only)
  drawerAddBtn.addEventListener('click', () => openQuickScene());
  qsCloseBtn.addEventListener('click',   closeQuickScene);
  qsCancel.addEventListener('click',     closeQuickScene);
  qsForm.addEventListener('submit',      e => { e.preventDefault(); saveQuickScene(true); });
  qsSaveOnly.addEventListener('click',   () => saveQuickScene(false));

  // Notebook (DM only)
  notebookBtn.addEventListener('click',      openNotebook);
  notebookCloseBtn.addEventListener('click', closeNotebook);
  notebookBackdrop.addEventListener('click', closeNotebook);
  noteNewBtn.addEventListener('click',       () => openNoteEditor(null));
  noteEditForm.addEventListener('submit',    e => { e.preventDefault(); saveNote(); });
  noteCancelBtn.addEventListener('click',    closeNoteModal);
  noteEditClose.addEventListener('click',    closeNoteModal);
  noteViewClose.addEventListener('click',    closeNoteModal);
  noteEditBtn.addEventListener('click',      () => { if (viewingNote) openNoteEditor(viewingNote); });
  noteDeleteBtn.addEventListener('click',    () => { if (viewingNote) deleteNote(viewingNote.id); });
  qsImageBrowse.addEventListener('click', () => qsImageFile.click());
  qsAudioBrowse.addEventListener('click', () => qsAudioFile.click());
  qsImageFile.addEventListener('change', () => uploadInto(qsImageFile, qsImage));
  qsAudioFile.addEventListener('change', () => uploadInto(qsAudioFile, qsAudio));
  qsSilent.addEventListener('change',    syncQsSilent);

  document.addEventListener('touchstart', onInteraction, { passive: true });
  document.addEventListener('mousemove',  onMouseMove);
  document.addEventListener('keydown',    onKeydown);
  document.addEventListener('fullscreenchange',       updateFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
  // Settle audio fades when the tab is backgrounded (rAF freezes there).
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.freezeFades(); });

  // Player only: keep a noop rAF loop running so Chrome's compositor
  // continues producing frames while the tab is cast in the background.
  // Without this, Chrome stops rendering the tab and the cast stream freezes.
  // Combined with the active audio track this is enough to keep it live.
  if (!isDM) (function castKeepalive() { requestAnimationFrame(castKeepalive); })();
}

// Show role-specific chrome.
function applyRoleUI() {
  document.title = isDM ? 'DnDCast — DM' : 'DnDCast — Cast';
  if (isDM) {
    dmBadge.hidden       = false;
    dmOverlayBtn.hidden  = false;
    dmStageBtn.hidden    = false;
    drawerAddBtn.hidden  = false;   // author scenes mid-session
    notebookBtn.hidden   = false;   // personal notes
    startSubtitle.textContent = 'DM Control';
    // DM uses the same local volume slider as everyone, but starts MUTED — the
    // cast tab is the room's sound, so the DM is silent until they raise it to
    // monitor on this device.
    audio.muted = true;
    volumeSlider.value = 0;
    updateMuteIcon();
    dmOverlayBtn.classList.toggle('active', dmOverlayVisible);
  } else if (isRestricted) {
    document.title = 'DnDCast — Player';
    startSubtitle.textContent = 'Player';
    // Player follows the DM but keeps LOCAL controls: volume/mute, fullscreen, and
    // logout. Hide only what navigates the shared session or is DM-only.
    homeBtn.hidden            = true;
    prevBtn.hidden            = true;
    playPauseBtn.hidden       = true;
    nextBtn.hidden            = true;
    scenesBtn.hidden          = true;
    notesToggleBtn.hidden     = true;
    notesContent.hidden       = true;
    sceneCounter.hidden       = true;
    presentDot.hidden         = true;
    tapPrev.hidden            = true;
    tapNext.hidden            = true;
    playSoloBtn.hidden        = true;       // no dataset to play solo from
    // Overflow stays for Log out; hide the DM/session items inside it.
    blackoutBtn.hidden        = true;
    titleBtn.hidden           = true;
    switchAdventureBtn.hidden = true;
    presentBtn.hidden         = true;
    // Kept visible: volume slider, fullscreen, and overflow ▸ Log out.
  } else {
    startSubtitle.textContent = 'Cast';
    // Cast tab: DM drives these via sync; hide them to avoid confusion/accidents.
    switchAdventureBtn.hidden = true;
    notesToggleBtn.hidden     = true;
    notesContent.hidden       = true;
    blackoutBtn.hidden        = true;
    titleBtn.hidden           = true;
    presentBtn.hidden         = true;
    presentDot.hidden         = true;
    // Overflow stays for the Home link; hide Log out (the cast shares the DM's
    // session, so logging out here would sign the DM out too).
    logoutBtn.hidden          = true;
  }
}

// ── Session start / home ─────────────────────────────────────────────
async function startSession() {
  unlockAudioContext();
  sessionStarted = true;
  startOverlay.hidden = true;

  // Restricted player has no dataset (/api/data is DM-only); just follow the DM.
  if (isRestricted) {
    waitingOverlay.hidden = false;
    sync.requestState();
    return;
  }

  const ok = await loadData();
  if (!ok) return;

  if (isDM) {
    openAdventureFlow();                        // DM drives — pick an adventure
  } else {
    waitingOverlay.hidden = false;             // Player follows — wait for DM
    sync.requestState();
  }
}

// Player: abandon waiting and run the pickers standalone.
function playSolo() {
  waitingOverlay.hidden = true;
  openAdventureFlow();
}

function goHome() {
  if (isDM) sync.post({ stop: true });         // tell the Player to go dark
  audio.stopAll();
  resetSoundtrack();
  sessionStarted = false;
  clearTimeout(cursorTimer);
  document.body.classList.remove('cursor-hidden');
  if (blackoutActive) setBlackout(false, false);
  closeDrawer();
  campaignOverlay.hidden  = true;
  adventureOverlay.hidden = true;
  waitingOverlay.hidden   = true;
  startOverlay.hidden     = false;
}

function unlockAudioContext() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
    setTimeout(() => ctx.close(), 500);
  } catch (_) {}
}

// ── Data loading ─────────────────────────────────────────────────────
async function loadData() {
  try {
    const res = await fetch('/api/data');
    if (res.status === 401) { location.href = '/login'; return false; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data     = await res.json();
    allScenes      = Array.isArray(data.scenes)     ? data.scenes     : [];
    allAdventures  = Array.isArray(data.adventures) ? data.adventures : [];
    allCampaigns   = Array.isArray(data.campaigns)  ? data.campaigns  : [];
  } catch (e) {
    showError('Could not load data: ' + e.message);
    showControls();
    return false;
  }
  if (!allScenes.length) {
    showError('No scenes found — add some in the Editor.');
    showControls();
    return false;
  }
  return true;
}

// ── Campaign / adventure pickers ─────────────────────────────────────
function openAdventureFlow() {
  if (allCampaigns.length)      showCampaignPicker();
  else if (allAdventures.length) showAdventurePicker(null);
  else                           startAllScenes();
}

function showCampaignPicker() {
  campaignList.innerHTML = '';

  allCampaigns.forEach(campaign => {
    const count = allAdventures.filter(a => a.campaignId === campaign.id).length;
    const li = document.createElement('li');
    li.className = 'picker-card';
    li.innerHTML =
      `<span class="picker-title">${escHtml(campaign.title)}</span>` +
      `<span class="picker-meta">${count} adventure${count !== 1 ? 's' : ''}</span>` +
      (campaign.description ? `<span class="picker-desc">${escHtml(campaign.description)}</span>` : '');
    li.addEventListener('click', () => { campaignOverlay.hidden = true; showAdventurePicker(campaign.id); });
    campaignList.appendChild(li);
  });

  if (allAdventures.length) {
    const allLi = document.createElement('li');
    allLi.className = 'picker-card picker-all';
    allLi.innerHTML =
      `<span class="picker-title">All Campaigns</span>` +
      `<span class="picker-meta">${allAdventures.length} adventures</span>`;
    allLi.addEventListener('click', () => { campaignOverlay.hidden = true; showAdventurePicker(null); });
    campaignList.appendChild(allLi);
  }

  campaignOverlay.hidden = false;
}

function showAdventurePicker(campaignId) {
  activeCampaignId = campaignId;
  const filtered = campaignId
    ? allAdventures.filter(a => a.campaignId === campaignId)
    : allAdventures;

  adventurePickerList.innerHTML = '';

  filtered.forEach(adventure => {
    const count = Array.isArray(adventure.scenes) ? adventure.scenes.length : 0;
    const savedIdx = parseInt(localStorage.getItem('dndcast_index_' + adventure.id), 10);
    const progress = (Number.isFinite(savedIdx) && savedIdx > 0) ? ' · scene ' + (savedIdx + 1) : '';

    const li = document.createElement('li');
    li.className = 'picker-card';
    li.innerHTML =
      `<span class="picker-title">${escHtml(adventure.title)}</span>` +
      `<span class="picker-meta">${count} scene${count !== 1 ? 's' : ''}${escHtml(progress)}</span>`;
    li.addEventListener('click', () => pickAdventure(adventure));
    adventurePickerList.appendChild(li);
  });

  const allLi = document.createElement('li');
  allLi.className = 'picker-card picker-all';
  allLi.innerHTML =
    `<span class="picker-title">Play All Scenes</span>` +
    `<span class="picker-meta">${publicScenes().length} scenes</span>`;
  allLi.addEventListener('click', startAllScenes);
  adventurePickerList.appendChild(allLi);

  if (allCampaigns.length) {
    const backLi = document.createElement('li');
    backLi.className = 'picker-back';
    const backBtn = document.createElement('button');
    backBtn.className = 'text-btn';
    backBtn.textContent = '← Back to Campaigns';
    backBtn.addEventListener('click', () => { adventureOverlay.hidden = true; showCampaignPicker(); });
    backLi.appendChild(backBtn);
    adventurePickerList.appendChild(backLi);
  }

  adventureOverlay.hidden = false;
}

function pickAdventure(adventure) {
  activeAdventureId = adventure.id;
  activeCampaignId  = adventure.campaignId || activeCampaignId;
  localStorage.setItem('dndcast_adventure', adventure.id);
  if (activeCampaignId) localStorage.setItem('dndcast_campaign', activeCampaignId);

  currentScenes = (Array.isArray(adventure.scenes) ? adventure.scenes : [])
    .map(id => allScenes.find(s => s.id === id))
    .filter(Boolean);

  if (!currentScenes.length) {
    showError('Adventure has no valid scenes — loading all scenes instead.');
    currentScenes = publicScenes();
  }

  adventureOverlay.hidden = true;
  campaignOverlay.hidden  = true;
  enterPlayer();
}

// Scenes in the global "all scenes" pool — excludes scenes marked private to a
// specific adventure/campaign so their secrets don't leak into the browse-all view.
function publicScenes() { return allScenes.filter(s => !s.privateTo); }

function startAllScenes() {
  activeAdventureId = 'all';
  activeCampaignId  = null;
  currentScenes     = publicScenes();
  localStorage.setItem('dndcast_adventure', 'all');
  adventureOverlay.hidden = true;
  campaignOverlay.hidden  = true;
  enterPlayer();
}

function enterPlayer() {
  audio.stopAll();
  resetSoundtrack();
  const savedIdx = parseInt(localStorage.getItem('dndcast_index_' + activeAdventureId), 10);
  const idx = (Number.isFinite(savedIdx) && savedIdx >= 0 && savedIdx < currentScenes.length) ? savedIdx : 0;
  updateAdventureLabel();
  buildSceneList();
  showControls();
  currentIndex = -1;            // force goToScene to run
  goToScene(idx);
}

function updateAdventureLabel() {
  if (activeAdventureId === 'all') { adventureLabel.textContent = 'All Scenes'; return; }
  const adventure = allAdventures.find(a => a.id === activeAdventureId);
  const campaign  = allCampaigns.find(c => c.id === activeCampaignId);
  adventureLabel.textContent = [campaign?.title, adventure?.title].filter(Boolean).join(' — ');
}

// ── Scene navigation ─────────────────────────────────────────────────
// A scene can hold multiple images (scene.images); the DM steps through them,
// then crosses to the next/previous scene. The image list falls back to the
// single scene.image for backward compatibility.
// Normalized image list: [{ src, fit }]. Each image carries its own fit; older
// data (string entries, or a single scene.image with scene-level scene.fit) is
// read transparently. Mirrored server-side in playerView.
function sceneImages(scene) {
  const raw = scene && Array.isArray(scene.images) && scene.images.length ? scene.images
            : (scene && scene.image ? [scene.image] : []);
  return raw.map(e => typeof e === 'string'
    ? { src: e,       fit: scene.fit || null }
    : { src: e.src,   fit: e.fit || scene.fit || null });
}

// imagePos: 'first' (default), 'last', or a numeric index — which image to show.
function goToScene(index, imagePos = 'first') {
  if (!currentScenes.length) return;
  index = Math.max(0, Math.min(index, currentScenes.length - 1));
  currentIndex = index;
  wantPlaying  = true;                 // a scene change always means "play"
  localStorage.setItem('dndcast_index_' + activeAdventureId, index);

  const scene = currentScenes[index];
  clearError();

  const imgs = sceneImages(scene);
  currentImageIndex = imagePos === 'last' ? Math.max(0, imgs.length - 1)
                    : (typeof imagePos === 'number' ? Math.max(0, Math.min(imagePos, imgs.length - 1)) : 0);

  showCurrentImage(scene);
  // Warm the first image of the next scene for a snappy advance.
  const next = currentScenes[index + 1];
  const nextFirst = next && sceneImages(next)[0];
  if (nextFirst && nextFirst.src) new Image().src = nextFirst.src;

  titleOverlay.textContent = scene.title || '';
  notesContent.textContent = scene.notes || '(no notes for this scene)';
  if (isDM) renderDmOverlay(scene);
  updateSceneListHighlight();
  updateCounter();

  const adventure = allAdventures.find(a => a.id === activeAdventureId);
  playSceneAudio(scene, adventure);
  broadcastState();
}

// Render the image at currentImageIndex and warm the next one within the scene.
function showCurrentImage(scene) {
  const imgs = sceneImages(scene);
  const entry = imgs[currentImageIndex] || {};
  const imgGen = ++imageGeneration;
  loadSceneImage(entry.src || '', imgGen, scene.title, entry.fit);
  const next = imgs[currentImageIndex + 1];
  if (next && next.src) new Image().src = next.src;   // warm the next image in-scene
}

function updateCounter() {
  const imgs = sceneImages(currentScenes[currentIndex]);
  let txt = (currentIndex + 1) + ' / ' + currentScenes.length;
  if (imgs.length > 1) txt += '  ·  ▦ ' + (currentImageIndex + 1) + '/' + imgs.length;
  sceneCounter.textContent = txt;
}

// Show a specific image within the current scene (no scene change).
function setImageIndex(i) {
  const scene = currentScenes[currentIndex];
  if (!scene) return;
  const imgs = sceneImages(scene);
  currentImageIndex = Math.max(0, Math.min(i, imgs.length - 1));
  showCurrentImage(scene);
  updateCounter();
  broadcastState();
}

// Prev/next: step within the scene's images first, then cross scene boundaries.
function changeScene(delta) {
  if (!sessionStarted || !currentScenes.length) return;
  const imgs = sceneImages(currentScenes[currentIndex]);
  const target = currentImageIndex + delta;
  if (imgs.length > 1 && target >= 0 && target < imgs.length) { setImageIndex(target); return; }
  const newIndex = Math.max(0, Math.min(currentIndex + delta, currentScenes.length - 1));
  if (newIndex === currentIndex) { setImageIndex(target); return; }   // clamp at the ends
  goToScene(newIndex, delta > 0 ? 'first' : 'last');
}

function loadSceneImage(src, gen, sceneTitle, fit) {
  // fit: 'cover' (default, fills screen, may crop) or 'contain' (shows full image, letterboxed)
  const bgSize = (fit === 'contain' || fit === 'cover') ? fit : CONFIG.objectFit;
  if (!src) {
    if (gen === imageGeneration) {
      sceneDisplay.style.backgroundImage = 'none';
      showPlaceholder(sceneTitle, null);
    }
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (gen === imageGeneration) {
      hidePlaceholder();
      sceneDisplay.style.backgroundSize    = bgSize;
      sceneDisplay.style.backgroundImage   = 'url("' + escapeCssUrl(src) + '")';
    }
  };
  img.onerror = () => {
    if (gen === imageGeneration) {
      sceneDisplay.style.backgroundImage = 'none';
      showPlaceholder(sceneTitle, 'Image not found: ' + src);
    }
  };
  img.src = src;
}

function showPlaceholder(title, errorText) {
  placeholderTitle.textContent = title || '';
  placeholderError.textContent = errorText || '';
  scenePlaceholder.hidden = false;
}
function hidePlaceholder() { scenePlaceholder.hidden = true; }

// ── DM notes/script overlay ──────────────────────────────────────────
function renderDmOverlay(scene) {
  const script = scene.dmScript || '';
  const notes  = scene.notes    || '';
  dmScriptText.textContent = script;
  dmNotesText.textContent  = notes;
  // Hide a card entirely when its text is empty; cards size to their content.
  dmScriptText.closest('.dm-note-card').hidden = !script;
  dmNotesText.closest('.dm-note-card').hidden  = !notes;
  dmNotesOverlay.classList.toggle('single', !script !== !notes);  // exactly one present
  applyDmOverlayVisibility();
}

function toggleDmOverlay() {
  dmOverlayVisible = !dmOverlayVisible;
  dmOverlayBtn.classList.toggle('active', dmOverlayVisible);
  applyDmOverlayVisibility();
}

function applyDmOverlayVisibility() {
  // Overlay only exists in DM role; hidden when off, before a scene loads, or
  // when the current scene has neither script nor notes (nothing to show).
  const scene = currentScenes[currentIndex];
  const hasContent = !!(scene && (scene.dmScript || scene.notes));
  dmNotesOverlay.hidden = !(isDM && dmOverlayVisible && currentIndex >= 0 && hasContent);
}

function toggleOverflow() { overflowPanel.hidden = !overflowPanel.hidden; }
function closeOverflow()  { overflowPanel.hidden = true; }

function toggleDmStage() {
  isDMStaged = !isDMStaged;
  dmStageBadge.hidden = !isDMStaged;
  dmStageBtn.classList.toggle('active', isDMStaged);
  if (!isDMStaged) broadcastState();   // snap cast to wherever DM navigated
}

// ── Scene list drawer ────────────────────────────────────────────────
function buildSceneList() {
  sceneList.innerHTML = '';
  currentScenes.forEach((scene, i) => {
    const li    = document.createElement('li');
    const num   = document.createElement('span');
    const label = document.createElement('span');
    num.className   = 'scene-num';
    num.textContent = i + 1;
    label.className = 'scene-label';
    label.textContent = scene.title || scene.id || 'Scene ' + (i + 1);
    li.append(num, label);
    // DM: a pencil to edit the scene in place (without navigating to it).
    if (isDM) {
      const edit = document.createElement('button');
      edit.className = 'scene-edit-pencil';
      edit.title = 'Edit scene';
      edit.innerHTML = '&#x270E;';
      edit.addEventListener('click', e => { e.stopPropagation(); openQuickScene(scene); });
      li.append(edit);
    }
    li.addEventListener('click', () => { goToScene(i); closeDrawer(); });
    sceneList.appendChild(li);
  });
}

function updateSceneListHighlight() {
  Array.from(sceneList.children).forEach((li, i) => li.classList.toggle('current', i === currentIndex));
}

function openDrawer() {
  sceneDrawer.hidden = false;
  drawerBackdrop.hidden = false;
  sceneDrawer.style.minHeight = sceneDrawer.offsetHeight + 'px';
  // Skip auto-focus on touch devices — keyboard popup shifts the layout.
  if (!window.matchMedia('(pointer: coarse)').matches) drawerSearch.focus();
}

function closeDrawer() {
  sceneDrawer.style.minHeight = '';
  sceneDrawer.hidden = true;
  drawerBackdrop.hidden = true;
  drawerSearch.value = '';
  filterDrawer();
}

function filterDrawer() { filterList(drawerSearch, sceneList, 'li'); }

// ── Control actions ──────────────────────────────────────────────────
function togglePlayPause() {
  audio.togglePlayPause();
  wantPlaying = !audio.isPaused();
  broadcastState();
}

function updatePlayPauseBtn() {
  const paused = audio.isPaused();
  playPauseBtn.innerHTML = paused ? '&#x25B6;' : '&#x23F8;';
  playPauseBtn.title     = paused ? 'Resume' : 'Pause';
}

// affectAudio=false is used by the Player follower: blackout there is purely
// visual, since play/pause is already synced explicitly from the DM.
function setBlackout(active, affectAudio = true) {
  blackoutActive    = active;
  blackoutEl.hidden = !active;
  blackoutBtn.classList.toggle('active', active);
  if (affectAudio && CONFIG.blackoutPausesAudio) {
    if (active) { audio.pause();  wantPlaying = false; }
    else        { audio.resume(); wantPlaying = true;  }
  }
}

function toggleBlackout() {
  setBlackout(!blackoutActive);
  broadcastState();
}

function setTitleVisible(visible) {
  titleVisible = visible;
  titleBtn.classList.toggle('active', visible);
  titleOverlay.classList.toggle('hidden', !visible);
}

function toggleTitle() {
  setTitleVisible(!titleVisible);
  localStorage.setItem('dndcast_titleVisible', titleVisible);
  broadcastState();
}

function toggleMute() {
  audio.toggleMute();
  volumeSlider.value = audio.muted ? 0 : volume;
  updateMuteIcon();
  broadcastState();
}

function onVolumeChange() {
  volume = parseFloat(volumeSlider.value);
  localStorage.setItem('dndcast_volume', volume);
  audio.setVolume(volume);
  updateMuteIcon();
  broadcastState();
}

// 🔇 when silent (explicitly muted or volume at 0), 🔊 otherwise.
function updateMuteIcon() {
  const silent = audio.muted || volume === 0;
  muteBtn.innerHTML = silent ? '&#x1F507;' : '&#x1F50A;';
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement)
    (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
  else
    (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
}

function updateFullscreenBtn() {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  fullscreenBtn.innerHTML = isFs ? '&#x2715;' : '&#x26F6;';
  fullscreenBtn.title     = isFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
}

function togglePresentation() {
  presentationMode = !presentationMode;
  localStorage.setItem('dndcast_presentationMode', presentationMode);
  applyPresentationMode();
}

function applyPresentationMode() {
  document.body.classList.toggle('presentation-mode', presentationMode);
  presentBtn.classList.toggle('active', presentationMode);
  if (presentationMode) { clearTimeout(hideTimer); controls.classList.add('hidden'); }
  else showControls();
}

function toggleNotes() {
  notesOpen           = !notesOpen;
  notesContent.hidden = !notesOpen;
  notesToggleBtn.innerHTML = notesOpen ? 'Notes &#x25BE;' : 'Notes &#x25B8;';
}

// ── Cross-tab sync ───────────────────────────────────────────────────
function broadcastState() {
  if (!isDM || isDMStaged) return;
  sync.post({
    activeCampaignId,
    activeAdventureId,
    sceneIndex:   currentIndex,
    imageIndex:   currentImageIndex,
    paused:       !wantPlaying,
    blackout:     blackoutActive,
    titleVisible,
  });
  // Volume/mute are intentionally NOT broadcast: each device (cast, player)
  // controls its own loudness locally; the DM only monitors via dm-listen.
}

// Player only: apply a snapshot from the DM, acting on diffs so a volume
// nudge never restarts the track.
function applyRemoteState(s) {
  if (!sessionStarted) return;                 // wait until audio is unlocked

  if (s.stop) {                                // DM returned home
    audio.stopAll();
    setBlackout(true, false);
    waitingOverlay.hidden = false;             // back to a holding screen
    return;
  }

  const adventureChanged =
    s.activeAdventureId !== activeAdventureId || s.activeCampaignId !== activeCampaignId;

  if (adventureChanged) {
    activeCampaignId  = s.activeCampaignId;
    activeAdventureId = s.activeAdventureId;
    resolveAdventureScenesForActive();
    updateAdventureLabel();
    buildSceneList();
    audio.stopAll();
    resetSoundtrack();
    currentIndex = -1;
  }

  // Volume/mute are local to this cast device (not driven by the DM).

  if (s.sceneIndex < 0) return;                // DM hasn't picked a scene yet
  waitingOverlay.hidden = true;                // a real scene is incoming

  const wantImage = s.imageIndex ?? 0;
  if (adventureChanged || s.sceneIndex !== currentIndex) {
    goToScene(s.sceneIndex, wantImage);        // plays the new scene at the DM's image
  } else if (wantImage !== currentImageIndex) {
    setImageIndex(wantImage);                  // same scene, DM stepped the image
  }

  if (s.paused !== audio.isPaused()) {
    if (s.paused) audio.pause(); else audio.resume();
  }

  if (s.blackout !== blackoutActive) setBlackout(s.blackout, false);
  if (s.titleVisible !== titleVisible) setTitleVisible(s.titleVisible);
}

// Restricted player: render a server-sanitized scene view. There is no local
// dataset and no index — the server sends only { image, audio, loopAudio, fit }
// plus playback flags, so spoilers (titles, notes, read-aloud, other scenes)
// never reach this client.
function applyPlayerView(v) {
  if (!sessionStarted) return;

  if (v.stop) {                                  // DM returned home
    audio.stopAll();
    resetSoundtrack();
    playerImageSrc = playerAudioSrc = null;
    setBlackout(true, false);
    waitingOverlay.hidden = false;
    return;
  }
  if (v.waiting) {                               // DM hasn't picked a scene yet
    audio.stopAll();
    resetSoundtrack();
    playerImageSrc = playerAudioSrc = null;
    waitingOverlay.hidden = false;
    return;
  }
  waitingOverlay.hidden = true;

  // Volume/mute are LOCAL for players — the DM doesn't control a player's device
  // audio. They set it themselves (volume slider / 'm'); we ignore v.volume/v.muted.

  // Diff on src so a volume/pause nudge never reloads art or restarts the track.
  if (v.image !== playerImageSrc) {
    loadSceneImage(v.image, ++imageGeneration, '', v.fit);
    playerImageSrc = v.image;
  }

  // Audio: a soundtrack playlist (cycling) or the scene's own single track.
  if (Array.isArray(v.playlist) && v.playlist.length) {
    const key = v.playlist.join('|');
    if (!playingSoundtrack || key !== playerPlaylistKey) {
      soundtrackList   = v.playlist;
      soundtrackIndex  = 0;
      playingSoundtrack = true;
      playerPlaylistKey = key;
      playerAudioSrc   = null;
      audio.play({ audio: soundtrackList[0], loopAudio: false });
    }
  } else {
    playingSoundtrack = false;
    playerPlaylistKey = null;
    if (v.audio !== playerAudioSrc) {
      audio.play({ audio: v.audio, loopAudio: v.loopAudio });
      playerAudioSrc = v.audio;
    }
  }

  if (v.paused !== audio.isPaused()) { if (v.paused) audio.pause(); else audio.resume(); }
  if (v.blackout !== blackoutActive) setBlackout(v.blackout, false);
}

function resolveAdventureScenesForActive() {
  if (activeAdventureId === 'all' || !activeAdventureId) { currentScenes = publicScenes(); return; }
  const adventure = allAdventures.find(a => a.id === activeAdventureId);
  currentScenes = adventure
    ? (adventure.scenes || []).map(id => allScenes.find(s => s.id === id)).filter(Boolean)
    : publicScenes();
  if (!currentScenes.length) currentScenes = publicScenes();
}

// ── Auto-hide controls + cursor ──────────────────────────────────────
function onInteraction() {
  if (presentationMode) return;
  showControls();
}

function onMouseMove() {
  if (sessionStarted) {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), CONFIG.autoHideMs);
  }
  if (!presentationMode) showControls();
}

function showControls() {
  controls.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => controls.classList.add('hidden'), CONFIG.autoHideMs);
}

// ── Keyboard shortcuts (desktop) ─────────────────────────────────────
function onKeydown(e) {
  if (!sessionStarted) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  // Restricted player gets only local controls: fullscreen + mute.
  if (isRestricted) {
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    else if (e.key === 'm' || e.key === 'M') toggleMute();
    return;
  }
  switch (e.key) {
    case 'ArrowRight': case ' ': e.preventDefault(); changeScene(1);  break;
    case 'ArrowLeft':            e.preventDefault(); changeScene(-1); break;
    case 'b': case 'B': if (!blackoutBtn.hidden) toggleBlackout();     break;
    case 'm': case 'M': toggleMute();                                  break;
    case 'f': case 'F': toggleFullscreen();                            break;
    case 't': case 'T': if (!titleBtn.hidden)   toggleTitle();         break;
    case 'p': case 'P': if (!presentBtn.hidden) togglePresentation();  break;
    case 'n': case 'N': if (isDM) toggleDmOverlay(); break;
    case 'z': case 'Z': if (isDM) toggleDmStage();   break;
  }
}

// ── State persistence ────────────────────────────────────────────────
function loadState() {
  const v = parseFloat(localStorage.getItem('dndcast_volume'));
  if (!isNaN(v)) volume = Math.max(0, Math.min(1, v));

  setTitleVisible(localStorage.getItem('dndcast_titleVisible') === 'true');
  presentationMode = localStorage.getItem('dndcast_presentationMode') === 'true';

  const fit = localStorage.getItem('dndcast_objectFit');
  if (fit === 'cover' || fit === 'contain') CONFIG.objectFit = fit;
}

// ── Quick add/edit-scene (DM only) ───────────────────────────────────
// Author or tweak a scene mid-session without leaving for the editor. Persists
// via /api/save (DM-gated server-side). Pass a scene to edit it; omit to create.
let qsEditingId  = null;   // id of the scene being edited, or null when creating
let qsOrigImages = null;   // preserved images[] of a multi-image scene being edited

function openQuickScene(scene = null) {
  qsForm.reset();
  qsLoop.checked = true;
  setQsStatus('', false);
  qsEditingId  = null;
  qsOrigImages = null;

  if (scene && scene.id) {
    qsEditingId = scene.id;
    qsHeading.textContent = 'Edit Scene';
    qsSave.textContent = 'Save & Show';
    qsSaveOnly.textContent = 'Save';
    const imgs = sceneImages(scene);
    qsTitle.value  = scene.title || '';
    qsImage.value  = imgs[0] ? imgs[0].src : '';
    qsAudio.value  = scene.audio || '';
    qsNotes.value  = scene.notes || '';
    qsScript.value = scene.dmScript || '';
    qsFit.value    = (imgs[0] && imgs[0].fit) === 'cover' ? 'cover' : 'contain';
    qsLoop.checked = scene.loopAudio !== false;
    qsSilent.checked = !!scene.silent;
    // A multi-image scene's extra images aren't editable here — preserve them.
    qsOrigImages = Array.isArray(scene.images) && scene.images.length > 1 ? [...scene.images] : null;
  } else {
    qsHeading.textContent = 'New Scene';
    qsSave.textContent = 'Add & Show';
    qsSaveOnly.textContent = 'Add only';
  }

  syncQsSilent();
  quickSceneOverlay.hidden = false;
  qsTitle.focus();
}

function closeQuickScene() { quickSceneOverlay.hidden = true; }

// Silent makes a custom audio path irrelevant — grey it out (mirrors the editor).
function syncQsSilent() {
  qsAudio.disabled       = qsSilent.checked;
  qsAudioBrowse.disabled = qsSilent.checked;
}

function setQsStatus(msg, isError) {
  qsStatus.textContent = msg;
  qsStatus.className    = isError ? 'error' : '';
}

// Upload a chosen file to /api/upload and drop the returned path into a field.
async function uploadInto(fileInput, pathInput) {
  const file = fileInput.files[0];
  if (!file) return;
  setQsStatus('Uploading ' + file.name + '…', false);
  try {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const { path } = await res.json();
    pathInput.value = path;
    setQsStatus('Uploaded ' + file.name, false);
  } catch (e) {
    setQsStatus('Upload failed: ' + e.message, true);
  }
  fileInput.value = '';
}

// Build the fields the quick modal manages (shared by create + edit).
function quickSceneFields() {
  const f = {
    title:     qsTitle.value.trim(),
    image:     qsImage.value.trim(),
    audio:     qsAudio.value.trim(),
    notes:     qsNotes.value.trim(),
    dmScript:  qsScript.value.trim(),
    fit:       qsFit.value,
    loopAudio: qsLoop.checked,
    silent:    qsSilent.checked,
  };
  return f;
}

// Apply the managed fields onto a scene object, keeping JSON clean. Preserves a
// multi-image scene's extra images, only updating the first image's src/fit.
function applyQuickFields(scene, f) {
  scene.title    = f.title;
  scene.audio    = f.audio;
  scene.notes    = f.notes;
  scene.dmScript = f.dmScript;
  scene.loopAudio = f.loopAudio;
  scene.silent   = f.silent;

  if (qsOrigImages) {                 // multi-image scene: update only the first
    const rest = qsOrigImages.slice(1);
    const first = f.fit === 'cover' ? { src: f.image, fit: 'cover' } : f.image;
    scene.images = [first, ...rest];
    delete scene.image; delete scene.fit;
  } else {                            // single image (legacy shape)
    delete scene.images;
    scene.image = f.image;
    scene.fit   = f.fit;
    if (!scene.image)            delete scene.image;
    if (scene.fit === 'contain') delete scene.fit;
  }

  if (!scene.title)    delete scene.title;
  if (!scene.audio)    delete scene.audio;
  if (!scene.notes)    delete scene.notes;
  if (!scene.dmScript) delete scene.dmScript;
  if (!scene.silent)   delete scene.silent;
  return scene;
}

// show=true navigates to the scene after saving; false just persists it.
async function saveQuickScene(show) {
  const f = quickSceneFields();
  let targetIndex = currentIndex;

  if (qsEditingId) {                  // ── edit an existing scene ──
    const scene = allScenes.find(s => s.id === qsEditingId);
    if (!scene) { setQsStatus('Scene no longer exists.', true); return; }
    applyQuickFields(scene, f);
    const idx = currentScenes.findIndex(s => s.id === qsEditingId);
    if (idx !== -1) targetIndex = idx;
  } else {                            // ── create a new scene ──
    const scene = applyQuickFields({}, f);
    scene.id = uniqueSceneId(f.title || 'scene');
    allScenes.push(scene);
    const adventure = allAdventures.find(a => a.id === activeAdventureId);
    if (adventure) {
      scene.privateTo = adventure.id;   // authored inside an adventure → private to it
      adventure.scenes = Array.isArray(adventure.scenes) ? adventure.scenes : [];
      const at = Math.min(Math.max(currentIndex + 1, 0), adventure.scenes.length);
      adventure.scenes.splice(at, 0, scene.id);
      resolveAdventureScenesForActive();
      targetIndex = at;
    } else {
      currentScenes = [...allScenes];
      targetIndex = currentScenes.length - 1;
    }
  }

  setQsStatus('Saving…', false);
  try {
    const res = await fetch('/api/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ scenes: allScenes, adventures: allAdventures, campaigns: allCampaigns }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    setQsStatus('Save failed: ' + e.message, true);
    return;                       // leave the modal open so nothing is lost
  }

  buildSceneList();
  closeQuickScene();
  // Show it, or refresh the live display if we edited the scene already on screen.
  if (show) { closeDrawer(); goToScene(targetIndex); }
  else if (qsEditingId && targetIndex === currentIndex) goToScene(currentIndex);
  else updateSceneListHighlight();
}

// ── Notebook (DM only) ───────────────────────────────────────────────
// Personal ad-hoc notes tied to the current campaign/adventure/scene. Stored
// server-side and loaded when the drawer opens (no live sync). Notes only show
// for the context they were attached to.
let notebookNotes = [];
let editingNoteId = null;   // id being edited in the modal, or null when creating
let viewingNote   = null;   // note currently open in the read-only viewer

// The ids of the DM's current context, by scope. 'all'/missing → null (not a
// valid scope to attach to).
function currentContextIds() {
  const scene = currentScenes[currentIndex];
  return {
    campaign:  activeCampaignId || null,
    adventure: (activeAdventureId && activeAdventureId !== 'all') ? activeAdventureId : null,
    scene:     scene ? scene.id : null,
  };
}

async function openNotebook() {
  closeOverflow();
  notebookDrawer.hidden = false;
  notebookBackdrop.hidden = false;
  await loadNotebook();
}

function closeNotebook() {
  notebookDrawer.hidden = true;
  notebookBackdrop.hidden = true;
}

// Offer only the scopes that exist in the current context (defaults to the first,
// i.e. Campaign when present).
function populateNoteScopes() {
  const ctx = currentContextIds();
  const labels = { campaign: 'Campaign', adventure: 'Adventure', scene: 'Scene' };
  noteScopeSelect.innerHTML = '';
  ['campaign', 'adventure', 'scene'].forEach(scope => {
    if (!ctx[scope]) return;
    const o = document.createElement('option');
    o.value = scope;
    o.textContent = labels[scope];
    noteScopeSelect.appendChild(o);
  });
}

async function loadNotebook() {
  try {
    const res = await fetch('/api/notes');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    notebookNotes = (await res.json()).notes || [];
  } catch (e) {
    setNoteStatus('Could not load notes: ' + e.message, true);
    notebookNotes = [];
  }
  renderNotebookList();
}

function renderNotebookList() {
  const ctx = currentContextIds();
  const rank = { scene: 0, adventure: 1, campaign: 2 };   // scene → adventure → campaign
  const visible = notebookNotes
    .filter(n => n.scopeId && n.scopeId === ctx[n.scope])
    .sort((a, b) => (rank[a.scope] - rank[b.scope]) || (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  notebookList.innerHTML = '';
  notebookEmpty.hidden = visible.length > 0;
  visible.forEach(note => {
    const li = document.createElement('li');
    li.className = 'nb-item';
    li.setAttribute('role', 'button');

    const tag = document.createElement('span');
    tag.className = 'nb-tag';
    tag.textContent = note.scope;
    const title = document.createElement('span');
    title.className = 'nb-title';
    title.textContent = note.title || '(untitled)';
    const preview = document.createElement('span');
    preview.className = 'nb-preview';                // truncated to one line via CSS
    preview.textContent = note.body || note.text || '';

    li.append(tag, title, preview);
    li.addEventListener('click', () => openNoteViewer(note));   // open read-only viewer
    notebookList.appendChild(li);
  });
}

// Read-only viewer for an existing note (with Edit/Delete actions).
function openNoteViewer(note) {
  viewingNote = note;
  noteViewTag.textContent   = note.scope;
  noteViewTitle.textContent = note.title || '(untitled)';
  noteViewBody.textContent  = note.body || note.text || '';
  noteView.hidden     = false;
  noteEditForm.hidden = true;
  noteModal.hidden    = false;
}

// Create (note=null) or edit an existing note in the modal form.
function openNoteEditor(note) {
  editingNoteId = note ? note.id : null;
  noteEditHeading.textContent = note ? 'Edit note' : 'New note';
  populateNoteScopes();
  noteTitle.value = note ? (note.title || '') : '';
  noteText.value  = note ? (note.body || note.text || '') : '';
  if (note) noteScopeSelect.value = note.scope;   // its scope is in the current context
  setNoteStatus('', false);
  noteView.hidden     = true;
  noteEditForm.hidden = false;
  noteModal.hidden    = false;
  noteTitle.focus();
}

function closeNoteModal() {
  noteModal.hidden = true;
  editingNoteId = null;
  viewingNote = null;
}

async function saveNote() {
  const title = noteTitle.value.trim();
  const bodyText = noteText.value.trim();
  if (!bodyText) { setNoteStatus('A note needs a body.', true); return; }
  const scope = noteScopeSelect.value;
  const scopeId = currentContextIds()[scope];
  if (!scope || !scopeId) { setNoteStatus('Nothing here to attach a note to.', true); return; }

  setNoteStatus('Saving…', false);
  const opts = { headers: { 'Content-Type': 'application/json' } };
  try {
    const res = editingNoteId
      ? await fetch('/api/notes/' + editingNoteId, { ...opts, method: 'PUT',  body: JSON.stringify({ title, body: bodyText, scope, scopeId }) })
      : await fetch('/api/notes',                   { ...opts, method: 'POST', body: JSON.stringify({ scope, scopeId, title, body: bodyText }) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    setNoteStatus('Save failed: ' + e.message, true);
    return;
  }
  closeNoteModal();
  await loadNotebook();
}

async function deleteNote(id) {
  if (!confirm('Delete this note?')) return;
  try {
    const res = await fetch('/api/notes/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    setNoteStatus('Delete failed: ' + e.message, true);
    return;
  }
  closeNoteModal();
  await loadNotebook();
}

function setNoteStatus(msg, isError) {
  noteStatus.textContent = msg;
  noteStatus.className    = isError ? 'error' : '';
}

function uniqueSceneId(title) {
  const base = slugify(title) || 'scene';
  let id = base, n = 2;
  while (allScenes.some(s => s.id === id)) id = base + '-' + (n++);
  return id;
}

function slugify(text) {
  return String(text).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// Adventure soundtrack as a playlist (back-compat with a single string). Empty
// when none. Mirrored server-side for the sanitized player view.
function soundtrackOf(adventure) {
  const s = adventure && adventure.soundtrack;
  return Array.isArray(s) ? s.filter(Boolean) : (s ? [s] : []);
}

// Decide and start audio for a scene:
//   • scene.silent → no music, even if the adventure has a soundtrack
//   • scene.audio  → that track (loops per scene.loopAudio)
//   • else soundtrack playlist → the adventure's soundtrack, continuous & looping
//   • else → silent
function playSceneAudio(scene, adventure) {
  if (scene.silent) { stopSoundtrack(); audio.play({ audio: null }); return; }
  if (scene.audio)  { stopSoundtrack(); audio.play({ audio: scene.audio, loopAudio: scene.loopAudio !== false }); return; }
  const list = soundtrackOf(adventure);
  if (!list.length) { stopSoundtrack(); audio.play({ audio: null }); return; }
  startSoundtrack(list);
}

// Begin or continue the soundtrack playlist. Scenes that inherit it keep the
// music going rather than restarting it.
function startSoundtrack(list) {
  const sameList = playingSoundtrack && list.join('|') === soundtrackList.join('|');
  soundtrackList = list;
  if (sameList && audio.current) return;        // already cycling this list
  if (!sameList) soundtrackIndex = 0;
  playingSoundtrack = true;
  audio.play({ audio: list[soundtrackIndex % list.length], loopAudio: false });
}

function stopSoundtrack() { playingSoundtrack = false; }

// Full reset on adventure change / home / stop — the next soundtrack starts fresh.
function resetSoundtrack() {
  playingSoundtrack = false;
  soundtrackList = [];
  soundtrackIndex = 0;
  playerPlaylistKey = null;
}

// Advance to the next playlist track when one ends (wraps the list). Non-looping
// scene audio also fires 'ended', but only the soundtrack runs in playlist mode.
function onAudioEnded() {
  if (!playingSoundtrack || !soundtrackList.length) return;
  soundtrackIndex = (soundtrackIndex + 1) % soundtrackList.length;
  audio.play({ audio: soundtrackList[soundtrackIndex], loopAudio: false });
}

// ── Helpers ──────────────────────────────────────────────────────────
function showError(msg) { errorMsg.textContent = msg; }
function clearError()   { errorMsg.textContent = ''; }

function escapeCssUrl(src) {
  return src.replace(/\\/g, '/').replace(/"/g, '%22').replace(/'/g, '%27');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
