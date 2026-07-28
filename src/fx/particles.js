// Particle & FX system for "Kwanza — Angola 1975".
// Rich, pooled, canvas-textured effects: rolling muzzle/barrel smoke, warm muzzle
// flash, dust plumes with surface-tinted debris, sparks, blood mist + ground decals,
// bullet tracers, ejected shell casings, and lingering golden-hour haze.
//
// Design notes:
//  - Everything is pooled (no per-shot allocation churn) and self-contained: all
//    textures are procedurally generated on <canvas>, no network assets.
//  - Sprites use depthWrite:false + large soft-edged textures to approximate a
//    "soft particle" look without a custom depth-sampling shader.
//  - Additive blending is used only for hot/light-emitting FX (flash, sparks,
//    tracers); smoke/dust/blood/decals use normal alpha blending.
//
// PUBLIC INTERFACE (preserved): spawnMuzzleSmoke(pos), spawnImpact(pos,normal),
// spawnBlood(pos), init(), update(dt). Added (called only if present):
// spawnTracer(from,to), spawnCasing(pos,dir), spawnDust(pos,normal), spawnHaze(pos).
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural texture helpers (all cached once at init)
// ---------------------------------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  return c;
}

function toTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  t.needsUpdate = true;
  return t;
}

// Radial alpha mask applied to whatever is already drawn (soft, faded edges).
function radialMask(g, size, hardness = 0.0) {
  g.globalCompositeOperation = 'destination-in';
  const r = size * 0.5;
  const grad = g.createRadialGradient(r, r, r * hardness, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';
}

// Turbulent puff: base tint + a scatter of soft blobs, then radial-masked.
function makePuffTexture(size, base, blobLo, blobHi, blobCount, blobAlpha) {
  const c = canvas(size); const g = c.getContext('2d'); const r = size * 0.5;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, base); grad.addColorStop(1, base.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  for (let i = 0; i < blobCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = Math.pow(Math.random(), 0.6) * r * 0.72;
    const x = r + Math.cos(a) * rad, y = r + Math.sin(a) * rad;
    const br = r * (0.12 + Math.random() * 0.32);
    const lit = Math.random() < 0.5 ? blobLo : blobHi;
    const bg = g.createRadialGradient(x, y, 0, x, y, br);
    bg.addColorStop(0, lit.replace('%A', (blobAlpha * (0.4 + Math.random() * 0.6)).toFixed(3)));
    bg.addColorStop(1, lit.replace('%A', '0'));
    g.fillStyle = bg; g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
  }
  radialMask(g, size, 0.05);
  return toTex(c);
}

function makeSmokeTexture() {
  // Cool grey-brown battlefield smoke.
  return makePuffTexture(128, 'rgba(150,146,140,0.95)',
    'rgba(90,86,80,%A)', 'rgba(205,200,190,%A)', 46, 0.55);
}

function makeDustTexture() {
  // Warm savanna dust / laterite ochre.
  return makePuffTexture(128, 'rgba(198,168,116,0.9)',
    'rgba(150,120,74,%A)', 'rgba(226,204,160,%A)', 42, 0.6);
}

function makeHazeTexture() {
  // Very soft golden haze, almost flat.
  const c = canvas(128); const g = c.getContext('2d'); const r = 64;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(214,196,160,0.5)');
  grad.addColorStop(1, 'rgba(214,196,160,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return toTex(c);
}

function makeSparkTexture() {
  // Hot ember core for additive sparks.
  const c = canvas(64); const g = c.getContext('2d'); const r = 32;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,248,220,1)');
  grad.addColorStop(0.25, 'rgba(255,214,130,0.95)');
  grad.addColorStop(0.6, 'rgba(255,140,50,0.5)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return toTex(c);
}

function makeFlashTexture() {
  // Muzzle flash: bright white-hot star with a hard incandescent core and a
  // ragged radial burst so a 7.62 shot reads with real punch even against sky.
  const size = 256; const c = canvas(size); const g = c.getContext('2d'); const r = size * 0.5;
  g.globalCompositeOperation = 'lighter';
  // 1) broad warm halo
  const halo = g.createRadialGradient(r, r, 0, r, r, r);
  halo.addColorStop(0, 'rgba(255,244,210,0.9)');
  halo.addColorStop(0.35, 'rgba(255,196,110,0.5)');
  halo.addColorStop(0.7, 'rgba(255,140,50,0.18)');
  halo.addColorStop(1, 'rgba(255,110,30,0)');
  g.fillStyle = halo; g.fillRect(0, 0, size, size);
  // 2) long ragged spikes (star burst) — varied length/width, a few long ones
  g.strokeStyle = 'rgba(255,238,190,0.9)'; g.lineCap = 'round';
  const spikes = 11;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const long = Math.random() < 0.35;
    const len = r * (long ? 0.85 + Math.random() * 0.13 : 0.4 + Math.random() * 0.35);
    g.lineWidth = 1.5 + Math.random() * (long ? 5 : 3);
    const grd = g.createLinearGradient(r, r, r + Math.cos(a) * len, r + Math.sin(a) * len);
    grd.addColorStop(0, 'rgba(255,246,214,0.95)');
    grd.addColorStop(0.5, 'rgba(255,210,130,0.55)');
    grd.addColorStop(1, 'rgba(255,150,60,0)');
    g.strokeStyle = grd;
    g.beginPath(); g.moveTo(r, r);
    g.lineTo(r + Math.cos(a) * len, r + Math.sin(a) * len); g.stroke();
  }
  // 3) dense white-hot core (small, saturated) — the actual muzzle bloom
  const core = g.createRadialGradient(r, r, 0, r, r, r * 0.32);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.4, 'rgba(255,250,232,0.95)');
  core.addColorStop(0.75, 'rgba(255,214,140,0.6)');
  core.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = core; g.beginPath(); g.arc(r, r, r * 0.32, 0, Math.PI * 2); g.fill();
  return toTex(c);
}

