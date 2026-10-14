// Synthesised sound effects and a soft generative soundtrack (Web Audio, no
// asset files). Each palette/chapter gets its own scale and tempo.
'use strict';
SQ.audio = (() => {
  let ctx = null;
  let master, sfxBus, musicBus, noiseBuf;
  let musicState = null;

  const ensure = () => {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
    } catch (e) {
      return false;
    }
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.32;
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  };

  const sfxOn = () => SQ.save.settings.sfx;

  const tone = (freq, dur, { type = 'sine', vol = 0.2, slide = 0, attack = 0.004, delay = 0, bus } = {}) => {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus || sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  };

  const noise = (dur, { vol = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0 } = {}) => {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(sfxBus);
    s.start(t);
    s.stop(t + dur + 0.05);
  };

  let lastBounce = 0;
  const SFX = {
    launch: (power) => {
      tone(180 + power * 260, 0.18, { type: 'triangle', vol: 0.22, slide: 2.2 });
      noise(0.12, { vol: 0.08 + power * 0.1, freq: 2400, q: 0.7 });
    },
    recall: () => tone(520, 0.3, { type: 'sine', vol: 0.12, slide: 0.45 }),
    bounce: (speed) => {
      if (!ctx || ctx.currentTime - lastBounce < 0.03) return;
      lastBounce = ctx.currentTime;
      tone(300 + Math.min(speed, 1600) * 0.25, 0.06, { type: 'square', vol: 0.05 });
    },
    clank: () => {
      tone(140, 0.12, { type: 'square', vol: 0.09, slide: 0.7 });
      noise(0.08, { vol: 0.08, freq: 4000, q: 4 });
    },
    kill: (n = 1) => {
      noise(0.25, { vol: 0.22, freq: 900, q: 0.8 });
      tone(660 * Math.pow(1.122, Math.min(n - 1, 8)), 0.2, { type: 'triangle', vol: 0.16, slide: 0.5 });
    },
    hurt: () => {
      noise(0.3, { vol: 0.25, freq: 500, q: 0.6 });
      tone(220, 0.35, { type: 'sawtooth', vol: 0.12, slide: 0.4 });
    },
    death: () => {
      noise(0.5, { vol: 0.3, freq: 300, q: 0.5, type: 'lowpass' });
      tone(330, 0.6, { type: 'sawtooth', vol: 0.12, slide: 0.25 });
    },
    clear: () => {
      [0, 4, 7, 12].forEach((s, i) =>
        tone(440 * Math.pow(2, s / 12), 0.35, { type: 'triangle', vol: 0.14, delay: i * 0.07 })
      );
    },
    switch: () => {
      tone(880, 0.1, { type: 'square', vol: 0.06 });
      tone(1320, 0.12, { type: 'square', vol: 0.05, delay: 0.06 });
    },
    portal: () => tone(300, 0.25, { type: 'sine', vol: 0.12, slide: 3 }),
    bump: () => tone(200, 0.15, { type: 'triangle', vol: 0.16, slide: 2.5 }),
    shoot: () => tone(900, 0.07, { type: 'square', vol: 0.025, slide: 0.6 }),
    spawn: () => tone(240, 0.4, { type: 'sine', vol: 0.06, slide: 1.8 }),
    move: () => tone(620, 0.04, { type: 'square', vol: 0.03 }),
    select: () => {
      tone(520, 0.08, { type: 'triangle', vol: 0.1 });
      tone(780, 0.1, { type: 'triangle', vol: 0.08, delay: 0.05 });
    },
    denied: () => tone(160, 0.12, { type: 'square', vol: 0.06 }),
  };

  // --- Music: a slow pad plus a sparse pluck line over a fixed progression.
  const SCALES = {
    sand: { root: 55, steps: [0, 2, 3, 7, 9, 10], bpm: 84, prog: [0, 5, 3, 4] },
    dusk: { root: 49, steps: [0, 3, 5, 7, 10], bpm: 92, prog: [0, 3, 5, 2] },
    tide: { root: 52, steps: [0, 2, 3, 5, 7, 8], bpm: 100, prog: [0, 5, 3, 6] },
    ember: { root: 50, steps: [0, 2, 4, 7, 9], bpm: 108, prog: [0, 4, 5, 3] },
    rust: { root: 47, steps: [0, 1, 3, 5, 7, 8, 10], bpm: 112, prog: [0, 5, 1, 4] },
    mono: { root: 45, steps: [0, 2, 3, 7, 8], bpm: 76, prog: [0, 3, 4, 0] },
    night: { root: 51, steps: [0, 3, 5, 6, 7, 10], bpm: 120, prog: [0, 3, 5, 4] },
    moss: { root: 53, steps: [0, 2, 5, 7, 9], bpm: 96, prog: [0, 3, 4, 2] },
  };
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const startMusic = (key) => {
    if (!ctx) return;
    if (musicState && musicState.key === key) return;
    stopMusic();
    const sc = SCALES[key] || SCALES.sand;
    const st = { key, step: 0, next: ctx.currentTime + 0.1, sc, timer: null, nodes: [] };
    const beat = 60 / sc.bpm / 2; // eighth notes
    const deg = (d, oct = 0) => {
      const s = sc.steps;
      const o = Math.floor(d / s.length);
      return sc.root + 12 * (o + oct) + s[((d % s.length) + s.length) % s.length];
    };
    const schedule = () => {
      if (!SQ.save.settings.music) {
        st.next = ctx.currentTime + 0.1;
        return;
      }
      while (st.next < ctx.currentTime + 0.25) {
        const t = st.next;
        const bar = Math.floor(st.step / 16) % sc.prog.length;
        const chord = sc.prog[bar];
        const delay = t - ctx.currentTime;
        if (st.step % 16 === 0) {
          // Pad chord.
          [0, 2, 4].forEach((i) =>
            tone(midi(deg(chord + i, 1)), beat * 15, {
              type: 'sine',
              vol: 0.05,
              attack: 0.8,
              delay,
              bus: musicBus,
            })
          );
          tone(midi(deg(chord, 0)), beat * 15, { type: 'triangle', vol: 0.06, attack: 0.3, delay, bus: musicBus });
        }
        // Sparse pseudo-random pluck pattern, repeatable per bar.
        const h = Math.sin((st.step % 32) * 12.9898 + bar * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        if (r < 0.34) {
          const n = deg(chord + Math.floor(r * 18), 2);
          tone(midi(n), beat * 2.5, { type: 'triangle', vol: 0.035, delay, bus: musicBus });
        }
        if (st.step % 4 === 2 && r > 0.6) noise(0.05, { vol: 0.02, freq: 6000, q: 2, delay });
        st.next += beat;
        st.step++;
      }
    };
    st.timer = setInterval(schedule, 60);
    schedule();
    musicState = st;
  };
  const stopMusic = () => {
    if (musicState) clearInterval(musicState.timer);
    musicState = null;
  };

  return {
    unlock() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (this._pendingMusic) {
        startMusic(this._pendingMusic);
        this._pendingMusic = null;
      }
    },
    play(name, ...args) {
      if (!ctx || !sfxOn() || !SFX[name]) return;
      SFX[name](...args);
    },
    music(key) {
      if (!ctx) {
        this._pendingMusic = key;
        return;
      }
      startMusic(key);
    },
  };
})();
