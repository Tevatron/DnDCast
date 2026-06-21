// =====================================================================
// AudioController — owns every <audio> element and all playback.
//
// Why a controller: the previous code kept a single `currentAudio` ref
// that was nulled during the 600ms fade, so overlapping scene/session
// switches lost track of elements and left them playing ("ghost" tracks).
//
// Guarantees here:
//   • play(scene)  → crossfades: at most ONE live + ONE fading-out track.
//   • stopAll()    → hard-kills everything instantly (session/campaign swap).
//   • A generation counter invalidates any in-flight async play() so a
//     superseded track destroys itself instead of becoming current.
//   • Button state is driven by the element's own play/pause events, so
//     the UI never drifts out of sync with reality.
// =====================================================================

export class AudioController {
  constructor(fadeMs) {
    this.fadeMs   = fadeMs;
    this.current  = null;        // the live track
    this.retiring = null;        // a track currently fading out (max one)
    this.gen      = 0;           // guards overlapping play() calls
    this.volume   = 1;
    this.muted    = false;
    this.onStateChange = null;   // () => void  — fired on play/pause/swap
    this.onError       = null;   // (src, autoplayBlocked) => void
    this._notifyBound  = () => this._notify();
  }

  // --- Public API ----------------------------------------------------

  // Start a scene's track, crossfading out whatever was playing.
  async play(scene) {
    const gen = ++this.gen;
    this._retireCurrent();

    if (!scene.audio) { this._notify(); return; }   // silent scene — valid

    const audio  = new Audio(scene.audio);
    audio.loop   = scene.loopAudio !== false;        // default true
    audio.volume = 0;
    audio.addEventListener('play',  this._notifyBound);
    audio.addEventListener('pause', this._notifyBound);
    audio.addEventListener('error', () => {
      if (gen === this.gen && this.onError) this.onError(scene.audio, false);
    });

    if (gen !== this.gen) { this._destroy(audio); return; }  // superseded already
    this.current = audio;

    try {
      await audio.play();
    } catch (_) {
      if (gen === this.gen && this.onError) this.onError(scene.audio, true);
    }

    if (gen !== this.gen) { this._destroy(audio); return; }  // superseded mid-play()
    this._fade(audio, this.muted ? 0 : this.volume, this.fadeMs);
    this._notify();
  }

  // Immediately silence and discard every track (no fade).
  stopAll() {
    this.gen++;                          // invalidate any pending play()
    this._destroy(this.retiring);
    this._destroy(this.current);
    this.retiring = null;
    this.current  = null;
    this._notify();
  }

  togglePlayPause() {
    if (!this.current) return;
    if (this.current.paused) this.current.play().catch(() => {});
    else this.current.pause();
    // button re-syncs via the play/pause event listeners
  }

  pause()    { if (this.current) this.current.pause(); }
  resume()   { if (this.current) this.current.play().catch(() => {}); }
  isPaused() { return !this.current || this.current.paused; }

  setVolume(v) {
    this.volume = v;
    this.muted  = false;
    if (this.current) { this._cancelFade(this.current); this.current.volume = v; }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.current) { this._cancelFade(this.current); this.current.volume = this.muted ? 0 : this.volume; }
    return this.muted;
  }

  // --- Internals -----------------------------------------------------

  _notify() { if (this.onStateChange) this.onStateChange(); }

  // Fade the current track out and let it self-destroy when done.
  // Keeps at most one fading-out track so rapid switching can't stack.
  _retireCurrent() {
    const a = this.current;
    this.current = null;
    if (!a) return;
    this._destroy(this.retiring);        // drop any earlier fade-out
    this.retiring = a;
    this._fade(a, 0, this.fadeMs).then(() => {
      if (this.retiring === a) { this.retiring = null; this._destroy(a); }
    });
  }

  _destroy(audio) {
    if (!audio) return;
    this._cancelFade(audio);
    audio.pause();
    audio.removeAttribute('src');
    try { audio.load(); } catch (_) {}
    if (this.current  === audio) this.current  = null;
    if (this.retiring === audio) this.retiring = null;
  }

  // Bumping the per-element token makes any running _fade() loop bail.
  _cancelFade(audio) { audio._fadeToken = (audio._fadeToken || 0) + 1; }

  _fade(audio, target, ms) {
    return new Promise(resolve => {
      const start = audio.volume;
      const token = (audio._fadeToken = (audio._fadeToken || 0) + 1);
      if (Math.abs(start - target) < 0.001 || ms <= 0) { audio.volume = target; return resolve(); }
      const t0 = performance.now();
      const step = now => {
        if (audio._fadeToken !== token) return resolve();   // cancelled/superseded
        const p = Math.min((now - t0) / ms, 1);
        audio.volume = start + (target - start) * p;
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
}