function makeBloodTexture() {
  // Dark arterial red mist with scattered droplets.
  const c = canvas(96); const g = c.getContext('2d'); const r = 48;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(150,18,12,0.95)');
  grad.addColorStop(0.6, 'rgba(105,10,8,0.6)');
  grad.addColorStop(1, 'rgba(70,6,6,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 96, 96);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, rad = Math.random() * r * 0.8;
    const x = r + Math.cos(a) * rad, y = r + Math.sin(a) * rad;
    const br = 1.5 + Math.random() * 4;
    g.fillStyle = `rgba(${120 + Math.random() * 40 | 0},14,10,${0.5 + Math.random() * 0.4})`;
    g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
  }
  radialMask(g, 96, 0.0);
  return toTex(c);
}

function makeStreakTexture() {
  // Tracer streak: hot core tapering along X, soft falloff along Y.
  const w = 128, h = 32; const c = canvas(2); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, w, 0);
  lin.addColorStop(0, 'rgba(255,220,140,0)');
  lin.addColorStop(0.55, 'rgba(255,232,170,0.55)');
  lin.addColorStop(0.9, 'rgba(255,250,225,1)');
  lin.addColorStop(1, 'rgba(255,255,245,1)');
  g.fillStyle = lin; g.fillRect(0, 0, w, h);
  // vertical soft mask
  g.globalCompositeOperation = 'destination-in';
  const vg = g.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(255,255,255,0)');
  vg.addColorStop(0.5, 'rgba(255,255,255,1)');
  vg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  return toTex(c);
}

function makeDecalTexture(tint) {
  // Irregular soft splat used for blood pools / dust scorch on the ground.
  const c = canvas(128); const g = c.getContext('2d'); const r = 64;
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = Math.pow(Math.random(), 0.7) * r * 0.7;
    const x = r + Math.cos(a) * rad, y = r + Math.sin(a) * rad;
    const br = r * (0.12 + Math.random() * 0.3);
    const bg = g.createRadialGradient(x, y, 0, x, y, br);
    bg.addColorStop(0, `rgba(${tint},${0.35 + Math.random() * 0.4})`);
    bg.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = bg; g.beginPath(); g.arc(x, y, br, 0, Math.PI * 2); g.fill();
  }
  radialMask(g, 128, 0.0);
  return toTex(c);
}

// ---------------------------------------------------------------------------
// Generic pooled sprite emitter
// ---------------------------------------------------------------------------

const _c0 = new THREE.Color(), _c1 = new THREE.Color();

