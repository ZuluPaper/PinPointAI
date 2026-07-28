// HUD: diegetic-military read-outs — dynamic crosshair, hit/kill markers, health +
// stamina, ammo with low warning & reload progress, compass tape, objective banner,
// kill feed, directional damage arcs, and a red damage/low-health vignette.
//
// Public interface (do NOT change): constructor(ctx), init(), update(dt),
// showHitMarker(killed), setObjective(text). Element IDs read here are defined in
// index.html (this agent owns both files).
export class HUD {
  constructor(ctx) { this.ctx = ctx; }

  init() {
    // --- cache DOM ---
    this.magEl = document.getElementById('ammo-mag');
    this.reserveEl = document.getElementById('ammo-reserve');
    this.ammoBox = document.getElementById('ammo');
    this.weaponEl = document.getElementById('weapon-name');
    this.healthFill = document.getElementById('health-fill');
    this.healthNum = document.getElementById('health-num');
    this.staminaFill = document.getElementById('stamina-fill');
    this.hitMarker = document.getElementById('hit-marker');
    this.vignette = document.getElementById('damage-vignette');
    this.objective = document.getElementById('objective');
    this.objectiveText = document.getElementById('objective-text');
    this.compass = document.getElementById('compass');
    this.compassTape = document.getElementById('compass-tape');
    this.compassHeading = document.getElementById('compass-heading');
    this.crosshair = document.getElementById('crosshair');
    this.killFeed = document.getElementById('kill-feed');
    this.dmgLayer = document.getElementById('dmg-indicators');
    this.reloadWrap = document.getElementById('reload-wrap');
    this.reloadBar = document.getElementById('reload-bar');
    this.reloadLabel = document.getElementById('reload-label');

    // --- state ---
    this._hitT = 0;
    this._vig = 0;              // current damage-vignette opacity (decayed each frame)
    this._stamina = 1;         // HUD-side stamina model, coupled to sprint feel
    this._reloadMax = 0;
    this._prevReloading = 0;
    this._magMax = 1;          // largest mag seen for current weapon -> low-ammo scaling
    this._prevRecoil = 0;      // rising-edge detect for muzzle-flash crosshair feedback
    this._fireT = 0;           // firing-flash timer
    this._firing = false;      // cached firing state (avoid per-frame classList churn)
    // change-detection caches (avoid per-frame DOM churn)
    this._c = { mag: -1, reserve: -1, hp: -1, sta: -1, spread: -1, ads: -1, heading: -999, reloading: false };

    // Style polish + strip the raw debug read-out for review builds.
    this._injectStyle();
    this._gateDebug();

    this._buildCompass();
    this._buildDamagePool();

    // --- events ---
    this.ctx.on('player-hit', (e) => this._onHit(e.detail));
    this.ctx.on('weapon-changed', (e) => {
      if (this.weaponEl) this.weaponEl.textContent = e.detail.name;
      this._magMax = 1; // recalibrate low-ammo threshold for the new weapon
    });
    this.ctx.on('enemy-killed', () => this._pushKill());
    this.ctx.on('player-died', () => this._setDeathOverlay());

    // Keep the pause/death overlay dressing in sync no matter who toggles it
    // (main.js owns the overlay text; we react to it without touching that module).
    const title = document.getElementById('pause-title');
    if (title && window.MutationObserver) {
      const sync = () => this._syncOverlay(title.textContent);
      new MutationObserver(sync).observe(title, { childList: true, characterData: true, subtree: true });
      sync();
    }
  }

  // ---- compass tape: ticks every 15°, cardinal labels, seamless around N ----
  _buildCompass() {
    if (!this.compassTape) return;
    this._ppd = 3.4;                      // pixels per degree
    this._compassW = this.compass.clientWidth || 300;
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    // Overscan [-180, 540] so the visible ±~65° window never runs out of marks.
    for (let d = -180; d <= 540; d += 15) {
      const c = ((d % 360) + 360) % 360;
      const isCard = (c % 45) === 0;
      const isNESW = (c % 90) === 0;
      const x = (d + 180) * this._ppd;
      const th = isCard ? 10 : 6;
      const cls = 'mk' + (isCard ? ' card' : '') + (isNESW ? ' NESW' : '');
      const lbl = isCard ? `<div class="lbl">${labels[c]}</div>` : '';
      html += `<div class="${cls}" style="left:${x}px"><div class="tick" style="height:${th}px"></div>${lbl}</div>`;
    }
    this.compassTape.innerHTML = html;
  }

