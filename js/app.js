// =====================================================================
// DnDCast — app.js (player entry point)
//
// Loads as an ES module: <script type="module" src="js/app.js">.
// Must be served over http:// (the project's local server), not file://.
//
// Content lives in scenes.json / sessions.json / campaigns.json — edit
// those (or use editor.html) to change what plays. Tunables: js/config.js.
// =====================================================================

import { CONFIG } from './config.js';
import { AudioController } from './audio.js';

// ── State ────────────────────────────────────────────────────────────
let allScenes    = [];
let allSessions  = [];
let allCampaigns = [];
let currentScenes = [];           // scenes scoped to the active session
let activeCampaignId = null;
let activeSessionId  = null;

let currentIndex     = 0;
let volume           = 1;
let sessionStarted   = false;
let titleVisible     = false;
let presentationMode = false;
let blackoutActive   = false;
let notesOpen        = false;

let imageGeneration = 0;          // guards stale image onload callbacks
let hideTimer       = null;       // controls auto-hide
let cursorTimer     = null;       // cursor auto-hide

const audio = new AudioController(CONFIG.fadeMs);

// ── DOM refs ─────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const startOverlay      = $('start-overlay');
const startBtn          = $('start-btn');
const campaignOverlay   = $('campaign-overlay');
const campaignList      = $('campaign-list');
const sessionOverlay    = $('session-overlay');
const sessionPickerList = $('session-picker-list');
const sessionLabel      = $('session-label');
const switchSessionBtn  = $('switch-session-btn');
const homeBtn           = $('home-btn');
const sceneDisplay      = $('scene-display');
const scenePlaceholder  = $('scene-placeholder');
const placeholderTitle  = $('placeholder-title');
const placeholderError  = $('placeholder-error');
const blackoutEl        = $('blackout');
const titleOverlay      = $('title-overlay');
const controls          = $('controls');
const presentDot        = $('present-dot');
const drawerBackdrop    = $('drawer-backdrop');
const sceneDrawer       = $('scene-drawer');
const sceneList         = $('scene-list');
const closeDrawerBtn    = $('close-drawer-btn');
const notesToggleBtn    = $('notes-toggle-btn');
const notesContent      = $('notes-content');
const errorMsg          = $('error-msg');
const prevBtn           = $('prev-btn');
const nextBtn           = $('next-btn');
const scenesBtn         = $('scenes-btn');
const playPauseBtn      = $('play-pause-btn');
const blackoutBtn       = $('blackout-btn');
const titleBtn          = $('title-btn');
const fullscreenBtn     = $('fullscreen-btn');
const presentBtn        = $('present-btn');
const volumeSlider      = $('volume-slider');
const tapPrev           = $('tap-prev');
const tapNext           = $('tap-next');

// ── Init / wiring ────────────────────────────────────────────────────
function init() {
  loadState();
  volumeSlider.value = volume;
  audio.volume = volume;
  audio.onStateChange = updatePlayPauseBtn;
  audio.onError = (src, blocked) =>
    showError(blocked ? 'Tap ▶ to start audio (autoplay blocked).' : 'Audio not found: ' + src);
  sceneDisplay.style.backgroundSize = CONFIG.objectFit;
  applyPresentationMode();

  startBtn.addEventListener('click',         startSession);
  switchSessionBtn.addEventListener('click', openSessionFlow);
  homeBtn.addEventListener('click',          goHome);

  prevBtn.addEventListener('click', () => changeScene(-1));
  nextBtn.addEventListener('click', () => changeScene(1));
  tapPrev.addEventListener('click', () => { showControls(); changeScene(-1); });
  tapNext.addEventListener('click', () => { showControls(); changeScene(1); });

  scenesBtn.addEventListener('click', openDrawer);
  closeDrawerBtn.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);

  playPauseBtn.addEventListener('click',  () => audio.togglePlayPause());
  blackoutBtn.addEventListener('click',   toggleBlackout);
  titleBtn.addEventListener('click',      toggleTitle);
  fullscreenBtn.addEventListener('click', toggleFullscreen);
  presentBtn.addEventListener('click',    togglePresentation);
  presentDot.addEventListener('click',    togglePresentation);
  notesToggleBtn.addEventListener('click',toggleNotes);
  volumeSlider.addEventListener('input',  onVolumeChange);

  document.addEventListener('touchstart', onInteraction, { passive: true });
  document.addEventListener('mousemove',  onMouseMove);
  document.addEventListener('keydown',    onKeydown);
  document.addEventListener('fullscreenchange',       updateFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
}

// ── Session start / home ─────────────────────────────────────────────
async function startSession() {
  unlockAudioContext();
  sessionStarted = true;
  startOverlay.hidden = true;
  await loadData();
}

// Stop everything and return to the Start Session screen.
function goHome() {
  audio.stopAll();
  sessionStarted = false;
  clearTimeout(cursorTimer);
  document.body.classList.remove('cursor-hidden');
  if (blackoutActive) {
    blackoutActive = false;
    blackoutEl.hidden = true;
    blackoutBtn.classList.remove('active');
  }
  closeDrawer();
  campaignOverlay.hidden = true;
  sessionOverlay.hidden  = true;
  startOverlay.hidden    = false;
}

