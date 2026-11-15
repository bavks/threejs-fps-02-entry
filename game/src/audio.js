// Audio: every sound is synthesised with WebAudio — noise bursts through shaped filters for
// gunfire, sine blips for beeps and markers. There are no audio files. Sounds from the world
// are placed by distance and bearing from the listener, set once per frame by main.js. The
// context is created on the first user gesture (the Play click), as browsers require.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  const listener = { x: 0, z: 0, yaw: 0 };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  // A destination node for a sound at a world position: gain by distance, pan by bearing.
  function place(x, z, baseVol) {
    if (x === undefined) return master;
    const dx = x - listener.x;
    const dz = z - listener.z;
    const dist = Math.hypot(dx, dz);
    const vol = baseVol / (1 + dist * 0.16);
    if (vol < 0.004) return null;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    let node = gain;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      const bearing = Math.atan2(dx, dz) + listener.yaw;
      pan.pan.value = Math.max(-0.85, Math.min(0.85, Math.sin(bearing) * 0.9));
      gain.connect(pan);
      node = pan;
    }
    node.connect(master);
    return gain;
  }

  function noise(dur, filterType, freq, q, vol, when = 0, sweepTo = 0) {
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
    return g;
  }

  function tone(freq, dur, vol, type = 'sine', when = 0, sweepTo = 0, dest = null) {
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // A gunshot: crack (highpassed noise) + body (lowpassed thump) + a falling sine for weight.
  function shot(kind, x, z) {
    if (!ctx) return;
    const dest = place(x, z, 1);
    if (!dest) return;
    const own = x === undefined;
    const P = {
      wren: [2600, 500, 0.16, 300],
      boar: [1500, 320, 0.3, 190],
      krait: [3000, 620, 0.1, 330],
      harrier: [2700, 540, 0.15, 300],
      lance: [3400, 700, 0.42, 150],
    }[kind] || [2700, 540, 0.15, 300];
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = P[0];
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(own ? 0.5 : 0.8, t);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    src.connect(hp); hp.connect(g1); g1.connect(dest);
    src.start(t, Math.random()); src.stop(t + 0.09);
    const src2 = ctx.createBufferSource();
    src2.buffer = noiseBuf; src2.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = P[1];
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(own ? 0.65 : 0.9, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + P[2]);
    src2.connect(lp); lp.connect(g2); g2.connect(dest);
    src2.start(t, Math.random()); src2.stop(t + P[2] + 0.02);
    tone(P[3], P[2] * 0.8, own ? 0.25 : 0.3, 'triangle', 0, P[3] * 0.4, dest);
  }

  return {
    unlock() { return ensure(); },
    setListener(x, z, yaw) { listener.x = x; listener.z = z; listener.yaw = yaw; },
    shot,
    dryFire() { if (ctx) tone(1900, 0.04, 0.12, 'square'); },
    reload() { if (!ctx) return; tone(700, 0.05, 0.15, 'square'); tone(480, 0.05, 0.15, 'square', 0.16); tone(950, 0.06, 0.18, 'square', 0.34); },
    draw() { if (ctx) noise(0.08, 'bandpass', 1200, 1, 0.1); },
    hit(head) { if (ctx) tone(head ? 2350 : 1750, 0.06, 0.2, 'sine'); },
    kill() { if (!ctx) return; tone(1560, 0.07, 0.2); tone(2090, 0.1, 0.2, 'sine', 0.07); },
    hurt() { if (ctx) noise(0.12, 'lowpass', 500, 0.7, 0.3); },
    throwIt() { if (ctx) noise(0.16, 'bandpass', 700, 1.2, 0.08, 0, 1800); },
    bounce(x, z) { if (!ctx) return; const d = place(x, z, 0.5); if (d) tone(320, 0.05, 0.3, 'sine', 0, 140, d); },
    explosion(x, z) {
      if (!ctx) return;
      const d = place(x, z, 1.4);
      if (!d) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(60, t + 0.7);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      src.connect(lp); lp.connect(g); g.connect(d);
      src.start(t, Math.random()); src.stop(t + 0.85);
      tone(110, 0.6, 0.7, 'sine', 0, 34, d);
    },
    flashPop(x, z) { if (!ctx) return; const d = place(x, z, 0.9); if (d) { tone(2400, 0.09, 0.4, 'sine', 0, 500, d); } },
    beep(urgent) { if (ctx) tone(urgent ? 1560 : 1180, 0.06, 0.16, 'square'); },
    plantDone() { if (!ctx) return; tone(880, 0.08, 0.18, 'square'); tone(1320, 0.12, 0.18, 'square', 0.09); },
    buy() { if (ctx) tone(1240, 0.06, 0.15, 'sine'); },
    denied() { if (ctx) tone(220, 0.12, 0.15, 'square'); },
    roundEnd(won) { if (!ctx) return; tone(won ? 660 : 392, 0.16, 0.2, 'triangle'); tone(won ? 880 : 330, 0.26, 0.2, 'triangle', 0.15); },
    footstep(x, z) { if (!ctx) return; const d = place(x, z, 0.16); if (d) { const t = ctx.currentTime; const src = ctx.createBufferSource(); src.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07); src.connect(f); f.connect(g); g.connect(d); src.start(t, Math.random()); src.stop(t + 0.09); } },
  };
}