  // ---- pooled directional damage arcs ----
  _buildDamagePool() {
    this._dmg = [];
    if (!this.dmgLayer) return;
    for (let i = 0; i < 5; i++) {
      const el = document.createElement('div');
      el.className = 'di';
      el.innerHTML = '<div class="arc"></div>';
      this.dmgLayer.appendChild(el);
      this._dmg.push({ el, t: 0 });
    }
  }

  // ---- dev-gate the raw FPS/debug read-out ----
  // The counter itself is written by main.js; a shipping review build should not
  // show it. Hide unless a dev explicitly opts in via ?fps / #dev / #debug in the
  // URL, a global flag, or a stored preference. No other module is touched.
  _gateDebug() {
    const fpsEl = document.getElementById('fps-counter');
    if (!fpsEl) return;
    let dev = false;
    try {
      const q = (location.search + ' ' + location.hash).toLowerCase();
      dev = /\b(dev|debug|fps)\b/.test(q)
        || window.KWANZA_DEV === true
        || (window.localStorage && localStorage.getItem('kwanza-debug') === '1');
    } catch (_) { /* sandboxed / no storage — stay hidden */ }
    if (!dev) { fpsEl.style.display = 'none'; fpsEl.setAttribute('aria-hidden', 'true'); }
    else { fpsEl.classList.add('dev-on'); }
  }

