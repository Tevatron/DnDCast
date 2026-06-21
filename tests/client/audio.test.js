// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { AudioController } from '../../public/js/audio.js';

// ── Audio mock ────────────────────────────────────────────────────────
// jsdom's HTMLAudioElement doesn't implement play/pause. We provide a
// minimal mock that mirrors the real element's shape.

class MockAudio {
  constructor(src) {
    // Simulate browser behaviour: relative src becomes absolute URL.
    this.src      = src ? new URL(src, location.href).href : '';
    this.volume   = 1;
    this.loop     = true;
    this.paused   = true;
    this._fadeToken = 0;
    this._handlers  = {};
  }
  play()  { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  addEventListener(evt, fn) { this._handlers[evt] = fn; }
  removeEventListener()     {}
  removeAttribute(attr)     { if (attr === 'src') this.src = ''; }
  load() {}
}

// MockAudio is a constant — set it once, not before every test.
beforeAll(() => { global.Audio = MockAudio; });

// Use fadeMs=0 so _fade() resolves instantly (avoids rAF in tests).
function makeAudio() { return new AudioController(0); }

// ── Volume / mute ─────────────────────────────────────────────────────
describe('Volume and mute', () => {
  it('setVolume sets volume and clears muted', () => {
    const a = makeAudio();
    a.muted = true;
    a.setVolume(0.5);
    expect(a.volume).toBe(0.5);
    expect(a.muted).toBe(false);
  });

  it('toggleMute flips muted state', () => {
    const a = makeAudio();
    expect(a.toggleMute()).toBe(true);
    expect(a.muted).toBe(true);
    expect(a.toggleMute()).toBe(false);
    expect(a.muted).toBe(false);
  });

  it('_effVol returns 0 when muted', () => {
    const a = makeAudio();
    a.setVolume(0.8);
    a.muted = true;
    expect(a._effVol()).toBe(0);
  });

  it('_effVol returns volume when not muted', () => {
    const a = makeAudio();
    a.setVolume(0.6);
    expect(a._effVol()).toBe(0.6);
  });

  it('_effVol returns 0 when localOutput is false regardless of volume', () => {
    const a = makeAudio();
    a.setVolume(1);
    a.setLocalOutput(false);
    expect(a._effVol()).toBe(0);
  });

  it('syncVolume updates volume and muted without clearing muted', () => {
    const a = makeAudio();
    a.syncVolume(0.4, true);
    expect(a.volume).toBe(0.4);
    expect(a.muted).toBe(true);
  });
});

// ── play / stopAll ────────────────────────────────────────────────────
describe('play and stopAll', () => {
  it('stopAll clears current and retiring and notifies', async () => {
    const a = makeAudio();
    const notified = vi.fn();
    a.onStateChange = notified;

    await a.play({ audio: 'assets/audio/track.mp3', loopAudio: true });
    expect(a.current).not.toBeNull();

    a.stopAll();
    expect(a.current).toBeNull();
    expect(a.retiring).toBeNull();
    expect(notified).toHaveBeenCalled();
  });

  it('play with no audio sets current to null (silent scene)', async () => {
    const a = makeAudio();
    await a.play({ audio: null });
    expect(a.current).toBeNull();
  });

  it('play creates a new Audio element for a new track', async () => {
    const a = makeAudio();
    await a.play({ audio: 'assets/audio/track.mp3', loopAudio: true });
    expect(a.current).toBeInstanceOf(MockAudio);
    expect(a.current.src).toContain('track.mp3');
  });
});

// ── Same-audio continuation ───────────────────────────────────────────
describe('Same-audio continuation', () => {
  it('keeps the same Audio element when the same track plays again', async () => {
    const a    = makeAudio();
    const scene = { audio: 'assets/audio/same.mp3', loopAudio: true };

    await a.play(scene);
    const first = a.current;

    await a.play(scene);
    expect(a.current).toBe(first); // same element, not replaced
  });

  it('updates loopAudio on the live element without restarting', async () => {
    const a    = makeAudio();
    const scene = { audio: 'assets/audio/same.mp3', loopAudio: true };

    await a.play(scene);
    await a.play({ ...scene, loopAudio: false });

    expect(a.current.loop).toBe(false);
  });

  it('replaces the element for a different track', async () => {
    const a = makeAudio();
    await a.play({ audio: 'assets/audio/track-a.mp3', loopAudio: true });
    const first = a.current;

    await a.play({ audio: 'assets/audio/track-b.mp3', loopAudio: true });
    expect(a.current).not.toBe(first);
    expect(a.current.src).toContain('track-b.mp3');
  });
});

// ── State notifications ───────────────────────────────────────────────
describe('onStateChange notifications', () => {
  it('fires onStateChange when play completes', async () => {
    const a = makeAudio();
    const fn = vi.fn();
    a.onStateChange = fn;
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });
    expect(fn).toHaveBeenCalled();
  });

  it('fires onStateChange for a silent scene', async () => {
    const a = makeAudio();
    const fn = vi.fn();
    a.onStateChange = fn;
    await a.play({ audio: null });
    expect(fn).toHaveBeenCalled();
  });
});

// ── togglePlayPause ───────────────────────────────────────────────────
describe('togglePlayPause', () => {
  it('does nothing when there is no current track', () => {
    const a = makeAudio();
    expect(() => a.togglePlayPause()).not.toThrow();
  });

  it('resumes a paused track', async () => {
    const a = makeAudio();
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });
    a.pause();
    expect(a.isPaused()).toBe(true);

    a.togglePlayPause();
    expect(a.isPaused()).toBe(false);
  });

  it('pauses a playing track', async () => {
    const a = makeAudio();
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });
    expect(a.isPaused()).toBe(false);

    a.togglePlayPause();
    expect(a.isPaused()).toBe(true);
  });
});

// ── freezeFades ───────────────────────────────────────────────────────
describe('freezeFades', () => {
  it('snaps current track volume to effective volume', async () => {
    const a = makeAudio();
    a.setVolume(0.7);
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });

    // Simulate an in-flight fade that hasn't reached its target yet.
    a.current.volume = 0.1;

    a.freezeFades();

    expect(a.current.volume).toBe(0.7);
  });

  it('destroys a retiring track immediately', async () => {
    const a = makeAudio();

    // Inject a fake retiring track directly — this represents a track
    // that is mid-fade-out. freezeFades should kill it immediately.
    const retiring = new MockAudio('assets/audio/retiring.mp3');
    a.retiring = retiring;

    a.freezeFades();

    expect(a.retiring).toBeNull();
  });

  it('does not throw when there is nothing playing', () => {
    const a = makeAudio();
    expect(() => a.freezeFades()).not.toThrow();
  });

  it('respects localOutput=false when snapping volume', async () => {
    const a = makeAudio();
    a.setVolume(0.8);
    a.setLocalOutput(false);
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });

    a.current.volume = 0.5; // simulate partial fade
    a.freezeFades();

    // With localOutput=false, _effVol() is 0
    expect(a.current.volume).toBe(0);
  });
});

// ── isPaused ─────────────────────────────────────────────────────────
describe('isPaused', () => {
  it('returns true when no track is loaded', () => {
    expect(makeAudio().isPaused()).toBe(true);
  });

  it('returns false after play', async () => {
    const a = makeAudio();
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });
    expect(a.isPaused()).toBe(false);
  });

  it('returns true after pause', async () => {
    const a = makeAudio();
    await a.play({ audio: 'assets/audio/t.mp3', loopAudio: true });
    a.pause();
    expect(a.isPaused()).toBe(true);
  });
});
