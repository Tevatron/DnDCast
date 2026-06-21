// =====================================================================
// DnDCast — app.js
//
// To customize scenes: edit scenes.json
// To change global settings: edit CONFIG below
// =====================================================================

const CONFIG = {
  fadeMs: 600,               // audio crossfade duration in milliseconds
  autoHideMs: 3000,          // ms before controls auto-hide after inactivity
  objectFit: 'cover',        // 'cover' or 'contain' for scene background images
  blackoutPausesAudio: true, // if true, blackout pauses audio; if false, audio continues
};

// --- State -----------------------------------------------------------

let scenes = [];
let currentIndex = 0;
let volume = 1;
let sessionStarted = false;
let titleVisible = false;
let presentationMode = false;
let blackoutActive = false;
let notesOpen = false;
let audioMuted = false;

let currentAudio = null;
let audioGeneration = 0; // guards against stale async audio ops during rapid scene switching
let imageGeneration = 0; // guards against stale image onload callbacks
let hideTimer = null;

// --- DOM refs --------------------------------------------------------

const $ = id => document.getElementById(id);

const startOverlay   = $('start-overlay');
const startBtn       = $('start-btn');
const sceneDisplay   = $('scene-display');
const blackoutEl     = $('blackout');
const titleOverlay   = $('title-overlay');
const controls       = $('controls');
const presentDot     = $('present-dot');
const drawerBackdrop = $('drawer-backdrop');
const sceneDrawer    = $('scene-drawer');
const sceneList      = $('scene-list');
const closeDrawerBtn = $('close-drawer-btn');
const notesToggleBtn = $('notes-toggle-btn');
const notesContent   = $('notes-content');
const errorMsg       = $('error-msg');
const prevBtn        = $('prev-btn');
const nextBtn        = $('next-btn');
const scenesBtn      = $('scenes-btn');
const playPauseBtn   = $('play-pause-btn');
const blackoutBtn    = $('blackout-btn');
const titleBtn       = $('title-btn');
const fullscreenBtn  = $('fullscreen-btn');
const presentBtn     = $('present-btn');
const volumeSlider   = $('volume-slider');
const tapPrev        = $('tap-prev');
const tapNext        = $('tap-next');

// --- Init ------------------------------------------------------------

function init() {
  loadState();
  volumeSlider.value = volume;
  sceneDisplay.style.backgroundSize = CONFIG.objectFit;
  applyPresentationMode();

  startBtn.addEventListener('click', startSession);

  prevBtn.addEventListener('click',  () => changeScene(-1));
  nextBtn.addEventListener('click',  () => changeScene(1));
  tapPrev.addEventListener('click',  () => { showControls(); changeScene(-1); });
  tapNext.addEventListener('click',  () => { showControls(); changeScene(1); });

  scenesBtn.addEventListener('click',      openDrawer);
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

// --- Session start ---------------------------------------------------

async function startSession() {
  unlockAudioContext();
  sessionStarted = true;
  startOverlay.hidden = true;
  showControls();
  await loadScenes();
}

// Play a silent buffer to satisfy browser autoplay policies on first user gesture
function unlockAudioContext() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    setTimeout(() => ctx.close(), 500);
  } catch (_) { /* AudioContext not supported — HTMLAudio autoplay may still work */ }
}

// --- Scene loading ---------------------------------------------------

