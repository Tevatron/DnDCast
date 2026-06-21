// =====================================================================
// DnDCast — app.js
// Edit scenes.json, sessions.json, campaigns.json to customize content.
// Edit CONFIG to change global defaults.
// =====================================================================

const CONFIG = {
  fadeMs: 600,
  autoHideMs: 3000,
  objectFit: 'cover',          // 'cover' or 'contain'
  blackoutPausesAudio: true,
};

// --- State ---
let allScenes    = [];
let allSessions  = [];
let allCampaigns = [];
let currentScenes = [];
let activeCampaignId = null;
let activeSessionId  = null;

let currentIndex     = 0;
let volume           = 1;
let sessionStarted   = false;
let titleVisible     = false;
let presentationMode = false;
let blackoutActive   = false;
let notesOpen        = false;
let audioMuted       = false;

let currentAudio    = null;
let audioGeneration = 0;
let imageGeneration = 0;
let hideTimer       = null;

// --- DOM ---
const $ = id => document.getElementById(id);

const startOverlay      = $('start-overlay');
const startBtn          = $('start-btn');
const campaignOverlay   = $('campaign-overlay');
const campaignList      = $('campaign-list');
const sessionOverlay    = $('session-overlay');
const sessionPickerList = $('session-picker-list');
const sessionLabel      = $('session-label');
const switchSessionBtn  = $('switch-session-btn');
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

// --- Init ---
function init() {
  loadState();
  volumeSlider.value = volume;
  sceneDisplay.style.backgroundSize = CONFIG.objectFit;
  applyPresentationMode();

  startBtn.addEventListener('click', startSession);
  switchSessionBtn.addEventListener('click', openSessionFlow);

  prevBtn.addEventListener('click', () => changeScene(-1));
  nextBtn.addEventListener('click', () => changeScene(1));
  tapPrev.addEventListener('click', () => { showControls(); changeScene(-1); });
  tapNext.addEventListener('click', () => { showControls(); changeScene(1); });

  scenesBtn.addEventListener('click', openDrawer);
  closeDrawerBtn.addEventListener('click', closeDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);

  playPauseBtn.addEventListener('click', togglePlayPause);
  blackoutBtn.addEventListener('click',  toggleBlackout);
  titleBtn.addEventListener('click',     toggleTitle);
  fullscreenBtn.addEventListener('click',toggleFullscreen);
  presentBtn.addEventListener('click',   togglePresentation);
  presentDot.addEventListener('click',   togglePresentation);
  notesToggleBtn.addEventListener('click', toggleNotes);
  volumeSlider.addEventListener('input', onVolumeChange);

  document.addEventListener('touchstart', onInteraction, { passive: true });
  document.addEventListener('mousemove',  onInteraction);
  document.addEventListener('keydown',    onKeydown);
  document.addEventListener('fullscreenchange',       updateFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
}

// --- Session start ---
async function startSession() {
  unlockAudioContext();
  sessionStarted = true;
  startOverlay.hidden = true;
  await loadData();
}

function unlockAudioContext() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    setTimeout(() => ctx.close(), 500);
  } catch (_) {}
}

// --- Data loading ---
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

// --- Campaign / session picker flow ---
function openSessionFlow() {
  if (allCampaigns.length) {
    showCampaignPicker();
  } else if (allSessions.length) {
    showSessionPicker(null);
  } else {
    startAllScenes();
  }
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
    li.addEventListener('click', () => {
      campaignOverlay.hidden = true;
      showSessionPicker(campaign.id);
    });
    campaignList.appendChild(li);
  });

  if (allSessions.length) {
    const allLi = document.createElement('li');
    allLi.className = 'picker-card picker-all';
    allLi.innerHTML =
      `<span class="picker-title">All Campaigns</span>` +
      `<span class="picker-meta">${allSessions.length} sessions</span>`;
    allLi.addEventListener('click', () => {
      campaignOverlay.hidden = true;
      showSessionPicker(null);
    });
    campaignList.appendChild(allLi);
  }

  campaignOverlay.hidden = false;
}

