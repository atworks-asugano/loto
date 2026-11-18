/**
 * 抽選会BGM（オリジナル曲・Web Audio APIで演奏）
 *   BGM.play('wait' | 'draw' | 'trace')  ループ曲を流す（曲の切り替えはフェード）
 *   BGM.sting('trace')                   当選ファンファーレ → 指定の曲へ戻る
 *   BGM.stop() / BGM.setEnabled(bool) / BGM.setVolume(0〜1)
 */
window.BGM = (() => {
  'use strict';
  let ctx = null, master = null, bus = null, noise = null;
  let timer = null, track = null, step = 0, nextTime = 0, stingT = null;
  let enabled = true, volume = 0.5, current = null;

  const SEMI = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const midi = s => { const r = /^([A-G]#?)(\d)$/.exec(s); return 12 * (Number(r[2]) + 1) + SEMI[r[1]]; };
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = volume;
    master.connect(comp); comp.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ブラウザの自動再生制限：最初の操作で音を出せるようにする
    const unlock = () => { if (ctx.state === 'suspended') ctx.resume(); };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    return true;
  }

  /* ---------- 音色 ---------- */
  function voice(out, type, freq, t, dur, peak, o = {}) {
    const a = o.a ?? 0.008, d = o.d ?? 0.08, s = o.s ?? 0.6, r = o.r ?? 0.08;
    const hold = Math.max(dur, a + d + 0.001);
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(o.glide ? freq * o.glide : freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * s, 0.0001), t + a + d);
    g.gain.setValueAtTime(Math.max(peak * s, 0.0001), t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold + r);
    node.connect(g); g.connect(out);
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = 5.6;
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * 0.012, t + Math.min(hold, 0.25) + 0.05);
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + hold + r + 0.05);
    }
    osc.start(t); osc.stop(t + hold + r + 0.05);
  }
  function noiseHit(out, t, type, freq, peak, dec, q = 1) {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dec + 0.02);
  }
  const lead  = (o, t, n, d) => { voice(o, 'square', hz(n), t, d, 0.1, { lp: 2400, vib: true, s: 0.7, glide: 0.97 }); voice(o, 'triangle', hz(n + 12), t, d, 0.035, { s: 0.5 }); };
  const lead2 = (o, t, n, d) => voice(o, 'square', hz(n), t, d, 0.05, { lp: 3200, d: 0.05, s: 0.3, r: 0.03 });
  const bass  = (o, t, n, d) => voice(o, 'triangle', hz(n), t, d, 0.3, { d: 0.1, s: 0.5, r: 0.05 });
  const stab  = (o, t, ns, d) => ns.forEach(n => voice(o, 'sawtooth', hz(n), t, d, 0.03, { lp: 1500, d: 0.06, s: 0.4, r: 0.05 }));
  const kick  = (o, t, p = 0.5) => {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.setValueAtTime(130, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(p, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.25);
  };
  const snare = (o, t, p = 0.16) => { noiseHit(o, t, 'bandpass', 1900, p, 0.13, 0.8); voice(o, 'triangle', 190, t, 0.03, p * 0.5, { a: 0.002, d: 0.03, s: 0.2, r: 0.03 }); };
  const hat   = (o, t, p = 0.04) => noiseHit(o, t, 'highpass', 7500, p, 0.035);
  const block = (o, t, p = 0.1) => { voice(o, 'sine', 1280, t, 0.02, p, { a: 0.001, d: 0.02, s: 0.1, r: 0.04 }); voice(o, 'sine', 2650, t, 0.01, p * 0.4, { a: 0.001, d: 0.01, s: 0.1, r: 0.03 }); };
  const bell  = (o, t, n, p = 0.14) => [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.12]].forEach(([k, a]) => voice(o, 'sine', hz(n) * k, t, 0.02, p * a, { a: 0.002, d: 0.2, s: 0.3, r: 1.4 }));

  /* ---------- 曲データ ---------- */
  const CH = {
    C:  { root: 36, notes: [60, 64, 67] },
    Am: { root: 45, notes: [57, 60, 64] },
    F:  { root: 41, notes: [57, 60, 65] },
    G:  { root: 43, notes: [55, 59, 62] },
  };
  // 8分音符ごとの旋律（'-' は前の音をのばす、null は休符）
  function score(bars) {
    const flat = bars.flat(), ev = new Map();
    flat.forEach((tok, i) => {
      if (!tok || tok === '-') return;
      let len = 1; while (flat[i + len] === '-') len++;
      ev.set(i, { n: midi(tok), len });
    });
    return ev;
  }
  // 待機曲「ほのぼの抽選音頭」：ヨナ抜き音階のシャッフル
  const WAIT_MELODY = score([
    ['E5', '-', 'D5', 'C5', 'A4', '-', 'C5', '-'],
    ['A4', '-', 'G4', 'A4', 'C5', '-', '-', null],
    ['D5', '-', 'C5', 'D5', 'E5', '-', 'G5', 'E5'],
    ['D5', '-', '-', null, 'G4', '-', 'A4', '-'],
    ['C5', '-', 'E5', 'G5', 'A5', '-', 'G5', 'E5'],
    ['E5', '-', 'D5', 'C5', 'A4', '-', 'C5', '-'],
    ['D5', '-', 'E5', 'D5', 'C5', '-', 'A4', 'C5'],
    ['D5', '-', '-', '-', null, null, null, null],
  ]);
  const WAIT_CHORDS = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'];
  const DRAW_CHORDS = ['C', 'F', 'G', 'C'];
  const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 3, 2, 1, 2];

  const TRACKS = {
    wait: {
      len: 64, bpm: 112,
      dur(k) { const b = 60 / this.bpm; return k % 2 ? b * 0.38 : b * 0.62; },
      play(o, t, k) {
        const bar = k >> 3, e = k & 7, ch = CH[WAIT_CHORDS[bar]], b = 60 / this.bpm;
        if (e === 0) bass(o, t, ch.root, b * 0.45);
        if (e === 4) bass(o, t, ch.root + 7, b * 0.45);
        if (e === 2 || e === 6) stab(o, t, ch.notes, b * 0.18);
        if (e === 0 || e === 4) kick(o, t, 0.32);
        if (e === 2 || e === 6) snare(o, t, 0.06);
        if (e % 2) hat(o, t, 0.03);
        if (bar % 4 === 3 && (e === 5 || e === 7)) block(o, t);
        const m = WAIT_MELODY.get(k);
        if (m) lead(o, t, m.n, m.len * b * 0.5 * 0.92);
      },
    },
    // 横線を描くとき：せかせかしたアルペジオ
    draw: {
      len: 64, bpm: 150,
      dur() { return 60 / this.bpm / 4; },
      play(o, t, k) {
        const bar = k >> 4, e = k & 15, ch = CH[DRAW_CHORDS[bar]], s16 = 60 / this.bpm / 4;
        const arp = [...ch.notes, ch.notes[0] + 12];
        lead2(o, t, arp[ARP[e]] + 12, s16 * 0.8);
        if (e % 2 === 0) bass(o, t, ch.root + (e % 4 ? 12 : 0), s16 * 1.4);
        if (e === 0 || e === 8) kick(o, t, 0.38);
        if (e === 4 || e === 12) snare(o, t, 0.09);
        hat(o, t, e % 2 ? 0.018 : 0.035);
      },
    },
    // 結果をたどるとき：ドラムロール
    trace: {
      len: 64, bpm: 96,
      dur() { return 60 / this.bpm / 8; },
      play(o, t, k) {
        const s = 60 / this.bpm / 8, ph = (k % 32) / 32;
        noiseHit(o, t, 'bandpass', 2100, 0.03 + 0.07 * ph, 0.05, 0.9);
        if (k % 32 === 0) kick(o, t, 0.45);
        if (k % 16 === 0) bass(o, t, 31, s * 15);
        if (k % 8 === 0) lead2(o, t, k % 16 === 0 ? 67 : 68, s * 7);
      },
    },
  };

  function fanfare(o, t) {
    const b = 0.11;
    [67, 72, 76].forEach((n, i) => lead(o, t + i * b, n, b * 0.9));
    const h = t + 3 * b;
    lead(o, h, 79, 0.9); stab(o, h, [60, 64, 67, 72], 0.9); bass(o, h, 36, 0.8);
    kick(o, h, 0.5); snare(o, h, 0.2);
    [0, 0.18, 0.36].forEach((d, i) => bell(o, h + 0.2 + d, i === 1 ? 88 : 84));
    return 2.4;
  }

  /* ---------- 再生制御 ---------- */
  function makeBus() { const g = ctx.createGain(); g.gain.value = 1; g.connect(master); return g; }
  function fadeOut(g, sec = 0.35) {
    if (!g) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + sec);
    setTimeout(() => g.disconnect(), (sec + 0.8) * 1000);
  }
  function stopLoop() { clearInterval(timer); timer = null; fadeOut(bus); bus = null; track = null; }
  function tick() {
    if (!track) return;
    while (nextTime < ctx.currentTime + 0.15) {
      track.play(bus, nextTime, step);
      nextTime += track.dur(step);
      step = (step + 1) % track.len;
    }
  }
  function play(name) {
    current = name; clearTimeout(stingT);
    if (!enabled || !TRACKS[name] || !init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (track === TRACKS[name] && timer) return;
    stopLoop();
    track = TRACKS[name]; bus = makeBus(); step = 0; nextTime = ctx.currentTime + 0.08;
    timer = setInterval(tick, 25); tick();
  }
  function sting(then) {
    current = then || null; clearTimeout(stingT);
    if (!enabled || !init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    stopLoop();
    const g = makeBus();
    const len = fanfare(g, ctx.currentTime + 0.05);
    stingT = setTimeout(() => { fadeOut(g, 0.2); if (current) play(current); }, len * 1000);
  }
  function stop() { current = null; clearTimeout(stingT); if (ctx) stopLoop(); }
  function setEnabled(on) { enabled = on; if (!on) { clearTimeout(stingT); if (ctx) stopLoop(); } else if (current) play(current); }
  function setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05); }

  return { play, sting, stop, setEnabled, setVolume, get enabled() { return enabled; } };
})();
