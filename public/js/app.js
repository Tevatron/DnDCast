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
document.body.dataset.role = role;

// ── State ────────────────────────────────────────────────────────────
let allScenes     = [];
let allAdventures = [];
let allCampaigns  = [];
let currentScenes = [];
let activeCampaignId  = null;
let activeAdventureId = null;

let currentIndex     = -1;        // -1 = nothing shown yet
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
  onState: isDM ? null : applyRemoteState,
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
const dmListenBtn        = $('dm-listen-btn');
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
const tapPrev            = $('tap-prev');
const tapNext            = $('tap-next');

// ── Init / wiring ────────────────────────────────────────────────────
function init() {
  loadState();
  volumeSlider.value = volume;
  audio.volume = volume;
  audio.onStateChange = updatePlayPauseBtn;     // button only; broadcasts are explicit
  audio.onError = (src, blocked) =>
    showError(blocked ? 'Tap ▶ to start audio (autoplay blocked).' : 'Audio not found: ' + src);
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
  dmListenBtn.addEventListener('click',   toggleDmListen);
  dmStageBtn.addEventListener('click',    toggleDmStage);
  logoutBtn.addEventListener('click',     () => fetch('/api/logout', { method: 'POST' }).then(() => { location.href = '/login'; }));
  volumeSlider.addEventListener('input',  onVolumeChange);

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
    dmListenBtn.hidden   = false;
    dmStageBtn.hidden    = false;
    startSubtitle.textContent = 'DM Control';
    audio.setLocalOutput(false);              // stay silent; cast tab is the sound
    dmOverlayBtn.classList.toggle('active', dmOverlayVisible);
    updateDmListenBtn();
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
    overflowBtn.hidden        = true;   // overflow is empty in cast mode
  }
}

// ── Session start / home ─────────────────────────────────────────────
async function startSession() {
  unlockAudioContext();
  sessionStarted = true;
  startOverlay.hidden = true;
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
    `<span class="picker-meta">${allScenes.length} scenes</span>`;
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
    currentScenes = [...allScenes];
  }

  adventureOverlay.hidden = true;
  campaignOverlay.hidden  = true;
  enterPlayer();
}

function startAllScenes() {
  activeAdventureId = 'all';
  activeCampaignId  = null;
  currentScenes     = [...allScenes];
  localStorage.setItem('dndcast_adventure', 'all');
  adventureOverlay.hidden = true;
  campaignOverlay.hidden  = true;
  enterPlayer();
}

function enterPlayer() {
  audio.stopAll();
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
function goToScene(index) {
  if (!currentScenes.length) return;
  index = Math.max(0, Math.min(index, currentScenes.length - 1));
  currentIndex = index;
  wantPlaying  = true;                 // a scene change always means "play"
  localStorage.setItem('dndcast_index_' + activeAdventureId, index);

  const scene = currentScenes[index];
  clearError();

  const imgGen = ++imageGeneration;
  loadSceneImage(scene.image, imgGen, scene.title, scene.fit);
  if (index + 1 < currentScenes.length && currentScenes[index + 1].image) {
    new Image().src = currentScenes[index + 1].image;   // warm next image
  }

  sceneCounter.textContent = (index + 1) + ' / ' + currentScenes.length;
  titleOverlay.textContent = scene.title || '';
  notesContent.textContent = scene.notes || '(no notes for this scene)';
  if (isDM) renderDmOverlay(scene);
  updateSceneListHighlight();

  audio.play(scene);
  broadcastState();
}

function changeScene(delta) {
  if (!sessionStarted || !currentScenes.length) return;
  goToScene(currentIndex + delta);
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
  dmNotesText.textContent  = scene.notes    || '(none)';
  dmScriptText.textContent = scene.dmScript || '(none)';
  applyDmOverlayVisibility();
}

function toggleDmOverlay() {
  dmOverlayVisible = !dmOverlayVisible;
  dmOverlayBtn.classList.toggle('active', dmOverlayVisible);
  applyDmOverlayVisibility();
}

function applyDmOverlayVisibility() {
  // Overlay only exists in DM role; hidden when off or before a scene loads.
  dmNotesOverlay.hidden = !(isDM && dmOverlayVisible && currentIndex >= 0);
}

function toggleOverflow() { overflowPanel.hidden = !overflowPanel.hidden; }
function closeOverflow()  { overflowPanel.hidden = true; }

function toggleDmStage() {
  isDMStaged = !isDMStaged;
  dmStageBadge.hidden = !isDMStaged;
  dmStageBtn.classList.toggle('active', isDMStaged);
  if (!isDMStaged) broadcastState();   // snap cast to wherever DM navigated
}

function toggleDmListen() {
  audio.setLocalOutput(!audio.localOutput);
  updateDmListenBtn();
}

function updateDmListenBtn() {
  const on = audio.localOutput;
  dmListenBtn.classList.toggle('active', on);
  dmListenBtn.innerHTML = on ? '&#x1F50A;' : '&#x1F507;';
  dmListenBtn.title = on ? 'Audio playing on this device' : 'Listen to audio on this device';
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
    label.textContent = scene.title || scene.id || 'Scene ' + (i + 1);
    li.append(num, label);
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
  broadcastState();
}

function onVolumeChange() {
  volume = parseFloat(volumeSlider.value);
  localStorage.setItem('dndcast_volume', volume);
  audio.setVolume(volume);
  broadcastState();
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
    paused:       !wantPlaying,
    volume:       audio.volume,    // logical volume, independent of DM local mute
    muted:        audio.muted,
    blackout:     blackoutActive,
    titleVisible,
  });
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
    currentIndex = -1;
  }

  // Volume/mute before any scene (re)start so the fade-in targets the right level.
  if (s.volume !== audio.volume || s.muted !== audio.muted) {
    volume = s.volume;
    volumeSlider.value = s.muted ? 0 : s.volume;
    audio.syncVolume(s.volume, s.muted);
  }

  if (s.sceneIndex < 0) return;                // DM hasn't picked a scene yet
  waitingOverlay.hidden = true;                // a real scene is incoming

  if (adventureChanged || s.sceneIndex !== currentIndex) {
    goToScene(s.sceneIndex);                   // plays the new scene
  }

  if (s.paused !== audio.isPaused()) {
    if (s.paused) audio.pause(); else audio.resume();
  }

  if (s.blackout !== blackoutActive) setBlackout(s.blackout, false);
  if (s.titleVisible !== titleVisible) setTitleVisible(s.titleVisible);
}

function resolveAdventureScenesForActive() {
  if (activeAdventureId === 'all' || !activeAdventureId) { currentScenes = [...allScenes]; return; }
  const adventure = allAdventures.find(a => a.id === activeAdventureId);
  currentScenes = adventure
    ? (adventure.scenes || []).map(id => allScenes.find(s => s.id === id)).filter(Boolean)
    : [...allScenes];
  if (!currentScenes.length) currentScenes = [...allScenes];
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
