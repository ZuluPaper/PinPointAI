// Audio: procedural WebAudio SFX (no external assets) + positional mix.
// Layered rifle reports, distance low-pass + convolver reverb tails, reload foley,
// footsteps, impacts, and a subtle ambient bed (wind, distant birds, conflict rumble).
export class AudioManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = true;
    this._noiseCache = new Map();   // reusable noise buffers keyed by duration
    this._footTimer = 0;            // accumulates distance-ish for footstep cadence
    this._footPhase = 0;           // alternates left/right foot timbre
    this._ambientStarted = false;
  }

  async init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      const t = this.ac.currentTime;

      // ---- Master chain: bus -> soft limiter -> master gain -> destination ----
      this.master = this.ac.createGain();
      this.master.gain.value = 0.5;

      // Gentle brickwall-ish limiter so layered transients don't clip harshly.
      this.limiter = this.ac.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.18;
      this.limiter.connect(this.master);
      this.master.connect(this.ac.destination);

      // Dry bus (most sounds route here pre-limiter).
      this.dry = this.ac.createGain();
      this.dry.gain.value = 1.0;
      this.dry.connect(this.limiter);

      // ---- Convolver reverb (procedurally generated impulse) ----
      this.convolver = this.ac.createConvolver();
      this.convolver.buffer = this._makeImpulse(1.9, 2.6, 0.55);
      this.reverbSend = this.ac.createGain();      // global wet return level
      this.reverbSend.gain.value = 0.9;
      // Tame reverb lows/highs so tails sit behind the dry hits.
      const revTone = this.ac.createBiquadFilter();
      revTone.type = 'highpass'; revTone.frequency.value = 220;
      this.convolver.connect(revTone);
      revTone.connect(this.reverbSend);
      this.reverbSend.connect(this.limiter);

      // ---- Ambient bed bus (wind / birds / rumble) kept low under everything ----
      this.ambientBus = this.ac.createGain();
      this.ambientBus.gain.value = 0.0; // faded in on first resume()
      this.ambientBus.connect(this.limiter);

      this._buildAmbient(t);
    } catch (e) {
      this.enabled = false;
    }
  }

  resume() {
    if (!this.ac) return;
    if (this.ac.state === 'suspended') this.ac.resume();
    // Fade the ambient bed in the first time audio is unlocked by a gesture.
    if (this.enabled && !this._ambientStarted) {
      this._ambientStarted = true;
      const t = this.ac.currentTime;
      this.ambientBus.gain.cancelScheduledValues(t);
      this.ambientBus.gain.setValueAtTime(0.0001, t);
      this.ambientBus.gain.linearRampToValueAtTime(0.16, t + 3.0);
    }
  }

  // ---------------------------------------------------------------------------
  // Buffer helpers
  // ---------------------------------------------------------------------------
  _noiseBuffer(dur) {
    // White noise; cached by quantized duration so repeated shots don't reallocate.
    const key = Math.round(dur * 1000);
    let buf = this._noiseCache.get(key);
    if (buf) return buf;
    const len = Math.max(1, Math.floor(this.ac.sampleRate * dur));
    buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseCache.set(key, buf);
    return buf;
  }

  // Exponentially-decaying, slightly modulated noise = plausible small-room/outdoor tail.
  _makeImpulse(seconds, decay, damping) {
    const rate = this.ac.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ac.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0; // running low-pass state to darken the tail over time
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        const n = (Math.random() * 2 - 1) * env;
        lp += (n - lp) * (1 - damping * t); // progressively more damped
        d[i] = lp;
      }
    }
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Positional model: returns {gain, cutoff} from distance to the player.
  // ---------------------------------------------------------------------------
  _spatial(worldPos) {
    if (!worldPos || !this.ctx.player) return { dist: 0, gain: 1, cutoff: 20000 };
    const d = worldPos.distanceTo(this.ctx.player.position);
    const gain = Math.max(0.04, 1 - d / 110);
    // Air absorbs highs with distance -> low-pass cutoff falls off.
    const cutoff = Math.max(700, 20000 - d * 260);
    return { dist: d, gain, cutoff };
  }

  // ---------------------------------------------------------------------------
  // Main dispatch. Unknown types are ignored silently.
  // ---------------------------------------------------------------------------
  play(type, worldPos) {
    if (!this.enabled || !this.ac) return;
    const t = this.ac.currentTime;
    const sp = this._spatial(worldPos);

    switch (type) {
      case 'shot':        this._gunshot(t, sp, false); break;
      case 'enemyShot':   this._gunshot(t, sp, true);  break;
      case 'reload':      this._reload(t);             break;
      case 'reloadStart': this._magOut(t);             break; // optional new hook
      case 'impact':      this._impact(t, sp);         break;
      case 'ricochet':    this._impact(t, sp, true);   break;
      case 'footstep':    this._footstep(t);           break;
      case 'hurt':        this._hurt(t);               break;
      case 'empty':       this._dryFire(t);            break;
      default: break;
    }
  }

  // ---------------------------------------------------------------------------
  // Weapon: layered report = crack (supersonic snap) + body (mechanical thump)
  //         + mechanical action + distance-scaled reverb tail.
  // ---------------------------------------------------------------------------
  _gunshot(t, sp, isEnemy) {
    const atten = sp.gain;

    // Distance-driven tone shaping: enemy fire far away is dominated by the tail.
    const nearness = 1 - Math.min(1, sp.dist / 110); // 1 close, 0 far
    const bodyFreq = isEnemy ? 150 : 190;

    // --- 1) CRACK: short bright noise transient through a peaking/bandpass pair.
    const crack = this.ac.createBufferSource();
    crack.buffer = this._noiseBuffer(0.06);
    crack.playbackRate.value = 0.9 + Math.random() * 0.2;
    const crackBP = this.ac.createBiquadFilter();
    crackBP.type = 'bandpass';
    crackBP.frequency.value = isEnemy ? 2600 : 3400;
    crackBP.Q.value = 0.8;
    // Air-absorption low-pass for distance.
    const crackLP = this.ac.createBiquadFilter();
    crackLP.type = 'lowpass'; crackLP.frequency.value = sp.cutoff;
    const crackG = this.ac.createGain();
    const crackLvl = (0.85 * atten) * (0.4 + 0.6 * nearness);
    crackG.gain.setValueAtTime(crackLvl, t);
    crackG.gain.exponentialRampToValueAtTime(0.0008, t + 0.07);
    crack.connect(crackBP); crackBP.connect(crackLP); crackLP.connect(crackG);
    crackG.connect(this.dry);
    crackG.connect(this.convolver);
    crack.start(t); crack.stop(t + 0.08);

    // --- 2) BODY: pitched sine thump = muzzle blast low end.
    const body = this.ac.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(bodyFreq, t);
    body.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    const bodyG = this.ac.createGain();
    bodyG.gain.setValueAtTime(0.7 * atten, t);
    bodyG.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    body.connect(bodyG); bodyG.connect(this.dry); bodyG.connect(this.convolver);
    body.start(t); body.stop(t + 0.17);

    // --- 3) BLAST NOISE: mid-band noise body giving the report its "chest" punch.
    const blast = this.ac.createBufferSource();
    blast.buffer = this._noiseBuffer(0.13);
    const blastBP = this.ac.createBiquadFilter();
    blastBP.type = 'lowpass';
    blastBP.frequency.setValueAtTime(Math.min(sp.cutoff, 1400), t);
    blastBP.frequency.exponentialRampToValueAtTime(Math.min(sp.cutoff, 300), t + 0.13);
    const blastG = this.ac.createGain();
    blastG.gain.setValueAtTime(0.55 * atten, t);
    blastG.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    blast.connect(blastBP); blastBP.connect(blastG);
    blastG.connect(this.dry); blastG.connect(this.convolver);
    blast.start(t); blast.stop(t + 0.15);

    // --- 4) MECHANICAL: tiny metallic tick of the action (only audible up close).
    if (nearness > 0.25) {
      const mech = this.ac.createBufferSource();
      mech.buffer = this._noiseBuffer(0.03);
      const mechBP = this.ac.createBiquadFilter();
      mechBP.type = 'bandpass'; mechBP.frequency.value = 5200; mechBP.Q.value = 3;
      const mechG = this.ac.createGain();
      const mt = t + 0.03;
      mechG.gain.setValueAtTime(0.0001, mt);
      mechG.gain.linearRampToValueAtTime(0.14 * atten * nearness, mt + 0.004);
      mechG.gain.exponentialRampToValueAtTime(0.0006, mt + 0.05);
      mech.connect(mechBP); mechBP.connect(mechG); mechG.connect(this.dry);
      mech.start(mt); mech.stop(mt + 0.06);
    }
  }

  // ---------------------------------------------------------------------------
  // Reload foley: mag release/out -> mag in -> charging handle.
  // ---------------------------------------------------------------------------
  _reload(t) {
    this._magOut(t);
    this._click(t + 0.28, 3200, 0.22, 0.05);       // mag seat click
    this._click(t + 0.34, 1600, 0.20, 0.06);       // heavier seat thunk
    this._chargingHandle(t + 0.58);                 // bolt/charging handle
  }

  _magOut(t) {
    // Button click + rattly noise of the magazine leaving the well.
    this._click(t, 2600, 0.18, 0.04);
    const src = this.ac.createBufferSource();
    src.buffer = this._noiseBuffer(0.12);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 1.2;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.05);
    g.gain.linearRampToValueAtTime(0.16, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    src.connect(bp); bp.connect(g); g.connect(this.dry);
    src.start(t + 0.05); src.stop(t + 0.18);
  }

  // Metallic charging-handle: two-stage scrape (pull back) + snap (release).
  _chargingHandle(t) {
    const pull = this.ac.createBufferSource();
    pull.buffer = this._noiseBuffer(0.1);
    const pbp = this.ac.createBiquadFilter();
    pbp.type = 'bandpass'; pbp.frequency.setValueAtTime(1400, t);
    pbp.frequency.linearRampToValueAtTime(2600, t + 0.09);
    pbp.Q.value = 2;
    const pg = this.ac.createGain();
    pg.gain.setValueAtTime(0.12, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    pull.connect(pbp); pbp.connect(pg); pg.connect(this.dry);
    pull.start(t); pull.stop(t + 0.11);
    // Spring-loaded snap forward.
    this._click(t + 0.12, 4200, 0.3, 0.05, true);
  }

  // Short metallic click/clack building block. If `metal`, add a resonant ping.
  _click(t, freq, level, dur, metal = false) {
    const src = this.ac.createBufferSource();
    src.buffer = this._noiseBuffer(dur);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = metal ? 4 : 1.5;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.dry);
    src.start(t); src.stop(t + dur + 0.01);
    if (metal) {
      const ping = this.ac.createOscillator();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(freq * 1.5, t);
      const pg = this.ac.createGain();
      pg.gain.setValueAtTime(level * 0.4, t);
      pg.gain.exponentialRampToValueAtTime(0.0006, t + dur * 2.5);
      ping.connect(pg); pg.connect(this.dry);
      ping.start(t); ping.stop(t + dur * 2.5 + 0.01);
    }
  }

  _dryFire(t) { this._click(t, 3000, 0.16, 0.03, true); }

  // ---------------------------------------------------------------------------
  // Bullet impact: gritty transient + a bit of reverb; ricochet adds a pitched whine.
  // ---------------------------------------------------------------------------
  _impact(t, sp, ricochet = false) {
    const atten = sp.gain;
    const src = this.ac.createBufferSource();
    src.buffer = this._noiseBuffer(0.08);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = ricochet ? 3200 : 900; bp.Q.value = 1.1;
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = sp.cutoff;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.5 * atten, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(bp); bp.connect(lp); lp.connect(g);
    g.connect(this.dry); g.connect(this.convolver);
    src.start(t); src.stop(t + 0.1);

    if (ricochet) {
      const whine = this.ac.createOscillator();
      whine.type = 'sawtooth';
      const f0 = 2200 + Math.random() * 800;
      whine.frequency.setValueAtTime(f0, t);
      whine.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.35);
      const wg = this.ac.createGain();
      wg.gain.setValueAtTime(0.0001, t);
      wg.gain.linearRampToValueAtTime(0.1 * atten, t + 0.02);
      wg.gain.exponentialRampToValueAtTime(0.0006, t + 0.4);
      const wf = this.ac.createBiquadFilter();
      wf.type = 'bandpass'; wf.frequency.value = f0; wf.Q.value = 6;
      whine.connect(wf); wf.connect(wg); wg.connect(this.dry); wg.connect(this.convolver);
      whine.start(t); whine.stop(t + 0.42);
    }
  }

  // ---------------------------------------------------------------------------
  // Footstep: soft dusty-earth thud, alternating timbre per foot.
  // ---------------------------------------------------------------------------
  _footstep(t) {
    this._footPhase ^= 1;
    const src = this.ac.createBufferSource();
    src.buffer = this._noiseBuffer(0.09);
    src.playbackRate.value = this._footPhase ? 1.0 : 0.86;
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 520 + (this._footPhase ? 90 : 0);
    const g = this.ac.createGain();
    const lvl = 0.11 + Math.random() * 0.03;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.1);
    src.connect(lp); lp.connect(g); g.connect(this.dry);
    src.start(t); src.stop(t + 0.11);
    // Faint low thump for weight.
    const thump = this.ac.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(90, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    const tg = this.ac.createGain();
    tg.gain.setValueAtTime(0.08, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    thump.connect(tg); tg.connect(this.dry);
    thump.start(t); thump.stop(t + 0.1);
  }

  // ---------------------------------------------------------------------------
  // Player hurt: dull impact + a brief tinnitus-ish ring (restrained/respectful).
  // ---------------------------------------------------------------------------
  _hurt(t) {
    const src = this.ac.createBufferSource();
    src.buffer = this._noiseBuffer(0.18);
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(lp); lp.connect(g); g.connect(this.dry); g.connect(this.convolver);
    src.start(t); src.stop(t + 0.2);

    const ring = this.ac.createOscillator();
    ring.type = 'sine'; ring.frequency.value = 3100;
    const rg = this.ac.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.linearRampToValueAtTime(0.05, t + 0.03);
    rg.gain.exponentialRampToValueAtTime(0.0004, t + 0.9);
    ring.connect(rg); rg.connect(this.dry);
    ring.start(t); ring.stop(t + 0.95);
  }

  // ---------------------------------------------------------------------------
  // Ambient bed: filtered wind (LFO-modulated), low conflict rumble, occasional
  // distant birdsong. All persistent nodes routed through ambientBus.
  // ---------------------------------------------------------------------------
  _buildAmbient(t) {
    // --- Wind: looping noise through a slowly-swept lowpass, gently amplitude-modulated.
    const windSrc = this.ac.createBufferSource();
    windSrc.buffer = this._noiseBuffer(3.0);
    windSrc.loop = true;
    const windLP = this.ac.createBiquadFilter();
    windLP.type = 'lowpass'; windLP.frequency.value = 480;
    const windG = this.ac.createGain(); windG.gain.value = 0.5;
    windSrc.connect(windLP); windLP.connect(windG); windG.connect(this.ambientBus);
    windSrc.start(t);
    this._windSrc = windSrc;
    this._windLP = windLP;

    // Wind gust LFO -> sweeps cutoff so the wind "breathes".
    const gust = this.ac.createOscillator();
    gust.type = 'sine'; gust.frequency.value = 0.06;
    const gustDepth = this.ac.createGain(); gustDepth.gain.value = 260;
    gust.connect(gustDepth); gustDepth.connect(windLP.frequency);
    gust.start(t);
    // Second, faster shimmer LFO on wind gain.
    const gust2 = this.ac.createOscillator();
    gust2.type = 'sine'; gust2.frequency.value = 0.17;
    const gust2Depth = this.ac.createGain(); gust2Depth.gain.value = 0.18;
    gust2.connect(gust2Depth); gust2Depth.connect(windG.gain);
    gust2.start(t);

    // --- Distant conflict rumble: very low, filtered noise + slow tremolo.
    const rumbleSrc = this.ac.createBufferSource();
    rumbleSrc.buffer = this._noiseBuffer(3.0);
    rumbleSrc.loop = true;
    const rumbleLP = this.ac.createBiquadFilter();
    rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 90;
    const rumbleG = this.ac.createGain(); rumbleG.gain.value = 0.35;
    rumbleSrc.connect(rumbleLP); rumbleLP.connect(rumbleG); rumbleG.connect(this.ambientBus);
    rumbleSrc.start(t);
    const rTrem = this.ac.createOscillator();
    rTrem.type = 'sine'; rTrem.frequency.value = 0.08;
    const rTremDepth = this.ac.createGain(); rTremDepth.gain.value = 0.2;
    rTrem.connect(rTremDepth); rTremDepth.connect(rumbleG.gain);
    rTrem.start(t);

    // Birds are scheduled lazily in update() so they don't all fire at load.
    this._nextBird = t + 4 + Math.random() * 6;
    // Distant, sporadic gunfire crackle far on the horizon.
    this._nextDistantFire = t + 8 + Math.random() * 10;
  }

  // A short whistled birdsong: 2-4 pitched chirps, airy and quiet, panned far.
  _bird(t) {
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1400;
    for (let i = 0; i < notes; i++) {
      const nt = t + i * (0.09 + Math.random() * 0.05);
      const osc = this.ac.createOscillator();
      osc.type = 'sine';
      const f = base * (0.85 + Math.random() * 0.4);
      osc.frequency.setValueAtTime(f, nt);
      osc.frequency.linearRampToValueAtTime(f * 1.12, nt + 0.05);
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.0001, nt);
      g.gain.linearRampToValueAtTime(0.05, nt + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0004, nt + 0.09);
      osc.connect(g); g.connect(this.ambientBus); g.connect(this.convolver);
      osc.start(nt); osc.stop(nt + 0.1);
    }
  }

  // Very distant, muffled small-arms crackle to sell the ongoing conflict.
  _distantFire(t) {
    const bursts = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < bursts; i++) {
      const bt = t + i * (0.1 + Math.random() * 0.14);
      const src = this.ac.createBufferSource();
      src.buffer = this._noiseBuffer(0.05);
      const lp = this.ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 620; // heavily air-absorbed
      const g = this.ac.createGain();
      g.gain.setValueAtTime(0.09, bt);
      g.gain.exponentialRampToValueAtTime(0.0006, bt + 0.06);
      src.connect(lp); lp.connect(g); g.connect(this.ambientBus); g.connect(this.convolver);
      src.start(bt); src.stop(bt + 0.07);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame: drive footsteps from player movement + schedule ambient events.
  // ---------------------------------------------------------------------------
  update(dt) {
    if (!this.enabled || !this.ac || !this._ambientStarted) return;
    const t = this.ac.currentTime;
    const p = this.ctx.player;

    // --- Footsteps tied to horizontal movement speed (grounded only). ---
    if (p && p.velocity) {
      const v = p.velocity;
      const speed = Math.hypot(v.x || 0, v.z || 0);
      const grounded = p.onGround === undefined ? true : p.onGround;
      if (grounded && speed > 0.6) {
        // Cadence scales with speed; sprint -> faster steps.
        this._footTimer += speed * dt;
        const stride = 2.0; // world units per step
        if (this._footTimer >= stride) {
          this._footTimer -= stride;
          this._footstep(t);
        }
      } else {
        this._footTimer = Math.min(this._footTimer, 1.6);
      }
    }

    // --- Scheduled distant ambience. ---
    if (t >= this._nextBird) {
      this._bird(t + Math.random() * 0.2);
      this._nextBird = t + 5 + Math.random() * 12;
    }
    if (t >= this._nextDistantFire) {
      this._distantFire(t + Math.random() * 0.3);
      this._nextDistantFire = t + 12 + Math.random() * 18;
    }
  }
}