class SpritePool {
  constructor(scene, tex, size, { additive = false, renderOrder = 0, toneMapped = true } = {}) {
    this.items = [];
    const base = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, toneMapped,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    for (let i = 0; i < size; i++) {
      const s = new THREE.Sprite(base.clone());
      s.visible = false; s.renderOrder = renderOrder;
      s.userData.d = null; // dynamics
      scene.add(s); this.items.push(s);
    }
  }

  _free() {
    for (const s of this.items) if (!s.visible) return s;
    // steal the oldest (highest age fraction) if fully saturated
    let best = this.items[0], bf = -1;
    for (const s of this.items) {
      const d = s.userData.d; const f = d ? d.age / d.life : 1;
      if (f > bf) { bf = f; best = s; }
    }
    return best;
  }

  spawn(pos, o) {
    const s = this._free();
    s.visible = true;
    s.position.copy(pos);
    s.material.rotation = o.rot ?? (Math.random() * Math.PI * 2);
    s.material.opacity = 0;
    const d = s.userData.d || (s.userData.d = {});
    d.age = 0;
    d.life = o.life;
    d.vel = (d.vel || new THREE.Vector3()).copy(o.vel || _ZERO);
    d.drag = o.drag ?? 1.6;
    d.gravity = o.gravity ?? 0;
    d.rotVel = o.rotVel ?? 0;
    d.s0 = o.scale ?? 1;
    d.s1 = o.scaleEnd ?? (o.scale ?? 1) + (o.grow ?? 0);
    d.op = o.opacity ?? 1;
    d.fadeIn = o.fadeIn ?? 0.12;
    d.col0 = o.color ?? null;
    d.col1 = o.colorEnd ?? o.color ?? null;
    if (o.color) s.material.color.set(o.color);
    s.scale.setScalar(d.s0);
    return s;
  }

  update(dt) {
    for (const s of this.items) {
      if (!s.visible) continue;
      const d = s.userData.d;
      d.age += dt;
      if (d.age >= d.life) { s.visible = false; continue; }
      const t = d.age / d.life;
      // integrate motion
      d.vel.y -= d.gravity * dt;
      s.position.addScaledVector(d.vel, dt);
      d.vel.multiplyScalar(1 - Math.min(1, d.drag * dt));
      s.material.rotation += d.rotVel * dt;
      // scale (ease-out)
      const es = 1 - (1 - t) * (1 - t);
      s.scale.setScalar(d.s0 + (d.s1 - d.s0) * es);
      // opacity: quick fade-in then smooth fade-out
      let a;
      if (t < d.fadeIn) a = t / d.fadeIn;
      else { const k = (t - d.fadeIn) / (1 - d.fadeIn); a = 1 - k * k; }
      s.material.opacity = d.op * a;
      // color-over-life
      if (d.col0 && d.col1) {
        _c0.set(d.col0); _c1.set(d.col1);
        s.material.color.copy(_c0).lerp(_c1, t);
      }
    }
  }
}

const _ZERO = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Tracer pool — camera-facing stretched quads sliding along the shot line
// ---------------------------------------------------------------------------

class TracerPool {
  constructor(scene, tex, size) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false; m.frustumCulled = false; m.renderOrder = 5;
      m.userData.d = null;
      scene.add(m); this.items.push(m);
    }
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3();
    this._z = new THREE.Vector3(); this._m = new THREE.Matrix4();
  }
  _free() { for (const m of this.items) if (!m.visible) return m; return this.items[0]; }
  spawn(from, to) {
    const m = this._free();
    const d = m.userData.d || (m.userData.d = { pos: new THREE.Vector3(), dir: new THREE.Vector3() });
    d.pos.copy(from);
    d.dir.copy(to).sub(from);
    d.dist = d.dir.length();
    if (d.dist < 0.001) return;
    d.dir.multiplyScalar(1 / d.dist);
    d.speed = 260;            // fast enough to read as a streak
    d.travelled = 0;
    d.len = Math.min(7, d.dist * 0.9);
    d.width = 0.06;
    d.age = 0; d.life = 0.12;
    m.visible = true;
    m.material.opacity = 1;
  }
  update(dt, camPos) {
    for (const m of this.items) {
      if (!m.visible) continue;
      const d = m.userData.d;
      d.age += dt;
      d.travelled += d.speed * dt;
      const headDist = Math.min(d.travelled, d.dist);
      if (d.age >= d.life || headDist >= d.dist - 0.01) { m.visible = false; continue; }
      // segment [tail, head] along the shot line
      const tail = Math.max(0, headDist - d.len);
      const mid = (headDist + tail) * 0.5;
      const half = (headDist - tail);
      this._x.copy(d.dir);
      m.position.copy(d.pos).addScaledVector(d.dir, mid);
      // face the camera: normal = component of (cam - pos) perpendicular to dir
      this._z.copy(camPos).sub(m.position);
      this._z.addScaledVector(this._x, -this._z.dot(this._x)).normalize();
      this._y.copy(this._z).cross(this._x).normalize();
      this._m.makeBasis(this._x, this._y, this._z);
      m.quaternion.setFromRotationMatrix(this._m);
      m.scale.set(half, d.width, 1);
      m.material.opacity = 1 - d.age / d.life;
    }
  }
}

