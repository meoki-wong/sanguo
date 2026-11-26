const SOUND_KEY = "jinglue-sanguo:sound:v1";
const BGM_KEY = "jinglue-sanguo:bgm:v1";
const PENTATONIC_NOTES = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0];
const PEACE_PATTERN = [0, 3, 4, 5, 3, 2, 0, 4, 6, 5, 3, 1];
const WAR_PATTERN = [0, 0, 3, 5, 4, 3, 2, 0, 5, 6, 4, 3];

function safeReadKey(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val;
  } catch {
    return fallback;
  }
}

function safeWriteKey(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function createSoundController() {
  let muted = safeReadKey(SOUND_KEY, "on") === "muted";
  let bgmOn = safeReadKey(BGM_KEY, "off") === "on";
  let bgmMood = "peace";
  let bgmTimer = null;
  let bgmStep = 0;
  let ctx = null;

  function ensureContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(audio, { freq = 440, endFreq = freq, type = "sine", start = 0, duration = 0.1, peak = 0.08 }) {
    const t0 = audio.currentTime + start;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + duration);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function pluckGuqin(audio, freq, duration = 1.6, peak = 0.032) {
    const t0 = audio.currentTime;
    const osc = audio.createOscillator();
    const overtone = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    overtone.type = "sine";
    overtone.frequency.setValueAtTime(freq * 2, t0);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(Math.min(2600, freq * 4.5), t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(320, freq * 1.4), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(filter);
    overtone.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    osc.start(t0);
    overtone.start(t0);
    osc.stop(t0 + duration + 0.05);
    overtone.stop(t0 + duration + 0.05);
  }

  function stopBgmLoop() {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
  }

  function tickBgm() {
    if (!bgmOn || muted || (typeof document !== "undefined" && document.hidden)) return;
    const audio = ensureContext();
    if (!audio || audio.state !== "running") return;
    try {
      const pattern = bgmMood === "war" ? WAR_PATTERN : PEACE_PATTERN;
      const idx = pattern[bgmStep % pattern.length];
      const freq = PENTATONIC_NOTES[idx];
      pluckGuqin(audio, freq, bgmMood === "war" ? 1.15 : 1.9, bgmMood === "war" ? 0.036 : 0.028);
      if (bgmStep % 4 === 0) {
        // Gentle bass drone (D3 or A2)
        tone(audio, { freq: bgmStep % 8 === 0 ? 146.83 : 110.0, type: "sine", duration: 1.8, peak: 0.018 });
      }
      if (bgmMood === "war" && bgmStep % 2 === 0) {
        // Subtle distant war drum pulse
        tone(audio, { freq: 112, endFreq: 56, type: "sine", duration: 0.16, peak: 0.045 });
      }
      bgmStep += 1;
    } catch {
      // Ignore WebAudio transient errors
    }
  }

  function startBgmLoop() {
    stopBgmLoop();
    if (!bgmOn || muted) return;
    const interval = bgmMood === "war" ? 900 : 1450;
    bgmTimer = setInterval(tickBgm, interval);
    tickBgm();
  }

  function play(name) {
    if (muted) return;
    const audio = ensureContext();
    if (!audio) return;
    if (bgmOn && !bgmTimer) startBgmLoop();
    try {
      if (name === "click") {
        tone(audio, { freq: 760, endFreq: 520, type: "triangle", duration: 0.045, peak: 0.045 });
      } else if (name === "order") {
        tone(audio, { freq: 180, endFreq: 92, type: "sine", duration: 0.09, peak: 0.09 });
        tone(audio, { freq: 523.25, type: "sine", start: 0.02, duration: 0.18, peak: 0.055 });
      } else if (name === "march") {
        tone(audio, { freq: 122, endFreq: 64, type: "sine", start: 0, duration: 0.14, peak: 0.12 });
        tone(audio, { freq: 130, endFreq: 66, type: "sine", start: 0.12, duration: 0.18, peak: 0.13 });
      } else if (name === "turn") {
        tone(audio, { freq: 523.25, type: "sine", start: 0, duration: 0.36, peak: 0.055 });
        tone(audio, { freq: 659.25, type: "sine", start: 0.05, duration: 0.36, peak: 0.045 });
        tone(audio, { freq: 783.99, type: "sine", start: 0.1, duration: 0.42, peak: 0.045 });
      } else if (name === "alert") {
        tone(audio, { freq: 880, endFreq: 660, type: "triangle", start: 0, duration: 0.07, peak: 0.07 });
        tone(audio, { freq: 988, endFreq: 740, type: "triangle", start: 0.09, duration: 0.09, peak: 0.065 });
      } else if (name === "fire") {
        tone(audio, { freq: 320, endFreq: 1180, type: "sawtooth", start: 0, duration: 0.22, peak: 0.07 });
        tone(audio, { freq: 740, endFreq: 240, type: "triangle", start: 0.08, duration: 0.28, peak: 0.06 });
      } else if (name === "siege") {
        tone(audio, { freq: 98, endFreq: 42, type: "sine", start: 0, duration: 0.28, peak: 0.16 });
        tone(audio, { freq: 145, endFreq: 55, type: "triangle", start: 0.14, duration: 0.22, peak: 0.1 });
      } else if (name === "victory") {
        tone(audio, { freq: 392.0, type: "triangle", start: 0, duration: 0.28, peak: 0.08 });
        tone(audio, { freq: 523.25, type: "triangle", start: 0.09, duration: 0.34, peak: 0.08 });
        tone(audio, { freq: 783.99, type: "sine", start: 0.18, duration: 0.45, peak: 0.09 });
      } else if (name === "capture") {
        tone(audio, { freq: 132, endFreq: 58, type: "sine", start: 0, duration: 0.16, peak: 0.14 });
        tone(audio, { freq: 659.25, type: "sine", start: 0.1, duration: 0.24, peak: 0.07 });
      } else if (name === "event") {
        tone(audio, { freq: 587.33, type: "sine", start: 0, duration: 0.26, peak: 0.06 });
        tone(audio, { freq: 880.0, type: "sine", start: 0.12, duration: 0.36, peak: 0.06 });
      } else if (name === "duel") {
        // Metallic blade clash + sharp ring
        tone(audio, { freq: 1420, endFreq: 680, type: "sawtooth", start: 0, duration: 0.09, peak: 0.075 });
        tone(audio, { freq: 1860, endFreq: 980, type: "triangle", start: 0.07, duration: 0.14, peak: 0.07 });
        tone(audio, { freq: 140, endFreq: 65, type: "sine", start: 0.05, duration: 0.16, peak: 0.11 });
      } else if (name === "tech") {
        // Ascending pentatonic chime
        tone(audio, { freq: 440, type: "sine", start: 0, duration: 0.18, peak: 0.06 });
        tone(audio, { freq: 587.33, type: "sine", start: 0.08, duration: 0.22, peak: 0.065 });
        tone(audio, { freq: 880, type: "sine", start: 0.16, duration: 0.35, peak: 0.075 });
      } else if (name === "coalition") {
        // Deep bronze horn warning
        tone(audio, { freq: 164.81, endFreq: 146.83, type: "sawtooth", start: 0, duration: 0.45, peak: 0.06 });
        tone(audio, { freq: 220, endFreq: 196, type: "triangle", start: 0.12, duration: 0.42, peak: 0.065 });
      }
    } catch {
      // Never allow audio failure to affect gameplay.
    }
  }

  return {
    play,
    isMuted: () => muted,
    isBgmEnabled: () => bgmOn,
    setBgmMood(mood) {
      const next = mood === "war" ? "war" : "peace";
      if (next === bgmMood) return;
      bgmMood = next;
      if (bgmOn && !muted) startBgmLoop();
    },
    toggleBgm() {
      bgmOn = !bgmOn;
      safeWriteKey(BGM_KEY, bgmOn ? "on" : "off");
      if (bgmOn && !muted) {
        ensureContext();
        startBgmLoop();
      } else {
        stopBgmLoop();
      }
      return bgmOn;
    },
    toggle() {
      muted = !muted;
      safeWriteKey(SOUND_KEY, muted ? "muted" : "on");
      if (muted) stopBgmLoop();
      else {
        play("click");
        if (bgmOn) startBgmLoop();
      }
      return muted;
    },
  };
}
