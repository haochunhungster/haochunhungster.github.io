// 程序合成的塔可夫味音效（無外部素材依賴）
export class Audio {
  constructor() {
    this.ctx = null;
    this.unlocked = false;
    this.master = null;
    this.ambientGain = null;
    this.ambientNodes = [];
  }

  unlock() {
    if (this.unlocked) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;
    } catch (e) {
      console.warn('AudioContext unavailable', e);
    }
  }

  // 槍聲（短促爆音 + 噪聲尾音）
  playShot() {
    if (!this.unlocked) return;
    const t = this.ctx.currentTime;

    // 1) 低頻爆破（osc）
    const osc = this.ctx.createOscillator();
    const oscG = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    oscG.gain.setValueAtTime(0.55, t);
    oscG.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    osc.connect(oscG).connect(this.master);
    osc.start(t); osc.stop(t + 0.12);

    // 2) 高頻 click
    const click = this.ctx.createOscillator();
    const clickG = this.ctx.createGain();
    click.type = 'square';
    click.frequency.setValueAtTime(2400, t);
    click.frequency.exponentialRampToValueAtTime(800, t + 0.02);
    clickG.gain.setValueAtTime(0.18, t);
    clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(clickG).connect(this.master);
    click.start(t); click.stop(t + 0.04);

    // 3) 噪聲尾音（爆風）
    const noise = this._makeNoise(0.18);
    const nFilter = this.ctx.createBiquadFilter();
    nFilter.type = 'bandpass';
    nFilter.frequency.value = 1800;
    nFilter.Q.value = 0.7;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.42, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    noise.connect(nFilter).connect(nGain).connect(this.master);
    noise.start(t); noise.stop(t + 0.20);
  }

  // 換彈：兩段 click
  playReload() {
    if (!this.unlocked) return;
    this._click(this.ctx.currentTime, 600, 0.04, 0.2);
    this._click(this.ctx.currentTime + 0.7, 800, 0.05, 0.2);
    this._click(this.ctx.currentTime + 2.2, 1200, 0.04, 0.18);
  }

  playEmpty() {
    if (!this.unlocked) return;
    this._click(this.ctx.currentTime, 1100, 0.04, 0.18);
  }

  // 玩家受擊
  playHurt() {
    if (!this.unlocked) return;
    const t = this.ctx.currentTime;
    const noise = this._makeNoise(0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    noise.connect(f).connect(g).connect(this.master);
    noise.start(t); noise.stop(t + 0.22);
  }

  // 命中敵人（金屬+肉聲）
  playHit() {
    if (!this.unlocked) return;
    const t = this.ctx.currentTime;
    const noise = this._makeNoise(0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(f).connect(g).connect(this.master);
    noise.start(t); noise.stop(t + 0.10);
  }

  // 敵人死亡（低頻悶響）
  playKill() {
    if (!this.unlocked) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + 0.2);
  }

  // 腳步（極短噪聲）
  playStep(force = 0.5) {
    if (!this.unlocked) return;
    const t = this.ctx.currentTime;
    const noise = this._makeNoise(0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 350;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16 * force, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    noise.connect(f).connect(g).connect(this.master);
    noise.start(t); noise.stop(t + 0.08);
  }

  play(name) {
    if (name === 'death') {
      const t = this.ctx?.currentTime ?? 0;
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.6);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 0.8);
    } else if (name === 'extracted') {
      const t = this.ctx?.currentTime ?? 0;
      if (!this.ctx) return;
      // 上升音（成功感）
      [440, 660, 880].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, t + i * 0.12);
        g.gain.linearRampToValueAtTime(0.18, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.4);
        osc.connect(g).connect(this.master);
        osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.45);
      });
    }
  }

  // 環境低頻 + 風聲 loop
  startAmbient() {
    if (!this.unlocked || this.ambientNodes.length) return;
    const ctx = this.ctx;

    // 低頻 drone
    const drone = ctx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.value = 55;
    const droneG = ctx.createGain();
    droneG.gain.value = 0.04;
    const droneF = ctx.createBiquadFilter();
    droneF.type = 'lowpass';
    droneF.frequency.value = 200;
    drone.connect(droneF).connect(droneG).connect(this.master);
    drone.start();

    // 風聲（pink noise 近似）
    const wind = this._makeNoise(8, true); // looped buffer source
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass'; windF.frequency.value = 600; windF.Q.value = 0.5;
    const windG = ctx.createGain();
    windG.gain.value = 0.06;
    wind.connect(windF).connect(windG).connect(this.master);
    wind.start();

    this.ambientNodes = [drone, wind, droneG, windG];

    // 低頻起伏
    this._ambientLFO = setInterval(() => {
      const t = ctx.currentTime;
      const next = 0.04 + Math.random() * 0.04;
      droneG.gain.linearRampToValueAtTime(next, t + 1.5);
      const wn = 0.04 + Math.random() * 0.05;
      windG.gain.linearRampToValueAtTime(wn, t + 1.5);
    }, 1500);
  }

  stopAmbient() {
    for (const n of this.ambientNodes) {
      try { n.stop && n.stop(); } catch (e) {}
      try { n.disconnect && n.disconnect(); } catch (e) {}
    }
    this.ambientNodes = [];
    if (this._ambientLFO) clearInterval(this._ambientLFO);
  }

  // === helpers ===
  _click(t, freq, dur, gain) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.01);
  }

  _makeNoise(durationSec, loop = false) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * durationSec), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // pink-ish noise
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (loop) src.loop = true;
    return src;
  }
}