// Play a silent buffer on the first gesture so mobile browsers unlock audio.
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
  const [scenesRes, sessionsRes, campaignsRes] = await Promise.allSettled([
    fetchJSON('scenes.json'),
    fetchJSON('sessions.json'),
    fetchJSON('campaigns.json'),
  ]);

  allScenes    = Array.isArray(scenesRes.value)    ? scenesRes.value    : [];
  allSessions  = Array.isArray(sessionsRes.value)  ? sessionsRes.value  : [];
  allCampaigns = Array.isArray(campaignsRes.value) ? campaignsRes.value : [];

  if (!allScenes.length) {
    showError('Could not load scenes.json or it is empty.');
    showControls();
    return;
  }
  openSessionFlow();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ── Campaign / session pickers ───────────────────────────────────────
function openSessionFlow() {
  if (allCampaigns.length)     showCampaignPicker();
  else if (allSessions.length) showSessionPicker(null);
  else                         startAllScenes();
}

function showCampaignPicker() {
  campaignList.innerHTML = '';

  allCampaigns.forEach(campaign => {
    const count = allSessions.filter(s => s.campaignId === campaign.id).length;
    const li = document.createElement('li');
    li.className = 'picker-card';
    li.innerHTML =
      `<span class="picker-title">${escHtml(campaign.title)}</span>` +
      `<span class="picker-meta">${count} session${count !== 1 ? 's' : ''}</span>` +
      (campaign.description ? `<span class="picker-desc">${escHtml(campaign.description)}</span>` : '');
    li.addEventListener('click', () => { campaignOverlay.hidden = true; showSessionPicker(campaign.id); });
    campaignList.appendChild(li);
  });

  if (allSessions.length) {
    const allLi = document.createElement('li');
    allLi.className = 'picker-card picker-all';
    allLi.innerHTML =
      `<span class="picker-title">All Campaigns</span>` +
      `<span class="picker-meta">${allSessions.length} sessions</span>`;
    allLi.addEventListener('click', () => { campaignOverlay.hidden = true; showSessionPicker(null); });
    campaignList.appendChild(allLi);
  }

  campaignOverlay.hidden = false;
}

function showSessionPicker(campaignId) {
  activeCampaignId = campaignId;
  const filtered = campaignId ? allSessions.filter(s => s.campaignId === campaignId) : allSessions;

  sessionPickerList.innerHTML = '';

  filtered.forEach(session => {
    const count = Array.isArray(session.scenes) ? session.scenes.length : 0;
    const savedIdx = parseInt(localStorage.getItem('dndcast_index_' + session.id), 10);
    const progress = (Number.isFinite(savedIdx) && savedIdx > 0) ? ' · scene ' + (savedIdx + 1) : '';

    const li = document.createElement('li');
    li.className = 'picker-card';
    li.innerHTML =
      `<span class="picker-title">${escHtml(session.title)}</span>` +
      `<span class="picker-meta">${count} scene${count !== 1 ? 's' : ''}${escHtml(progress)}</span>`;
    li.addEventListener('click', () => pickSession(session));
    sessionPickerList.appendChild(li);
  });

  // "Play all scenes" bypasses session scoping
  const allLi = document.createElement('li');
  allLi.className = 'picker-card picker-all';
  allLi.innerHTML =
    `<span class="picker-title">Play All Scenes</span>` +
    `<span class="picker-meta">${allScenes.length} scenes</span>`;
  allLi.addEventListener('click', startAllScenes);
  sessionPickerList.appendChild(allLi);

  if (allCampaigns.length) {
    const backLi = document.createElement('li');
    backLi.className = 'picker-back';
    const backBtn = document.createElement('button');
    backBtn.className = 'text-btn';
    backBtn.textContent = '← Back to Campaigns';
    backBtn.addEventListener('click', () => { sessionOverlay.hidden = true; showCampaignPicker(); });
    backLi.appendChild(backBtn);
    sessionPickerList.appendChild(backLi);
  }

  sessionOverlay.hidden = false;
}

function pickSession(session) {
  activeSessionId  = session.id;
  activeCampaignId = session.campaignId || activeCampaignId;
  localStorage.setItem('dndcast_session', session.id);
  if (activeCampaignId) localStorage.setItem('dndcast_campaign', activeCampaignId);

  // Resolve scene IDs to objects, silently skipping any missing ones
  currentScenes = (Array.isArray(session.scenes) ? session.scenes : [])
    .map(id => allScenes.find(s => s.id === id))
    .filter(Boolean);

  if (!currentScenes.length) {
    showError('Session has no valid scenes — loading all scenes instead.');
    currentScenes = [...allScenes];
  }

  sessionOverlay.hidden  = true;
  campaignOverlay.hidden = true;
  enterPlayer();
}

