// 程序合成音效，零外部音檔
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.stepTimer = 0;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this._ambience();
  }

  // ---------- 環境：風 + 低鳴 ----------
  _ambience() {
    const ctx = this.ctx;
    // 風：粉紅噪音 + 緩慢起伏的帶通
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + w * 0.03;
      b1 = 0.985 * b1 + w * 0.02;
      b2 = 0.95 * b2 + w * 0.01;
      data[i] = (b0 + b1 + b2) * 1.4;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 120;
    lfo.connect(lfoG); lfoG.connect(bp.frequency);
    lfo.start();
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start();
    // 暮色低鳴
    const drone = ctx.createOscillator();
    drone.type = 'sine'; drone.frequency.value = 55;
    const dg = ctx.createGain(); dg.gain.value = 0.04;
    drone.connect(dg); dg.connect(this.master);
    drone.start();
  }

  _env(g, t0, a, peak, d) {
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  _tone(type, f0, f1, dur, vol, t0 = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + t0;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    this._env(g, t, 0.01, vol, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noise(dur, vol, freq, t0 = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const len = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }

  shoot()   { this._tone('sine', 700, 180, 0.22, 0.25); this._noise(0.12, 0.1, 2400); }
  hitEnemy(){ this._tone('square', 220, 60, 0.15, 0.2); this._noise(0.1, 0.18, 900); }
  enemyDie(){ this._tone('sawtooth', 320, 40, 0.5, 0.22); this._noise(0.4, 0.2, 500); }
  hurt()    { this._tone('sawtooth', 160, 70, 0.3, 0.3); this._noise(0.2, 0.2, 300); }
  roll()    { this._noise(0.25, 0.12, 600); }
  step(run) { this._noise(0.06, run ? 0.07 : 0.045, 350 + Math.random() * 150); }
  collect() {
    // 上行琶音
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this._tone('sine', f, f, 0.4, 0.18, i * 0.09));
  }
  portalOpen() {
    const notes = [262, 330, 392, 523, 659];
    notes.forEach((f, i) => this._tone('triangle', f, f * 1.005, 0.8, 0.15, i * 0.15));
  }
  win() {
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => this._tone('sine', f, f, 0.9, 0.16, i * 0.18));
  }
  lose() {
    const notes = [392, 311, 233, 175];
    notes.forEach((f, i) => this._tone('triangle', f, f * 0.98, 0.9, 0.18, i * 0.25));
  }

  // 走路節奏
  footsteps(dt, moving, running) {
    if (!this.ctx || !moving) { this.stepTimer = 0; return; }
    this.stepTimer -= dt;
    if (this.stepTimer <= 0) {
      this.step(running);
      this.stepTimer = running ? 0.28 : 0.46;
    }
  }
}