function showSessionPicker(campaignId) {
  activeCampaignId = campaignId;
  const filtered = campaignId
    ? allSessions.filter(s => s.campaignId === campaignId)
    : allSessions;

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

  // Play all scenes option
  const allLi = document.createElement('li');
  allLi.className = 'picker-card picker-all';
  allLi.innerHTML =
    `<span class="picker-title">Play All Scenes</span>` +
    `<span class="picker-meta">${allScenes.length} scenes</span>`;
  allLi.addEventListener('click', startAllScenes);
  sessionPickerList.appendChild(allLi);

  // Back to campaigns if applicable
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

  // Resolve IDs to scene objects; silently skip missing IDs
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

function enterPlayer() {
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
  const parts    = [campaign?.title, session?.title].filter(Boolean);
  sessionLabel.textContent = parts.join(' — ');
}

// --- Scene navigation ---
async function goToScene(index) {
  if (!currentScenes.length) return;
  index = Math.max(0, Math.min(index, currentScenes.length - 1));
  currentIndex = index;
  localStorage.setItem('dndcast_index_' + activeSessionId, index);

  const scene = currentScenes[index];
  clearError();

  const imgGen = ++imageGeneration;
  loadSceneImage(scene.image, imgGen, scene.title);

  // Warm the next scene's image into cache
  if (index + 1 < currentScenes.length && currentScenes[index + 1].image) {
    new Image().src = currentScenes[index + 1].image;
  }

  titleOverlay.textContent = scene.title || '';
  notesContent.textContent = scene.notes || '(no notes for this scene)';
  updateSceneListHighlight();

  await switchAudio(scene);
}

function loadSceneImage(src, gen, sceneTitle) {
  if (!src) {
    // No image provided — show placeholder (intentional state, not an error)
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

function hidePlaceholder() {
  scenePlaceholder.hidden = true;
}

function changeScene(delta) {
  if (!sessionStarted || !currentScenes.length) return;
  goToScene(currentIndex + delta);
}

// --- Audio ---
async function switchAudio(scene) {
  const gen  = ++audioGeneration;
  const prev = currentAudio;
  currentAudio = null;

  if (prev) {
    await fadeAudio(prev, 0, CONFIG.fadeMs);
    prev.pause();
    prev.src = '';
  }
  if (gen !== audioGeneration) return;

  // No audio field = silent scene; clear any stale error and exit cleanly
  if (!scene.audio) {
    updatePlayPauseBtn();
    return;
  }

  const audio  = new Audio(scene.audio);
  audio.loop   = scene.loopAudio !== false;
  audio.volume = 0;
  audio.onerror = () => {
    if (gen === audioGeneration) showError('Audio not found: ' + scene.audio);
  };

  currentAudio = audio;

  try {
    await audio.play();
  } catch (_) {
    if (gen === audioGeneration) showError('Tap ▶ to start audio (autoplay blocked).');
  }

  if (gen === audioGeneration) {
    await fadeAudio(audio, audioMuted ? 0 : volume, CONFIG.fadeMs);
    updatePlayPauseBtn();
  }
}

function fadeAudio(audioEl, target, durationMs) {
  return new Promise(resolve => {
    const start = audioEl.volume;
    if (Math.abs(start - target) < 0.001 || durationMs <= 0) {
      audioEl.volume = target;
      return resolve();
    }
    const t0 = performance.now();
    function step(now) {
      const p = Math.min((now - t0) / durationMs, 1);
      audioEl.volume = start + (target - start) * p;
      if (p < 1) requestAnimationFrame(step);
      else { audioEl.volume = target; resolve(); }
    }
    requestAnimationFrame(step);
  });
}

// --- Scene list / drawer ---
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
  Array.from(sceneList.children).forEach((li, i) => {
    li.classList.toggle('current', i === currentIndex);
  });
}

function openDrawer()  { sceneDrawer.hidden = false; drawerBackdrop.hidden = false; }
function closeDrawer() { sceneDrawer.hidden = true;  drawerBackdrop.hidden = true; }

// --- Control actions ---
function togglePlayPause() {
  if (!currentAudio) return;
  if (currentAudio.paused) currentAudio.play().catch(() => {});
  else currentAudio.pause();
  updatePlayPauseBtn();
}

function updatePlayPauseBtn() {
  const paused = !currentAudio || currentAudio.paused;
  playPauseBtn.innerHTML = paused ? '&#x25B6;' : '&#x23F8;';
  playPauseBtn.title     = paused ? 'Resume' : 'Pause';
}

function toggleBlackout() {
  blackoutActive    = !blackoutActive;
  blackoutEl.hidden = !blackoutActive;
  blackoutBtn.classList.toggle('active', blackoutActive);
  if (CONFIG.blackoutPausesAudio && currentAudio) {
    if (blackoutActive) currentAudio.pause();
    else currentAudio.play().catch(() => {});
    updatePlayPauseBtn();
  }
}

function toggleTitle() {
  titleVisible = !titleVisible;
  localStorage.setItem('dndcast_titleVisible', titleVisible);
  titleBtn.classList.toggle('active', titleVisible);
  titleOverlay.classList.toggle('hidden', !titleVisible);
}

function toggleMute() {
  audioMuted = !audioMuted;
  const vol  = audioMuted ? 0 : volume;
  if (currentAudio) currentAudio.volume = vol;
  volumeSlider.value = vol;
}

function onVolumeChange() {
  volume     = parseFloat(volumeSlider.value);
  audioMuted = false;
  localStorage.setItem('dndcast_volume', volume);
  if (currentAudio) currentAudio.volume = volume;
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
  notesOpen              = !notesOpen;
  notesContent.hidden    = !notesOpen;
  notesToggleBtn.innerHTML = notesOpen ? 'Notes &#x25BE;' : 'Notes &#x25B8;';
}

// --- Auto-hide controls ---
function onInteraction() {
  if (presentationMode) return;
  showControls();
}

function showControls() {
  controls.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => controls.classList.add('hidden'), CONFIG.autoHideMs);
}

// --- Keyboard ---
function onKeydown(e) {
  if (!sessionStarted) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch (e.key) {
    case 'ArrowRight': case ' ': e.preventDefault(); changeScene(1);   break;
    case 'ArrowLeft':            e.preventDefault(); changeScene(-1);  break;
    case 'b': case 'B': toggleBlackout();    break;
    case 'm': case 'M': toggleMute();        break;
    case 'f': case 'F': toggleFullscreen();  break;
    case 't': case 'T': toggleTitle();       break;
    case 'p': case 'P': togglePresentation();break;
  }
}

// --- State persistence ---
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

// --- Helpers ---
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