  // ---- HUD styling polish, owned by this module ----
  // Injected as a single stylesheet (appended after index.html's <head> rules so it
  // wins on equal specificity). Goals from art review: legibility over blown-white
  // sky (dark stroke/backing on objective, compass, ammo), a contrast-stroked
  // crosshair with firing feedback, and unified military-UI typography.
  _injectStyle() {
    if (document.getElementById('hud-polish')) return;
    const s = document.createElement('style');
    s.id = 'hud-polish';
    // A crisp dark stroke (4-way 1px) + soft drop makes text hold on any background.
    const stroke = '-1px -1px 0 rgba(0,0,0,0.9), 1px -1px 0 rgba(0,0,0,0.9), '
                 + '-1px 1px 0 rgba(0,0,0,0.9), 1px 1px 0 rgba(0,0,0,0.9)';
    s.textContent = `
      /* ---------- legibility over bright sky ---------- */
      #objective { padding-top: 4px; padding-bottom: 4px;
        background: linear-gradient(90deg, rgba(8,8,6,0.42), rgba(8,8,6,0.0) 92%); }
      #objective .tag { color: var(--accent); font-weight: bold;
        text-shadow: ${stroke}, 0 1px 4px rgba(0,0,0,0.7); }
      #objective-text { color: var(--ink); font-weight: bold;
        text-shadow: ${stroke}, 0 2px 6px rgba(0,0,0,0.6); }

      /* compass: dark halo on ticks + labels so the tape survives white sky */
      #compass { background: linear-gradient(180deg, rgba(6,6,5,0.30), rgba(6,6,5,0.06)); }
      #compass-tape { filter: drop-shadow(0 1px 1px rgba(0,0,0,0.95)); }
      #compass .mk .lbl { font-weight: bold; text-shadow: ${stroke}; }
      #compass-heading { color: var(--accent); opacity: 1; font-weight: bold;
        text-shadow: ${stroke}, 0 1px 3px rgba(0,0,0,0.7); }

      /* ammo + weapon: stronger backing so the big numerals never blow out */
      #ammo { text-shadow: ${stroke}, 0 3px 10px rgba(0,0,0,0.7); }
      #weapon-name { color: var(--ink-dim); font-weight: bold; text-shadow: ${stroke}; }
      #health-num { text-shadow: ${stroke}; }
      #kill-feed .kf { font-weight: bold; }

      /* ---------- crosshair: contrast stroke + state feedback ---------- */
      #crosshair .line, #crosshair .dot {
        background: rgba(240,233,216,0.96);
        box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 3px rgba(0,0,0,0.95); }
      /* muzzle-flash tick: crosshair briefly warms to brass on fire */
      #crosshair.firing .line, #crosshair.firing .dot {
        background: var(--accent);
        box-shadow: 0 0 0 1px rgba(0,0,0,0.6), 0 0 6px rgba(201,164,92,0.85); }
      #crosshair .dot { transition: background 0.05s linear; }

      /* ---------- unified typography: even military tracking ---------- */
      #hud { font-variant-numeric: tabular-nums; }
      #reload-label, #compass-heading, #weapon-name { text-transform: uppercase; }

      /* keep the debug read-out unobtrusive even when a dev opts back in */
      #fps-counter.dev-on { opacity: 0.5; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- incoming damage: red flash + directional arc ----
  _onHit(detail) {
    const amt = detail?.amount || 10;
    this._vig = Math.min(0.85, this._vig + 0.28 + amt / 45);

    const dir = detail?.fromDir;
    if (dir && this._dmg.length) {
      // Project the world-space threat direction into a screen bearing (0 = ahead/up,
      // +clockwise). Player forward for yaw is (-sin,-cos); right is (-cos, sin).
      const y = this.ctx.player.yaw;
      const s = Math.sin(y), c = Math.cos(y);
      const dotF = dir.x * (-s) + dir.z * (-c);
      const dotR = dir.x * (-c) + dir.z * (s);
      const ang = Math.atan2(dotR, dotF) * 180 / Math.PI;
      const slot = this._dmg.reduce((a, b) => (b.t < a.t ? b : a));
      slot.el.style.transform = `rotate(${ang}deg)`;
      slot.t = 1.15;
    }
  }

  _pushKill() {
    if (!this.killFeed) return;
    const el = document.createElement('div');
    el.className = 'kf';
    // Restrained, non-glorifying phrasing for a serious historical setting.
    el.innerHTML = 'CONTACT <span class="x">✕</span> DOWN';
    this.killFeed.appendChild(el);
    // Cap the feed length.
    while (this.killFeed.children.length > 4) this.killFeed.removeChild(this.killFeed.firstChild);
    setTimeout(() => { el.classList.add('fade'); }, 3400);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 3950);
  }

  _syncOverlay(text) {
    const ov = document.getElementById('pause-overlay');
    const sub = document.getElementById('pause-sub');
    if (!ov) return;
    const dead = /DIED/i.test(text || '');
    ov.classList.toggle('dead', dead);
    if (sub) sub.textContent = dead ? 'The plantation falls quiet.' : 'Hold the line.';
  }

  _setDeathOverlay() { this._syncOverlay('YOU DIED'); }

  // ==================== PUBLIC ====================
  showHitMarker(killed) {
    if (!this.hitMarker) return;
    this.hitMarker.style.opacity = '1';
    this.hitMarker.querySelectorAll('.hm').forEach((el) => {
      el.style.background = killed ? '#ff5544' : '#fff';
      el.style.height = el.classList.contains('hm-v') ? '100%' : (killed ? '3px' : '2px');
      el.style.width = el.classList.contains('hm-h') ? '100%' : (killed ? '3px' : '2px');
    });
    // restart the pop animation on kills
    this.hitMarker.classList.remove('kill');
    if (killed) { void this.hitMarker.offsetWidth; this.hitMarker.classList.add('kill'); }
    this._hitT = killed ? 0.32 : 0.18;
  }

  setObjective(text) {
    if (!this.objectiveText) return;
    this.objectiveText.textContent = text;
    if (this.objective) { // replay the slide-in flash
      this.objective.classList.remove('flash');
      void this.objective.offsetWidth;
      this.objective.classList.add('flash');
    }
  }

  update(dt) {
    const w = this.ctx.weapons;
    const p = this.ctx.player;
    const c = this._c;

    // --- ammo + low warning ---
    const reloading = w.reloading > 0;
    const magVal = reloading ? '--' : w.mag;
    if (w.mag > this._magMax) this._magMax = w.mag;
    if (c.mag !== magVal) { this.magEl.textContent = magVal; c.mag = magVal; }
    if (c.reserve !== w.reserve) { this.reserveEl.textContent = w.reserve; c.reserve = w.reserve; }
    const low = !reloading && w.mag <= Math.max(5, this._magMax * 0.3);
    const empty = !reloading && w.mag <= 0;
    this.ammoBox.classList.toggle('low', low && !empty);
    this.ammoBox.classList.toggle('empty', empty);

    // --- reload progress read-out ---
    if (reloading && this._prevReloading <= 0) this._reloadMax = w.reloading;
    if (c.reloading !== reloading) {
      this.reloadWrap.classList.toggle('on', reloading);
      this.reloadLabel.classList.toggle('on', reloading);
      c.reloading = reloading;
    }
    if (reloading && this._reloadMax > 0) {
      this.reloadBar.style.width = `${Math.max(0, Math.min(1, 1 - w.reloading / this._reloadMax)) * 100}%`;
    }
    this._prevReloading = w.reloading;

    // --- health ---
    const hpPct = Math.max(0, p.health / p.maxHealth) * 100;
    if (Math.abs(hpPct - c.hp) > 0.5) {
      this.healthFill.style.width = `${hpPct}%`;
      this.healthNum.textContent = Math.ceil(Math.max(0, p.health));
      this.healthFill.classList.toggle('low', hpPct <= 30);
      c.hp = hpPct;
    }

    // --- stamina (HUD-side model tied to sprint) ---
    const sprinting = !!p.sprinting;
    this._stamina = sprinting
      ? Math.max(0, this._stamina - dt * 0.28)
      : Math.min(1, this._stamina + dt * 0.42);
    const staPct = this._stamina * 100;
    if (Math.abs(staPct - c.sta) > 0.8) { this.staminaFill.style.width = `${staPct}%`; c.sta = staPct; }

    // --- crosshair: dynamic spread + ADS fade + fire feedback ---
    const recoil = w.recoil || 0;         // harmless if weapon has no .recoil
    const moveSpread = Math.hypot(p.velocity.x, p.velocity.z) * 1.15;
    const fireSpread = recoil * 8;
    const ads = w.ads || 0;
    const spread = Math.max(2, 7 + moveSpread + fireSpread - ads * 9);
    if (Math.abs(spread - c.spread) > 0.3) { this.crosshair.style.setProperty('--sp', `${spread}px`); c.spread = spread; }
    if (Math.abs(ads - c.ads) > 0.02) { this.crosshair.style.opacity = `${1 - ads * 0.9}`; c.ads = ads; }
    // Rising recoil edge = a shot was fired -> brief brass muzzle-flash tick.
    if (recoil > this._prevRecoil + 0.015) this._fireT = 0.07;
    this._prevRecoil = recoil;
    if (this._fireT > 0) this._fireT = Math.max(0, this._fireT - dt);
    const firing = this._fireT > 0;
    if (firing !== this._firing) { this.crosshair.classList.toggle('firing', firing); this._firing = firing; }

    // --- compass tape ---
    let deg = (-p.yaw * 180 / Math.PI) % 360; if (deg < 0) deg += 360;
    if (Math.abs(deg - c.heading) > 0.4 || Math.abs(deg - c.heading) > 300) {
      const tx = this._compassW / 2 - (deg + 180) * this._ppd;
      this.compassTape.style.transform = `translateX(${tx}px)`;
      this.compassHeading.textContent = `${String(Math.round(deg)).padStart(3, '0')}°`;
      c.heading = deg;
    }

    // --- damage-vignette decay (also carries a low-health baseline) ---
    this._vig = Math.max(0, this._vig - dt * 2.4);
    const lowHpBase = hpPct < 35 ? (1 - hpPct / 35) * 0.35 : 0;
    this.vignette.style.opacity = `${Math.min(0.9, Math.max(this._vig, lowHpBase))}`;

    // --- directional damage arcs ---
    for (const d of this._dmg) {
      if (d.t > 0) {
        d.t -= dt;
        d.el.style.opacity = `${Math.max(0, Math.min(1, d.t / 0.8)) * 0.9}`;
      } else if (d.el.style.opacity !== '0') {
        d.el.style.opacity = '0';
      }
    }

    // --- hit marker fade ---
    if (this._hitT > 0) {
      this._hitT -= dt;
      if (this._hitT <= 0) this.hitMarker.style.opacity = '0';
    }
  }
}