async function loadScenes() {
  try {
    const res = await fetch('scenes.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    scenes = await res.json();
  } catch (e) {
    showError('Could not load scenes.json — ' + e.message);
    return;
  }

  if (!Array.isArray(scenes) || !scenes.length) {
    showError('scenes.json is empty or invalid.');
    return;
  }

  buildSceneList();

  const saved = parseInt(localStorage.getItem('dndcast_index'), 10);
  const startIdx = (Number.isFinite(saved) && saved >= 0 && saved < scenes.length) ? saved : 0;
  await goToScene(startIdx);
}

function buildSceneList() {
  sceneList.innerHTML = '';
  scenes.forEach((scene, i) => {
    const li    = document.createElement('li');
    const num   = document.createElement('span');
    const label = document.createElement('span');
    num.className   = 'scene-num';
    num.textContent = i + 1;
    label.textContent = scene.title || scene.id || ('Scene ' + (i + 1));
    li.append(num, label);
    li.addEventListener('click', () => { goToScene(i); closeDrawer(); });
    sceneList.appendChild(li);
  });
}

// --- Scene navigation ------------------------------------------------

async function goToScene(index) {
  if (!scenes.length) return;
  index = Math.max(0, Math.min(index, scenes.length - 1));
  currentIndex = index;
  localStorage.setItem('dndcast_index', index);

  const scene = scenes[index];
  clearError();

  // Update background image, guarded by generation so rapid switching always
  // shows the last-requested scene rather than whichever image loads last
  const imgGen = ++imageGeneration;
  loadSceneImage(scene.image, imgGen);

  // Warm the next scene's image into browser cache
  if (index + 1 < scenes.length && scenes[index + 1].image) {
    new Image().src = scenes[index + 1].image;
  }

  titleOverlay.textContent  = scene.title || '';
  notesContent.textContent  = scene.notes  || '(no notes for this scene)';
  updateSceneListHighlight();

  await switchAudio(scene);
}

function loadSceneImage(src, gen) {
  if (!src) {
    if (gen === imageGeneration) sceneDisplay.style.backgroundImage = 'none';
    return;
  }
  const img = new Image();
  img.onload  = () => {
    if (gen === imageGeneration)
      sceneDisplay.style.backgroundImage = 'url("' + escapeCssUrl(src) + '")';
  };
  img.onerror = () => {
    if (gen === imageGeneration) {
      sceneDisplay.style.backgroundImage = 'none';
      showError('Image not found: ' + src);
    }
  };
  img.src = src;
}

function changeScene(delta) {
  if (!sessionStarted || !scenes.length) return;
  goToScene(currentIndex + delta);
}

// --- Audio -----------------------------------------------------------

async function switchAudio(scene) {
  const gen  = ++audioGeneration;
  const prev = currentAudio;
  currentAudio = null;

  // Fade out and release the previous track
  if (prev) {
    await fadeAudio(prev, 0, CONFIG.fadeMs);
    prev.pause();
    prev.src = '';
  }

  // Bail if a newer switchAudio overtook this one
  if (gen !== audioGeneration) return;

  if (!scene.audio) {
    updatePlayPauseBtn();
    return;
  }

  const audio   = new Audio(scene.audio);
  audio.loop    = scene.loopAudio !== false; // default true when omitted
  audio.volume  = 0;
  audio.onerror = () => {
    if (gen === audioGeneration) showError('Audio not found: ' + scene.audio);
  };

  currentAudio = audio;

  try {
    await audio.play();
  } catch (_) {
    // Autoplay may be blocked if the browser didn't register this as a user gesture;
    // the play button lets the DM start audio manually in that case
    if (gen === audioGeneration) showError('Tap ▶ to start audio (autoplay blocked).');
  }

  if (gen === audioGeneration) {
    await fadeAudio(audio, audioMuted ? 0 : volume, CONFIG.fadeMs);
    updatePlayPauseBtn();
  }
}

function fadeAudio(audioEl, targetVol, durationMs) {
  return new Promise(resolve => {
    const startVol = audioEl.volume;
    if (Math.abs(startVol - targetVol) < 0.001 || durationMs <= 0) {
      audioEl.volume = targetVol;
      return resolve();
    }
    const t0 = performance.now();
    function step(now) {
      const p = Math.min((now - t0) / durationMs, 1);
      audioEl.volume = startVol + (targetVol - startVol) * p;
      if (p < 1) {
        requestAnimationFrame(step);
      } else {
        audioEl.volume = targetVol;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

// --- Control actions -------------------------------------------------

function togglePlayPause() {
  if (!currentAudio) return;
  if (currentAudio.paused) {
    currentAudio.play().catch(() => {});
  } else {
    currentAudio.pause();
  }
  updatePlayPauseBtn();
}

function updatePlayPauseBtn() {
  const paused = !currentAudio || currentAudio.paused;
  playPauseBtn.innerHTML = paused ? '&#x25B6;' : '&#x23F8;';
  playPauseBtn.title     = paused ? 'Resume' : 'Pause';
}

function toggleBlackout() {
  blackoutActive       = !blackoutActive;
  blackoutEl.hidden    = !blackoutActive;
  blackoutBtn.classList.toggle('active', blackoutActive);

  if (CONFIG.blackoutPausesAudio && currentAudio) {
    if (blackoutActive) {
      currentAudio.pause();
    } else {
      currentAudio.play().catch(() => {});
    }
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
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
  }
}

function updateFullscreenBtn() {
  const isFs     = !!(document.fullscreenElement || document.webkitFullscreenElement);
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
  if (presentationMode) {
    clearTimeout(hideTimer);
    controls.classList.add('hidden');
  } else {
    showControls();
  }
}

function toggleNotes() {
  notesOpen             = !notesOpen;
  notesContent.hidden   = !notesOpen;
  notesToggleBtn.innerHTML = notesOpen ? 'Notes &#x25BE;' : 'Notes &#x25B8;';
}

// --- Controls visibility ---------------------------------------------

function onInteraction() {
  if (presentationMode) return;
  showControls();
}

function showControls() {
  controls.classList.remove('hidden');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => controls.classList.add('hidden'), CONFIG.autoHideMs);
}

// --- Scene drawer ----------------------------------------------------

function openDrawer() {
  sceneDrawer.hidden    = false;
  drawerBackdrop.hidden = false;
}

function closeDrawer() {
  sceneDrawer.hidden    = true;
  drawerBackdrop.hidden = true;
}

function updateSceneListHighlight() {
  Array.from(sceneList.children).forEach((li, i) => {
    li.classList.toggle('current', i === currentIndex);
  });
}

// --- Keyboard shortcuts (desktop) ------------------------------------

function onKeydown(e) {
  if (!sessionStarted) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  switch (e.key) {
    case 'ArrowRight':
    case ' ':
      e.preventDefault();
      changeScene(1);
      break;
    case 'ArrowLeft':
      e.preventDefault();
      changeScene(-1);
      break;
    case 'b': case 'B': toggleBlackout();     break;
    case 'm': case 'M': toggleMute();          break;
    case 'f': case 'F': toggleFullscreen();    break;
    case 't': case 'T': toggleTitle();         break;
    case 'p': case 'P': togglePresentation();  break;
  }
}

// --- State persistence -----------------------------------------------

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

// --- Helpers ---------------------------------------------------------

function showError(msg) { errorMsg.textContent = msg; }
function clearError()   { errorMsg.textContent = ''; }

// Escape characters that would break a CSS url() value
function escapeCssUrl(src) {
  return src.replace(/\\/g, '/').replace(/"/g, '%22').replace(/'/g, '%27');
}

// --- Go --------------------------------------------------------------
init();
