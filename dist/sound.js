const SOUND_KEY = "jinglue-sanguo:sound:v1";

function safeReadMuted() {
  try {
    return localStorage.getItem(SOUND_KEY) === "muted";
  } catch {
    return false;
  }
}

function safeWriteMuted(muted) {
  try {
    localStorage.setItem(SOUND_KEY, muted ? "muted" : "on");
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function createSoundController() {
  let muted = safeReadMuted();
  let ctx = null;

  function ensureContext() {
    if (muted || typeof window === "undefined") return null;
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

  function play(name) {
    const audio = ensureContext();
    if (!audio) return;
    try {
      if (name === "click") {
        tone(audio, { freq: 760, endFreq: 520, type: "triangle", duration: 0.045, peak: 0.045 });
      } else if (name === "order") {
        // Bamboo-seal stamp + soft bronze chime
        tone(audio, { freq: 180, endFreq: 92, type: "sine", duration: 0.09, peak: 0.09 });
        tone(audio, { freq: 523.25, type: "sine", start: 0.02, duration: 0.18, peak: 0.055 });
      } else if (name === "march") {
        // Double war drum beat
        tone(audio, { freq: 122, endFreq: 64, type: "sine", start: 0, duration: 0.14, peak: 0.12 });
        tone(audio, { freq: 130, endFreq: 66, type: "sine", start: 0.12, duration: 0.18, peak: 0.13 });
      } else if (name === "turn") {
        // Pentatonic bronze bell chord (C5-E5-G5)
        tone(audio, { freq: 523.25, type: "sine", start: 0, duration: 0.36, peak: 0.055 });
        tone(audio, { freq: 659.25, type: "sine", start: 0.05, duration: 0.36, peak: 0.045 });
        tone(audio, { freq: 783.99, type: "sine", start: 0.1, duration: 0.42, peak: 0.045 });
      } else if (name === "alert") {
        // Wooden clapper accent
        tone(audio, { freq: 880, endFreq: 660, type: "triangle", start: 0, duration: 0.07, peak: 0.07 });
        tone(audio, { freq: 988, endFreq: 740, type: "triangle", start: 0.09, duration: 0.09, peak: 0.065 });
      } else if (name === "fire") {
        // Crackling high blaze sweep
        tone(audio, { freq: 320, endFreq: 1180, type: "sawtooth", start: 0, duration: 0.22, peak: 0.07 });
        tone(audio, { freq: 740, endFreq: 240, type: "triangle", start: 0.08, duration: 0.28, peak: 0.06 });
      } else if (name === "siege") {
        // Heavy battering ram thud + wall rumble
        tone(audio, { freq: 98, endFreq: 42, type: "sine", start: 0, duration: 0.28, peak: 0.16 });
        tone(audio, { freq: 145, endFreq: 55, type: "triangle", start: 0.14, duration: 0.22, peak: 0.1 });
      } else if (name === "victory") {
        // Heroic gong/horn triumph triad
        tone(audio, { freq: 392.0, type: "triangle", start: 0, duration: 0.28, peak: 0.08 });
        tone(audio, { freq: 523.25, type: "triangle", start: 0.09, duration: 0.34, peak: 0.08 });
        tone(audio, { freq: 783.99, type: "sine", start: 0.18, duration: 0.45, peak: 0.09 });
      } else if (name === "capture") {
        // Drum + seal chime for capturing a city/officer
        tone(audio, { freq: 132, endFreq: 58, type: "sine", start: 0, duration: 0.16, peak: 0.14 });
        tone(audio, { freq: 659.25, type: "sine", start: 0.1, duration: 0.24, peak: 0.07 });
      } else if (name === "event") {
        // Imperial edict chime
        tone(audio, { freq: 587.33, type: "sine", start: 0, duration: 0.26, peak: 0.06 });
        tone(audio, { freq: 880.0, type: "sine", start: 0.12, duration: 0.36, peak: 0.06 });
      }
    } catch {
      // Never allow audio failure to affect gameplay.
    }
  }

  return {
    play,
    isMuted: () => muted,
    toggle() {
      muted = !muted;
      safeWriteMuted(muted);
      if (!muted) play("click");
      return muted;
    },
  };
}