// ---------------------------------------------------------------------------
// Shell casing pool — small lit brass meshes with gravity, spin and bounce
// ---------------------------------------------------------------------------

class CasingPool {
  constructor(scene, ctx, size) {
    this.ctx = ctx; this.items = [];
    const geo = new THREE.CylinderGeometry(0.006, 0.007, 0.032, 6);
    geo.rotateZ(Math.PI * 0.5); // lie along local X
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9a24b, metalness: 0.9, roughness: 0.35, emissive: 0x160b00,
    });
    for (let i = 0; i < size; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.castShadow = false;
      m.userData.d = { vel: new THREE.Vector3(), spin: new THREE.Vector3() };
      scene.add(m); this.items.push(m);
    }
    this._up = new THREE.Vector3();
  }
  _free() {
    for (const m of this.items) if (!m.visible) return m;
    let best = this.items[0], ba = -1;
    for (const m of this.items) if (m.userData.d.age > ba) { ba = m.userData.d.age; best = m; }
    return best;
  }
  spawn(pos, dir) {
    const m = this._free(); const d = m.userData.d;
    m.visible = true; m.position.copy(pos);
    m.material.opacity = 1; m.material.transparent = false;
    // eject sideways/up with spread
    d.vel.copy(dir).multiplyScalar(1.6 + Math.random() * 1.2);
    d.vel.y += 1.4 + Math.random() * 0.8;
    d.vel.x += (Math.random() - 0.5) * 0.6;
    d.vel.z += (Math.random() - 0.5) * 0.6;
    d.spin.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
    d.age = 0; d.life = 2.4; d.rest = false;
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  }
  update(dt) {
    const env = this.ctx.environment;
    for (const m of this.items) {
      if (!m.visible) continue;
      const d = m.userData.d;
      d.age += dt;
      if (d.age >= d.life) { m.visible = false; continue; }
      if (!d.rest) {
        d.vel.y -= 12 * dt;
        m.position.addScaledVector(d.vel, dt);
        m.rotation.x += d.spin.x * dt;
        m.rotation.y += d.spin.y * dt;
        m.rotation.z += d.spin.z * dt;
        const gy = (env && env.getHeight) ? env.getHeight(m.position.x, m.position.z) : 0;
        if (m.position.y <= gy + 0.008) {
          m.position.y = gy + 0.008;
          if (Math.abs(d.vel.y) < 0.6) { d.rest = true; d.vel.set(0, 0, 0); }
          else { d.vel.y = -d.vel.y * 0.32; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.5); }
        }
      }
      // fade out in the final 0.6s
      const fadeStart = d.life - 0.6;
      if (d.age > fadeStart) {
        if (!m.material.transparent) { m.material = m.material.clone(); m.material.transparent = true; }
        m.material.opacity = 1 - (d.age - fadeStart) / 0.6;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ground decal pool — flat oriented quads (blood pools, dust scorch)
// ---------------------------------------------------------------------------

class DecalPool {
  constructor(scene, size) {
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI * 0.5); // lie flat, facing +Y
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, polygonOffset: true,
        polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.renderOrder = 1; m.userData.d = null;
      scene.add(m); this.items.push(m);
    }
  }
  _free() {
    for (const m of this.items) if (!m.visible) return m;
    let best = this.items[0], bf = -1;
    for (const m of this.items) { const d = m.userData.d; const f = d ? d.age / d.life : 1; if (f > bf) { bf = f; best = m; } }
    return best;
  }
  spawn(pos, tex, { size = 0.5, life = 8, color = 0xffffff, opacity = 0.85 } = {}) {
    const m = this._free();
    m.material.map = tex; m.material.color.set(color);
    m.visible = true;
    m.position.set(pos.x, pos.y + 0.012, pos.z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.setScalar(size);
    const d = m.userData.d || (m.userData.d = {});
    d.age = 0; d.life = life; d.op = opacity;
    m.material.opacity = opacity;
  }
  update(dt) {
    for (const m of this.items) {
      if (!m.visible) continue;
      const d = m.userData.d;
      d.age += dt;
      if (d.age >= d.life) { m.visible = false; continue; }
      const t = d.age / d.life;
      // hold, then fade over the last 35%
      m.material.opacity = d.op * (t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35);
    }
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export class ParticleSystem {
  constructor(ctx) { this.ctx = ctx; }

  init() {
    const scene = this.ctx.scene;

    // textures
    this.smokeTex = makeSmokeTexture();
    this.dustTex = makeDustTexture();
    this.hazeTex = makeHazeTexture();
    this.sparkTex = makeSparkTexture();
    this.flashTex = makeFlashTexture();
    this.bloodTex = makeBloodTexture();
    this.streakTex = makeStreakTexture();
    this.bloodDecalTex = makeDecalTexture('90,10,8');
    this.dustDecalTex = makeDecalTexture('120,98,60');

    // sprite pools
    this.smoke = new SpritePool(scene, this.smokeTex, 56);
    this.dust = new SpritePool(scene, this.dustTex, 56);
    this.haze = new SpritePool(scene, this.hazeTex, 16, { renderOrder: -1 });
    this.debris = new SpritePool(scene, this.dustTex, 48);
    this.sparks = new SpritePool(scene, this.sparkTex, 90, { additive: true, renderOrder: 6, toneMapped: false });
    this.flash = new SpritePool(scene, this.flashTex, 16, { additive: true, renderOrder: 7, toneMapped: false });
    this.heat = new SpritePool(scene, this.hazeTex, 12, { additive: true, renderOrder: 4, toneMapped: false });
    this.blood = new SpritePool(scene, this.bloodTex, 56);

    // specialised pools
    this.tracers = new TracerPool(scene, this.streakTex, 24);
    this.casings = new CasingPool(scene, this.ctx, 28);
    this.decals = new DecalPool(scene, 32);

    // Muzzle flash light — one warm PointLight pulsed on each shot so the
    // weapon and nearby ground get a real kick of light at the moment of firing.
    this._muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2.0);
    this._muzzleLight.castShadow = false;
    scene.add(this._muzzleLight);
    this._muzzleLightPeak = 0;   // intensity to decay from
    this._muzzleLightAge = 1e3;  // seconds since last flash (large = idle)

    this._tmp = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  // --- Muzzle: bright flash + light pop + warm smoke + heat-haze + embers -----
  spawnMuzzleSmoke(pos) {
    // Big radial-star flash: a 1-2 frame pop with a random roll so repeats don't
    // look stamped. Untonemapped + additive so it reads even against bright sky.
    this.flash.spawn(pos, {
      life: 0.05, scale: 0.55, scaleEnd: 0.95, opacity: 1, fadeIn: 0.0, drag: 4,
      rot: Math.random() * Math.PI * 2,
    });
    // Tight ultra-bright incandescent core stacked on top of the star.
    this.flash.spawn(pos, {
      life: 0.045, scale: 0.26, scaleEnd: 0.4, opacity: 1, fadeIn: 0.0, drag: 4,
      rot: Math.random() * Math.PI * 2,
    });

    // Synced muzzle light — warm kick on weapon + nearby ground, decays in update.
    if (this._muzzleLight) {
      this._muzzleLight.position.copy(pos);
      this._muzzleLightPeak = 14 + Math.random() * 4;
      this._muzzleLight.intensity = this._muzzleLightPeak;
      this._muzzleLightAge = 0;
    }

    // Warm smoke puff — brief and fast-dissipating (hot gas, not lingering haze).
    for (let i = 0; i < 2; i++) {
      this.smoke.spawn(pos, {
        life: 0.45 + Math.random() * 0.25,
        scale: 0.12, grow: 0.7,
        opacity: 0.42,
        drag: 2.6,
        rotVel: (Math.random() - 0.5) * 3,
        color: '#d8c4a0', colorEnd: '#8a8074',
        vel: this._tmp.set((Math.random() - 0.5) * 0.7, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.7),
      });
    }

    // Barrel heat-haze — a faint warm shimmer rising off the hot barrel.
    this.heat.spawn(pos, {
      life: 0.32, scale: 0.18, grow: 0.5, opacity: 0.22, fadeIn: 0.15, drag: 2,
      color: '#ffcaa0',
      vel: this._tmp.set((Math.random() - 0.5) * 0.2, 0.9, (Math.random() - 0.5) * 0.2),
    });

    // Bright warm embers spat forward from the barrel.
    for (let i = 0; i < 4; i++) {
      this.sparks.spawn(pos, {
        life: 0.16 + Math.random() * 0.1, scale: 0.05 + Math.random() * 0.03,
        opacity: 1, fadeIn: 0, drag: 2, gravity: 3,
        vel: this._tmp.set((Math.random() - 0.5) * 2.4, Math.random() * 1.3, (Math.random() - 0.5) * 2.4),
      });
    }

    // Near-ground dust displacement — if firing low, the muzzle blast kicks up
    // a little laterite from the ground below.
    const env = this.ctx.environment;
    const gy = (env && env.getHeight) ? env.getHeight(pos.x, pos.z) : 0;
    if (pos.y - gy < 1.4) {
      const dpos = this._tmp.set(pos.x, gy + 0.02, pos.z).clone();
      for (let i = 0; i < 2; i++) {
        this.dust.spawn(dpos, {
          life: 0.5 + Math.random() * 0.3, scale: 0.1, grow: 0.6, opacity: 0.4,
          drag: 2.4, rotVel: (Math.random() - 0.5) * 2,
          color: '#c8a874', colorEnd: '#9c7f4c',
          vel: this._tmp.set((Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 1.2),
        });
      }
    }
  }

  // --- Bullet/shrapnel impact: sparks + dust plume + debris + scorch decal ---
  spawnImpact(pos, normal) {
    const n = normal || _UP;
    // sharp sparks along reflection cone
    for (let i = 0; i < 7; i++) {
      const v = this._reflectSpread(n, 3.5, 0.6);
      this.sparks.spawn(pos, {
        life: 0.18 + Math.random() * 0.12, scale: 0.05 + Math.random() * 0.04,
        opacity: 1, fadeIn: 0, drag: 2.2, gravity: 5, vel: v.clone(),
      });
    }
    // dust plume kicked off the surface
    for (let i = 0; i < 3; i++) {
      this.dust.spawn(pos, {
        life: 0.6 + Math.random() * 0.35, scale: 0.12, grow: 0.55,
        opacity: 0.7, drag: 2, rotVel: (Math.random() - 0.5) * 2,
        color: '#c8a874', colorEnd: '#9c7f4c',
        vel: this._alongNormal(n, 0.8, 0.6),
      });
    }
    // heavier surface-tinted debris chunks (dark, arc and fall)
    for (let i = 0; i < 4; i++) {
      this.debris.spawn(pos, {
        life: 0.5 + Math.random() * 0.3, scale: 0.03 + Math.random() * 0.03,
        opacity: 0.9, drag: 1.2, gravity: 8, fadeIn: 0,
        color: '#6b5836', colorEnd: '#4a3c24',
        vel: this._reflectSpread(n, 2.2, 0.9),
      });
    }
    // scorch/dust decal only for roughly horizontal ground hits
    if (n.y > 0.6) {
      this.decals.spawn(pos, this.dustDecalTex, {
        size: 0.35 + Math.random() * 0.2, life: 6, opacity: 0.55, color: 0x9c7f4c,
      });
    }
  }

  // --- Blood mist + spatter + a settling ground pool -------------------------
  spawnBlood(pos) {
    for (let i = 0; i < 10; i++) {
      const v = this._tmp.set(
        (Math.random() - 0.5) * 2.6, Math.random() * 1.6 - 0.2, (Math.random() - 0.5) * 2.6);
      this.blood.spawn(pos, {
        life: 0.35 + Math.random() * 0.25, scale: 0.06 + Math.random() * 0.05,
        opacity: 0.9, fadeIn: 0.05, drag: 1.8, gravity: 6,
        color: '#8e120c', colorEnd: '#5c0a08', vel: v.clone(),
      });
    }
    // fine lingering mist
    for (let i = 0; i < 3; i++) {
      this.blood.spawn(pos, {
        life: 0.8, scale: 0.1, grow: 0.25, opacity: 0.35, drag: 1.2,
        color: '#7a1410', colorEnd: '#500a08',
        vel: this._tmp.set((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6).clone(),
      });
    }
    // ground pool below the hit
    const env = this.ctx.environment;
    const gy = (env && env.getHeight) ? env.getHeight(pos.x, pos.z) : 0;
    this.decals.spawn(this._tmp.set(pos.x, gy, pos.z), this.bloodDecalTex, {
      size: 0.4 + Math.random() * 0.25, life: 12, opacity: 0.8, color: 0x6e0c08,
    });
  }

  // --- Tracer from muzzle to hit point (called only if present) --------------
  spawnTracer(from, to) {
    if (from && to) this.tracers.spawn(from, to);
  }

  // --- Ejected shell casing (called only if present) -------------------------
  // dir optional; if omitted, ejects to camera-right.
  spawnCasing(pos, dir) {
    let d = dir;
    if (!d) {
      const cam = this.ctx.camera;
      this._right.set(1, 0, 0);
      if (cam) this._right.applyQuaternion(cam.quaternion);
      d = this._right;
    }
    this.casings.spawn(pos, d);
  }

  // --- Standalone dust puff (called only if present) -------------------------
  spawnDust(pos, normal) {
    const n = normal || _UP;
    for (let i = 0; i < 3; i++) {
      this.dust.spawn(pos, {
        life: 0.7 + Math.random() * 0.4, scale: 0.14, grow: 0.7, opacity: 0.6,
        drag: 2, rotVel: (Math.random() - 0.5) * 2,
        color: '#c8a874', colorEnd: '#9c7f4c',
        vel: this._alongNormal(n, 0.7, 0.5),
      });
    }
  }

  // --- Lingering golden haze (called only if present) ------------------------
  spawnHaze(pos) {
    this.haze.spawn(pos, {
      life: 3.5 + Math.random() * 2, scale: 1.4, grow: 1.6, opacity: 0.28,
      fadeIn: 0.3, drag: 0.6,
      vel: this._tmp.set((Math.random() - 0.5) * 0.3, 0.15, (Math.random() - 0.5) * 0.3).clone(),
    });
  }

  update(dt) {
    this.smoke.update(dt);
    this.dust.update(dt);
    this.haze.update(dt);
    this.debris.update(dt);
    this.sparks.update(dt);
    this.flash.update(dt);
    this.heat.update(dt);
    this.blood.update(dt);
    this.decals.update(dt);
    this.casings.update(dt);
    const cam = this.ctx.camera;
    this.tracers.update(dt, cam ? cam.position : _ZERO);
    // Muzzle light: fast exponential-ish decay so it flashes and is gone (~0.06s).
    if (this._muzzleLight && this._muzzleLight.intensity > 0.01) {
      this._muzzleLightAge += dt;
      const k = Math.max(0, 1 - this._muzzleLightAge / 0.07);
      this._muzzleLight.intensity = this._muzzleLightPeak * k * k;
    } else if (this._muzzleLight) {
      this._muzzleLight.intensity = 0;
    }
  }

  // --- helpers ---------------------------------------------------------------
  // Velocity in a cone around the surface normal (reflection-like spray).
  _reflectSpread(n, speed, spread) {
    const v = new THREE.Vector3(
      n.x + (Math.random() - 0.5) * 2 * spread,
      n.y + (Math.random() - 0.5) * 2 * spread + 0.3,
      n.z + (Math.random() - 0.5) * 2 * spread);
    return v.normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.5));
  }
  // Gentle drift biased along the normal (dust rising off a surface).
  _alongNormal(n, speed, jitter) {
    return this._tmp.set(
      n.x * speed + (Math.random() - 0.5) * jitter,
      n.y * speed * 0.5 + 0.4 + Math.random() * 0.3,
      n.z * speed + (Math.random() - 0.5) * jitter).clone();
  }
}

const _UP = new THREE.Vector3(0, 1, 0);
