// HUD: health, ammo, crosshair, hit markers, damage vignette, objective, compass.
export class HUD {
  constructor(ctx) { this.ctx = ctx; }

  init() {
    this.magEl = document.getElementById('ammo-mag');
    this.reserveEl = document.getElementById('ammo-reserve');
    this.weaponEl = document.getElementById('weapon-name');
    this.healthFill = document.getElementById('health-fill');
    this.hitMarker = document.getElementById('hit-marker');
    this.vignette = document.getElementById('damage-vignette');
    this.objectiveText = document.getElementById('objective-text');
    this.compass = document.getElementById('compass');
    this.crosshair = document.getElementById('crosshair');
    this._hitT = 0;

    this.ctx.on('player-hit', (e) => {
      const v = Math.min(0.9, 0.3 + e.detail.amount / 40);
      this.vignette.style.boxShadow = `inset 0 0 200px 40px rgba(140,20,10,${v})`;
      setTimeout(() => { this.vignette.style.boxShadow = 'inset 0 0 200px 40px rgba(140,20,10,0)'; }, 120);
    });
    this.ctx.on('weapon-changed', (e) => { this.weaponEl.textContent = e.detail.name; });
  }

  showHitMarker(killed) {
    this.hitMarker.style.opacity = '1';
    this.hitMarker.querySelectorAll('.hm').forEach((el) => el.style.background = killed ? '#ff5544' : '#fff');
    this._hitT = 0.18;
  }

  setObjective(text) { this.objectiveText.textContent = text; }

  update(dt) {
    const w = this.ctx.weapons;
    this.magEl.textContent = w.reloading > 0 ? '--' : w.mag;
    this.reserveEl.textContent = w.reserve;

    const p = this.ctx.player;
    const pct = Math.max(0, p.health / p.maxHealth) * 100;
    this.healthFill.style.width = `${pct}%`;

    // crosshair spread with movement/ads
    const spread = 3 + Math.hypot(p.velocity.x, p.velocity.z) * 1.1 - w.ads * 5;
    this.crosshair.style.transform = `translate(-50%,-50%) scale(${1 + Math.max(0, spread) * 0.04})`;

    // compass from yaw
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    let deg = (-p.yaw * 180 / Math.PI) % 360; if (deg < 0) deg += 360;
    this.compass.textContent = dirs[Math.round(deg / 45) % 8];

    if (this._hitT > 0) {
      this._hitT -= dt;
      if (this._hitT <= 0) this.hitMarker.style.opacity = '0';
    }
  }
}