function startAllScenes() {
  activeSessionId  = 'all';
  activeCampaignId = null;
  currentScenes    = [...allScenes];
  localStorage.setItem('dndcast_session', 'all');
  sessionOverlay.hidden  = true;
  campaignOverlay.hidden = true;
  enterPlayer();
}

// Hard-stop prior audio so a session/campaign swap never overlaps tracks.
function enterPlayer() {
  audio.stopAll();
  const savedIdx = parseInt(localStorage.getItem('dndcast_index_' + activeSessionId), 10);
  const idx = (Number.isFinite(savedIdx) && savedIdx >= 0 && savedIdx < currentScenes.length) ? savedIdx : 0;
  updateSessionLabel();
  buildSceneList();
  showControls();
  goToScene(idx);
}

function updateSessionLabel() {
  if (activeSessionId === 'all') { sessionLabel.textContent = 'All Scenes'; return; }
  const session  = allSessions.find(s => s.id === activeSessionId);
  const campaign = allCampaigns.find(c => c.id === activeCampaignId);
  sessionLabel.textContent = [campaign?.title, session?.title].filter(Boolean).join(' — ');
}

// ── Scene navigation ─────────────────────────────────────────────────
function goToScene(index) {
  if (!currentScenes.length) return;
  index = Math.max(0, Math.min(index, currentScenes.length - 1));
  currentIndex = index;
  localStorage.setItem('dndcast_index_' + activeSessionId, index);

  const scene = currentScenes[index];
  clearError();

  const imgGen = ++imageGeneration;
  loadSceneImage(scene.image, imgGen, scene.title);

  // Warm the next scene's image into browser cache
  if (index + 1 < currentScenes.length && currentScenes[index + 1].image) {
    new Image().src = currentScenes[index + 1].image;
  }

  titleOverlay.textContent = scene.title || '';
  notesContent.textContent = scene.notes || '(no notes for this scene)';
  updateSceneListHighlight();

  audio.play(scene);     // crossfade handled by the controller
}

function changeScene(delta) {
  if (!sessionStarted || !currentScenes.length) return;
  goToScene(currentIndex + delta);
}

// Show the image, or a title-card placeholder when it's absent/broken.
function loadSceneImage(src, gen, sceneTitle) {
  if (!src) {
    if (gen === imageGeneration) {
      sceneDisplay.style.backgroundImage = 'none';
      showPlaceholder(sceneTitle, null);          // intentional, not an error
    }
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (gen === imageGeneration) {
      hidePlaceholder();
      sceneDisplay.style.backgroundImage = 'url("' + escapeCssUrl(src) + '")';
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

function openDrawer()  { sceneDrawer.hidden = false; drawerBackdrop.hidden = false; }
function closeDrawer() { sceneDrawer.hidden = true;  drawerBackdrop.hidden = true; }

// ── Control actions ──────────────────────────────────────────────────
function updatePlayPauseBtn() {
  const paused = audio.isPaused();
  playPauseBtn.innerHTML = paused ? '&#x25B6;' : '&#x23F8;';
  playPauseBtn.title     = paused ? 'Resume' : 'Pause';
}

function toggleBlackout() {
  blackoutActive    = !blackoutActive;
  blackoutEl.hidden = !blackoutActive;
  blackoutBtn.classList.toggle('active', blackoutActive);
  if (CONFIG.blackoutPausesAudio) {
    if (blackoutActive) audio.pause();
    else audio.resume();
  }
}

function toggleTitle() {
  titleVisible = !titleVisible;
  localStorage.setItem('dndcast_titleVisible', titleVisible);
  titleBtn.classList.toggle('active', titleVisible);
  titleOverlay.classList.toggle('hidden', !titleVisible);
}

function toggleMute() {
  const muted = audio.toggleMute();
  volumeSlider.value = muted ? 0 : volume;
}

function onVolumeChange() {
  volume = parseFloat(volumeSlider.value);
  localStorage.setItem('dndcast_volume', volume);
  audio.setVolume(volume);
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

// ── Auto-hide controls + cursor ──────────────────────────────────────
function onInteraction() {            // touch: controls only (no cursor)
  if (presentationMode) return;
  showControls();
}

function onMouseMove() {              // mouse: controls + cursor
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
    case 'b': case 'B': toggleBlackout();     break;
    case 'm': case 'M': toggleMute();         break;
    case 'f': case 'F': toggleFullscreen();   break;
    case 't': case 'T': toggleTitle();        break;
    case 'p': case 'P': togglePresentation(); break;
  }
}

// ── State persistence ────────────────────────────────────────────────
function loadState() {
  const v = parseFloat(localStorage.getItem('dndcast_volume'));
  if (!isNaN(v)) volume = Math.max(0, Math.min(1, v));

  titleVisible = localStorage.getItem('dndcast_titleVisible') === 'true';
  titleBtn.classList.toggle('active', titleVisible);
  titleOverlay.classList.toggle('hidden', !titleVisible);

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
