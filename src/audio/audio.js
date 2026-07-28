// Audio: procedural WebAudio SFX (no external assets) + simple positional mix.
export class AudioManager {
  constructor(ctx) { this.ctx = ctx; this.enabled = true; }

  async init() {
    try {
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ac.destination);
    } catch (e) { this.enabled = false; }
  }

  resume() { if (this.ac && this.ac.state === 'suspended') this.ac.resume(); }

  _noiseBuffer(dur) {
    const len = Math.floor(this.ac.sampleRate * dur);
    const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  play(type, worldPos) {
    if (!this.enabled || !this.ac) return;
    const t = this.ac.currentTime;
    let gainVal = 1, atten = 1;
    if (worldPos && this.ctx.player) {
      const d = worldPos.distanceTo(this.ctx.player.position);
      atten = Math.max(0.05, 1 - d / 90);
    }

    if (type === 'shot' || type === 'enemyShot') {
      // punchy crack: noise burst + low thump
      const src = this.ac.createBufferSource();
      src.buffer = this._noiseBuffer(0.12);
      const bp = this.ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = type === 'shot' ? 1800 : 1400; bp.Q.value = 0.7;
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.9 * atten, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t);

      const osc = this.ac.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(120, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      const og = this.ac.createGain(); og.gain.setValueAtTime(0.6 * atten, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(og); og.connect(this.master); osc.start(t); osc.stop(t + 0.15);
    } else if (type === 'reload') {
      for (let i = 0; i < 2; i++) {
        const src = this.ac.createBufferSource(); src.buffer = this._noiseBuffer(0.05);
        const hp = this.ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
        const g = this.ac.createGain(); const start = t + i * 0.5;
        g.gain.setValueAtTime(0.3, start); g.gain.exponentialRampToValueAtTime(0.001, start + 0.05);
        src.connect(hp); hp.connect(g); g.connect(this.master); src.start(start);
      }
    }
  }

  update(dt) {}
}
