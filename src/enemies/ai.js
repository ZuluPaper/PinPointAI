// Enemy AI: segmented soldier models, procedural walk/aim animation, and a
// patrol -> alert -> combat -> cover state machine with line-of-sight
// detection, strafing, suppressive/burst fire, reload pauses and a death
// topple. Built for ~8-16 concurrent enemies: geometry/materials/textures are
// cached once at module scope and shared across every soldier.
import * as THREE from 'three';

const STATE = { PATROL: 'patrol', ALERT: 'alert', COMBAT: 'combat', COVER: 'cover', DEAD: 'dead' };

// ---------------------------------------------------------------------------
// Shared, one-time asset construction (canvas textures, geometry, materials).
// Everything here is created lazily on first enemy and reused thereafter, so
// the per-enemy cost is just Group + Mesh nodes (no texture/geo allocation).
// ---------------------------------------------------------------------------
let ASSETS = null;

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Procedural three-tone bush camo (olive / khaki / dark) with a fabric weave,
// plus a matching subtle normal map so fatigues catch the golden-hour light.
function makeFatiguesTextures() {
  const S = 128;
  const albedoC = makeCanvas(S);
  const a = albedoC.getContext('2d');
  a.fillStyle = '#5b5533'; a.fillRect(0, 0, S, S);
  const blobs = [
    ['#6d6640', 26], ['#463f24', 20], ['#7a7048', 16], ['#3a3520', 22],
  ];
  for (const [col, count] of blobs) {
    a.fillStyle = col;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 16;
      a.beginPath();
      // irregular lobed splotch
      for (let k = 0; k <= 10; k++) {
        const ang = (k / 10) * Math.PI * 2;
        const rr = r * (0.7 + Math.random() * 0.5);
        const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
        k === 0 ? a.moveTo(px, py) : a.lineTo(px, py);
      }
      a.closePath(); a.fill();
    }
  }
  // fine weave / dirt speckle
  const img = a.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  a.putImageData(img, 0, 0);

  // normal map from a per-pixel weave/height field
  const normC = makeCanvas(S);
  const nctx = normC.getContext('2d');
  const nimg = nctx.createImageData(S, S);
  const h = (x, y) => {
    const xi = ((x % S) + S) % S, yi = ((y % S) + S) % S;
    // weave pattern + noise
    const weave = Math.sin(xi * 0.9) * Math.sin(yi * 0.9) * 0.5;
    return weave + (Math.sin(xi * 3.1 + yi * 1.7) * 0.15);
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y);
      const dy = h(x, y + 1) - h(x, y - 1);
      const nz = 1.0;
      const inv = 1 / Math.hypot(dx, dy, nz);
      const idx = (y * S + x) * 4;
      nimg.data[idx] = ((-dx * inv) * 0.5 + 0.5) * 255;
      nimg.data[idx + 1] = ((-dy * inv) * 0.5 + 0.5) * 255;
      nimg.data[idx + 2] = (nz * inv) * 0.5 * 255 + 127;
      nimg.data[idx + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  const albedo = new THREE.CanvasTexture(albedoC);
  const normal = new THREE.CanvasTexture(normC);
  for (const t of [albedo, normal]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  albedo.colorSpace = THREE.SRGBColorSpace;
  return { albedo, normal };
}

// Fresnel rim + a floor on the darkest tone, injected into a standard material.
// This is the core readability aid: under harsh golden-hour backlight the
// player-facing side of a soldier receives almost no direct light and would
// otherwise crush to pure black, vanishing into the shadowed laterite. The rim
// term lights the silhouette edge (a cool sky-bounce) so the outline reads
// against the blown-out sky, while the ambient floor guarantees the body never
// falls below a legible value against the dark ground. Both are view/normal
// driven in-shader, so they cost nothing extra per enemy (materials are shared)
// and never wash the model out in flat light.
function applyReadability(mat, opts = {}) {
  const rimColor = opts.rimColor || new THREE.Color(0x9fb8d6); // cool sky-bounce
  const rimPower = opts.rimPower != null ? opts.rimPower : 2.6;
  const rimStrength = opts.rimStrength != null ? opts.rimStrength : 0.55;
  const floor = opts.floor != null ? opts.floor : 0.16; // min value vs. crushed black
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimPower = { value: rimPower };
    shader.uniforms.uRimStrength = { value: rimStrength };
    shader.uniforms.uReadFloor = { value: floor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\nuniform float uReadFloor;')
      .replace('#include <dithering_fragment>', `
        {
          vec3 vdir = normalize(vViewPosition);
          float ndv = clamp(dot(normalize(normal), vdir), 0.0, 1.0);
          float rim = pow(1.0 - ndv, uRimPower);
          // lift the darkest pixels toward a legible floor, then add the rim edge
          gl_FragColor.rgb = max(gl_FragColor.rgb, diffuseColor.rgb * uReadFloor);
          gl_FragColor.rgb += uRimColor * rim * uRimStrength;
        }
        #include <dithering_fragment>`);
  };
  mat.needsUpdate = true;
  return mat;
}

function buildAssets() {
  if (ASSETS) return ASSETS;
  const fat = makeFatiguesTextures();

  // Uniform tones are nudged brighter and slightly desaturated (and cooled off
  // the reddish laterite) via emissive fills so the crushed-shadow side keeps a
  // readable value and hue instead of going to black under backlight.
  const mats = {
    fatigues: new THREE.MeshStandardMaterial({
      map: fat.albedo, normalMap: fat.normal, roughness: 0.9, metalness: 0.02,
      normalScale: new THREE.Vector2(0.6, 0.6),
      emissive: 0x3b3a24, emissiveIntensity: 0.55,
    }),
    skin: new THREE.MeshStandardMaterial({ color: 0x7a5540, roughness: 0.72, emissive: 0x2a1a12, emissiveIntensity: 0.5 }),
    webbing: new THREE.MeshStandardMaterial({ color: 0x33322a, roughness: 0.7, metalness: 0.05, emissive: 0x1a1a14, emissiveIntensity: 0.5 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x53533a, roughness: 0.6, metalness: 0.15, emissive: 0x26260f, emissiveIntensity: 0.5 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x252219, roughness: 0.55, metalness: 0.1, emissive: 0x14130e, emissiveIntensity: 0.55 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x2e3036, roughness: 0.45, metalness: 0.7, emissive: 0x101216, emissiveIntensity: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4523, roughness: 0.6, metalness: 0.05, emissive: 0x211407, emissiveIntensity: 0.5 }),
  };
  // Patch every soldier material once with the shared rim/floor readability aid.
  applyReadability(mats.fatigues, { rimStrength: 0.55, floor: 0.17 });
  applyReadability(mats.skin, { rimStrength: 0.45, floor: 0.18 });
  applyReadability(mats.webbing, { rimStrength: 0.6, floor: 0.15 });
  applyReadability(mats.helmet, { rimStrength: 0.6, floor: 0.16 });
  applyReadability(mats.boot, { rimStrength: 0.6, floor: 0.14 });
  applyReadability(mats.metal, { rimStrength: 0.7, rimPower: 2.2, floor: 0.13 });
  applyReadability(mats.wood, { rimStrength: 0.5, floor: 0.16 });

  const geos = {
    head: new THREE.SphereGeometry(0.135, 12, 12),
    helmet: new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    torso: new THREE.CapsuleGeometry(0.24, 0.5, 4, 8),
    hips: new THREE.CapsuleGeometry(0.2, 0.18, 3, 8),
    upperArm: new THREE.CapsuleGeometry(0.07, 0.32, 3, 6),
    foreArm: new THREE.CapsuleGeometry(0.06, 0.3, 3, 6),
    thigh: new THREE.CapsuleGeometry(0.1, 0.34, 3, 6),
    shin: new THREE.CapsuleGeometry(0.085, 0.34, 3, 6),
    boot: new THREE.BoxGeometry(0.13, 0.1, 0.28),
    webbing: new THREE.BoxGeometry(0.5, 0.34, 0.12),
    pouch: new THREE.BoxGeometry(0.12, 0.13, 0.08),
    rifleBody: new THREE.BoxGeometry(0.05, 0.09, 0.62),
    rifleBarrel: new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6),
    rifleMag: new THREE.BoxGeometry(0.045, 0.2, 0.08),
    rifleStock: new THREE.BoxGeometry(0.05, 0.1, 0.24),
  };

  // Soft radial contact-shadow decal: grounds each soldier and gives the
  // silhouette a dark anchor to pop against the pale backlit grass/sky.
  const shadowC = makeCanvas(64);
  const sc = shadowC.getContext('2d');
  const grad = sc.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sc.fillStyle = grad; sc.fillRect(0, 0, 64, 64);
  const shadowTex = new THREE.CanvasTexture(shadowC);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false,
    opacity: 0.85, blending: THREE.NormalBlending,
  });
  const shadowGeo = new THREE.PlaneGeometry(1, 1);

  ASSETS = { mats, geos, shadowMat, shadowGeo };
  return ASSETS;
}

// Reusable scratch objects (avoid per-frame allocation in the hot path).
const _tmpV = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _ray = new THREE.Ray();

class Enemy {
  constructor(ctx, position, waypoints) {
    this.ctx = ctx;
    this.health = 100;
    this.maxHealth = 100;
    this.state = STATE.PATROL;
    this.position = position.clone();      // feet on terrain
    this.velocity = new THREE.Vector3();
    this.speed = 2.4 + Math.random() * 0.5;

    // combat / weapon bookkeeping
    this.magSize = 24;
    this.ammo = this.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireTimer = 0.6 + Math.random() * 1.2;
    this.burstLeft = 0;
    this.preferredRange = 14 + Math.random() * 8;

    // perception (staggered so all enemies don't LOS-check the same frame)
    this.canSeePlayer = false;
    this.losTimer = Math.random() * 0.3;
    this.lastKnownPos = position.clone();
    this.alertLevel = 0; // 0..1, drives patrol->alert->combat hysteresis

    // movement / tactics
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 1 + Math.random() * 2;
    this.coverPoint = null;
    this.coverTimer = 0;
    this.peek = 1;

    // animation state
    this.animPhase = Math.random() * Math.PI * 2;
    this.aimBlend = 0;
    this.yaw = Math.random() * Math.PI * 2;
    this.moveAmount = 0;
    this.crouch = 0;

    // patrol route (loop of waypoints around the spawn)
    this.waypoints = waypoints || [position.clone()];
    this.wpIndex = 0;
    this.waitTimer = 0;

    // death
    this.deathTimer = 0;
    this.toppleAxis = new THREE.Vector3(Math.random() < 0.5 ? 1 : -1, 0, (Math.random() - 0.5) * 0.6).normalize();

    this._buildMesh();
  }

  _buildMesh() {
    const { mats, geos } = buildAssets();
    const root = new THREE.Group();
    root.position.copy(this.position);

    // Hip pivot: torso + head + arms hang off it so a crouch/topple is one xform.
    const hips = new THREE.Group();
    hips.position.y = 0.92;
    root.add(hips);

    const torso = new THREE.Mesh(geos.torso, mats.fatigues);
    torso.position.y = 0.42;
    hips.add(torso);

    const pelvis = new THREE.Mesh(geos.hips, mats.fatigues);
    pelvis.position.y = 0.02;
    hips.add(pelvis);

    // webbing / chest rig
    const rig = new THREE.Mesh(geos.webbing, mats.webbing);
    rig.position.set(0, 0.42, 0.18);
    hips.add(rig);
    for (const px of [-0.18, 0.18]) {
      const pouch = new THREE.Mesh(geos.pouch, mats.webbing);
      pouch.position.set(px, 0.3, 0.2);
      hips.add(pouch);
    }

    const head = new THREE.Mesh(geos.head, mats.skin);
    head.position.y = 0.86;
    hips.add(head);
    const helmet = new THREE.Mesh(geos.helmet, mats.helmet);
    helmet.position.y = 0.9;
    hips.add(helmet);

    // Arms: shoulder-pivoted groups with upper+fore segments; right arm carries
    // the rifle so aiming just rotates the shoulders forward.
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.3 * side, 0.66, 0);
      const upper = new THREE.Mesh(geos.upperArm, mats.fatigues);
      upper.position.y = -0.18;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.36;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(geos.foreArm, mats.skin);
      fore.position.y = -0.16;
      elbow.add(fore);
      hips.add(shoulder);
      return { shoulder, elbow };
    };
    const rArm = makeArm(1);
    const lArm = makeArm(-1);

    // Rifle prop, parented to the right forearm.
    const rifle = new THREE.Group();
    const body = new THREE.Mesh(geos.rifleBody, mats.metal);
    body.position.z = 0.1;
    const barrel = new THREE.Mesh(geos.rifleBarrel, mats.metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.5);
    const mag = new THREE.Mesh(geos.rifleMag, mats.metal);
    mag.position.set(0, -0.13, 0.02);
    mag.rotation.x = -0.2;
    const stock = new THREE.Mesh(geos.rifleStock, mats.wood);
    stock.position.set(0, -0.02, -0.28);
    rifle.add(body, barrel, mag, stock);
    rifle.position.set(0, -0.2, 0.08);
    rifle.rotation.x = Math.PI / 2; // point barrel forward when arm hangs
    rArm.elbow.add(rifle);
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, 0.72);
    body.add(muzzle);

    // Legs: hip-pivoted thigh + knee-pivoted shin + boot.
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(0.12 * side, 0.0, 0);
      const thigh = new THREE.Mesh(geos.thigh, mats.fatigues);
      thigh.position.y = -0.2;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = new THREE.Mesh(geos.shin, mats.fatigues);
      shin.position.y = -0.2;
      knee.add(shin);
      const boot = new THREE.Mesh(geos.boot, mats.boot);
      boot.position.set(0, -0.42, 0.06);
      knee.add(boot);
      root.add(hip);
      hip.position.y = 0.9; // hips live in root space, not the crouch pivot
      return { hip, knee };
    };
    const rLeg = makeLeg(1);
    const lLeg = makeLeg(-1);

    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    root.rotation.y = this.yaw;
    this.ctx.scene.add(root);

    // handles used by animation / hit resolution
    this.mesh = root;
    this.hipsPivot = hips;
    this.headMesh = head;      // headshot proxy (kept for raycastHit interface)
    this.torsoMesh = torso;    // body proxy
    this.helmetMesh = helmet;
    this.rArm = rArm; this.lArm = lArm;
    this.rLeg = rLeg; this.lLeg = lLeg;
    this.muzzle = muzzle;
  }

  // ---- hit resolution -----------------------------------------------------
  hit(damage, headshot) {
    if (this.state === STATE.DEAD) return { killed: false };
    this.health -= headshot ? damage * 2.4 : damage;
    // being shot instantly escalates and pins last-known player position
    this.alertLevel = 1;
    if (this.state === STATE.PATROL || this.state === STATE.ALERT) this.state = STATE.COMBAT;
    this.lastKnownPos.copy(this.ctx.player.position);
    _tmpV.set(this.position.x, this.position.y + (headshot ? 1.78 : 1.2), this.position.z);
    this.ctx.particles?.spawnBlood?.(_tmpV.clone());
    // heavy damage or low health -> break for cover
    if (this.health > 0 && (this.health < 38 || (!headshot && Math.random() < 0.3))) {
      this._seekCover();
    }
    if (this.health <= 0) { this.die(); return { killed: true }; }
    return { killed: false };
  }

  die() {
    this.state = STATE.DEAD;
    this.deathTimer = 0;
    this.velocity.set(0, 0, 0);
    this.ctx.audio?.play?.('enemyDown', this.position);
    this.ctx.emit('enemy-killed', {});
  }

  // ---- tactics ------------------------------------------------------------
  // Find a point tucked behind the nearest world collider, on the far side
  // from the player. Uses ctx.colliders AABBs (cheap, already maintained).
  _seekCover() {
    const cols = this.ctx.colliders;
    if (!cols || !cols.length) return;
    const p = this.ctx.player.position;
    let best = null, bestScore = Infinity;
    for (const c of cols) {
      if (!c.box) continue;
      c.box.getCenter(_tmpV);
      const distToMe = _tmpV.distanceTo(this.position);
      if (distToMe > 22) continue; // only nearby cover is useful
      // point on the opposite side of the box from the player
      _tmpV2.set(_tmpV.x - p.x, 0, _tmpV.z - p.z);
      if (_tmpV2.lengthSq() < 0.001) continue;
      _tmpV2.normalize();
      const size = _tmpV.distanceTo(c.box.max);
      const cand = new THREE.Vector3(
        _tmpV.x + _tmpV2.x * (size * 0.5 + 0.8), this.position.y,
        _tmpV.z + _tmpV2.z * (size * 0.5 + 0.8));
      const score = distToMe; // prefer closest reachable cover
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    if (best) {
      this.coverPoint = best;
      this.coverTimer = 2.5 + Math.random() * 2.5;
      this.state = STATE.COVER;
    }
  }

  // Clear line of sight from the soldier's eye to the player's chest, tested
  // against world collider AABBs. Throttled per-enemy for performance.
  _checkLOS(playerPos, dist) {
    _eye.set(this.position.x, this.position.y + 1.6, this.position.z);
    _tmpV.set(playerPos.x, playerPos.y + 1.4, playerPos.z).sub(_eye);
    const len = _tmpV.length();
    _tmpV.normalize();
    _ray.origin.copy(_eye);
    _ray.direction.copy(_tmpV);
    const cols = this.ctx.colliders;
    if (cols) {
      for (const c of cols) {
        if (!c.box) continue;
        if (_ray.intersectBox(c.box, _tmpV2)) {
          if (_eye.distanceTo(_tmpV2) < len - 0.5) return false; // occluded
        }
      }
    }
    return dist < 70;
  }

  // ---- procedural animation ----------------------------------------------
  _updateAnim(dt) {
    if (this.state === STATE.DEAD) { this._updateDeath(dt); return; }

    // aim pose blends in during combat/cover when we can see the target
    const wantAim = (this.state === STATE.COMBAT || this.state === STATE.COVER) && this.canSeePlayer ? 1 : 0;
    this.aimBlend += (wantAim - this.aimBlend) * Math.min(1, dt * 6);
    this.crouch += (((this.state === STATE.COVER) ? 1 : 0) - this.crouch) * Math.min(1, dt * 5);

    // stride frequency tracks how fast we're actually moving
    const stride = this.moveAmount;
    this.animPhase += dt * (5.5 + stride * 3.5) * (0.3 + stride);
    const s = Math.sin(this.animPhase);
    const s2 = Math.sin(this.animPhase * 2);
    const legAmp = 0.85 * stride;

    // legs: opposite-phase swing, knees bend on the back-swing
    this.rLeg.hip.rotation.x = s * legAmp;
    this.lLeg.hip.rotation.x = -s * legAmp;
    this.rLeg.knee.rotation.x = Math.max(0, -s) * legAmp * 1.1 + 0.05;
    this.lLeg.knee.rotation.x = Math.max(0, s) * legAmp * 1.1 + 0.05;

    // subtle vertical bob + crouch drop on the hip pivot
    this.hipsPivot.position.y = 0.92 - Math.abs(s2) * 0.03 * stride - this.crouch * 0.28;

    // arms: hang-and-swing when not aiming, raise to a braced rifle pose when aiming
    const aim = this.aimBlend;
    // rest pose swing (opposite the legs)
    const rRest = -s * 0.5 * stride;
    const lRest = s * 0.5 * stride;
    // aim pose: both shoulders forward, left arm braces further under the barrel
    const rAim = -1.35, lAim = -1.15;
    this.rArm.shoulder.rotation.x = rRest * (1 - aim) + rAim * aim;
    this.lArm.shoulder.rotation.x = lRest * (1 - aim) + lAim * aim;
    this.rArm.shoulder.rotation.z = -0.05 * (1 - aim) + 0.12 * aim;
    this.lArm.shoulder.rotation.z = 0.05 * (1 - aim) - 0.28 * aim;
    this.rArm.elbow.rotation.x = -0.1 - 0.35 * aim;
    this.lArm.elbow.rotation.x = -0.1 - 0.7 * aim;

    // smooth yaw toward the desired facing
    let dy = this.yaw - this.mesh.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.mesh.rotation.y += dy * Math.min(1, dt * 8);
  }

  // A brief, weighty topple rather than a full ragdoll sim: the body pitches
  // about a random ground axis, limbs go slack, and it settles as a corpse.
  _updateDeath(dt) {
    this.deathTimer += dt;
    const t = Math.min(1, this.deathTimer / 0.9);
    const e = 1 - Math.pow(1 - t, 3); // ease-out
    const fall = e * (Math.PI * 0.5);
    // rotate whole body about the topple axis
    this.mesh.rotation.z = this.toppleAxis.x * fall;
    this.mesh.rotation.x = this.toppleAxis.z * fall;
    this.mesh.position.y = this.position.y - e * 0.15;
    // limbs go limp
    this.rArm.shoulder.rotation.x += (0.6 - this.rArm.shoulder.rotation.x) * Math.min(1, dt * 4);
    this.lArm.shoulder.rotation.x += (-0.3 - this.lArm.shoulder.rotation.x) * Math.min(1, dt * 4);
    this.rLeg.hip.rotation.x += (0.2 - this.rLeg.hip.rotation.x) * Math.min(1, dt * 4);
    this.lLeg.hip.rotation.x += (-0.15 - this.lLeg.hip.rotation.x) * Math.min(1, dt * 4);
    this.hipsPivot.position.y += (0.7 - this.hipsPivot.position.y) * Math.min(1, dt * 4);
  }

  // ---- weapon fire --------------------------------------------------------
  _fire(playerPos, toPlayer, dist) {
    // one round leaves the barrel
    this.ammo--;
    const mpos = this.muzzle.getWorldPosition(_tmpV).clone();
    this.ctx.particles?.spawnMuzzleSmoke?.(mpos);
    this.ctx.audio?.play?.('enemyShot', this.position);
    // hit chance falls with range and while strafing; suppressive fire with no
    // LOS still makes noise but can't connect
    if (this.canSeePlayer) {
      const hitChance = Math.max(0.06, 0.55 - dist * 0.008) * (0.6 + 0.4 * this.peek);
      if (Math.random() < hitChance) {
        this.ctx.player.takeDamage?.(7 + Math.random() * 6, toPlayer.clone().negate());
      }
    }
    if (this.ammo <= 0) {
      this.reloading = true;
      this.reloadTimer = 2.2 + Math.random() * 0.8;
    }
  }

  // ---- main per-frame update ---------------------------------------------
  update(dt, playerPos) {
    if (this.state === STATE.DEAD) { this._updateAnim(dt); return; }

    _tmpV.copy(playerPos).sub(this.position);
    _tmpV.y = 0;
    const dist = _tmpV.length() || 0.0001;
    const toPlayer = _tmpV.clone().multiplyScalar(1 / dist);

    // throttled line-of-sight perception
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.22 + Math.random() * 0.1;
      this.canSeePlayer = this._checkLOS(playerPos, dist);
      if (this.canSeePlayer) this.lastKnownPos.copy(playerPos);
    }

    // alertness hysteresis: seeing the player raises it, losing sight decays it
    if (this.canSeePlayer && dist < 65) this.alertLevel = Math.min(1, this.alertLevel + dt * 1.5);
    else this.alertLevel = Math.max(0, this.alertLevel - dt * 0.25);

    // state transitions
    if (this.state === STATE.PATROL) {
      if (this.alertLevel > 0.15) this.state = STATE.ALERT;
    } else if (this.state === STATE.ALERT) {
      if (this.alertLevel > 0.6) this.state = STATE.COMBAT;
      else if (this.alertLevel <= 0.05) this.state = STATE.PATROL;
    }

    let desired = _tmpV2.set(0, 0, 0); // desired horizontal move this frame

    if (this.state === STATE.PATROL) {
      this._patrol(dt, desired);
    } else if (this.state === STATE.ALERT) {
      // advance cautiously toward last known position, facing it
      this.yaw = Math.atan2(this.lastKnownPos.x - this.position.x, this.lastKnownPos.z - this.position.z);
      desired.copy(toPlayer).multiplyScalar(this.speed * 0.6);
    } else if (this.state === STATE.COVER) {
      this._updateCover(dt, playerPos, toPlayer, dist, desired);
    } else if (this.state === STATE.COMBAT) {
      this._updateCombat(dt, playerPos, toPlayer, dist, desired);
    }

    // integrate movement with light AABB avoidance + terrain follow
    this._move(dt, desired);

    // weapon servicing (combat & cover states)
    if (this.state === STATE.COMBAT || this.state === STATE.COVER) {
      this._serviceWeapon(dt, playerPos, toPlayer, dist);
    }

    this.moveAmount = Math.min(1, this.velocity.length() / this.speed);
    this.mesh.position.copy(this.position);
    this._updateAnim(dt);
  }

  _patrol(dt, desired) {
    const wp = this.waypoints[this.wpIndex];
    _tmpV.set(wp.x - this.position.x, 0, wp.z - this.position.z);
    const d = _tmpV.length();
    if (d < 0.6) {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        this.wpIndex = (this.wpIndex + 1) % this.waypoints.length;
        this.waitTimer = 1 + Math.random() * 2.5;
      }
    } else {
      _tmpV.multiplyScalar(1 / d);
      this.yaw = Math.atan2(_tmpV.x, _tmpV.z);
      desired.copy(_tmpV).multiplyScalar(this.speed * 0.5);
    }
  }

  _updateCombat(dt, playerPos, toPlayer, dist, desired) {
    // always face the player in a firefight
    this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
    this.peek = 1;

    // maintain a preferred engagement band
    const band = this.preferredRange;
    if (dist > band + 4) desired.addScaledVector(toPlayer, this.speed);
    else if (dist < band - 4) desired.addScaledVector(toPlayer, -this.speed * 0.8);

    // strafe laterally, flipping direction periodically for a jinking read
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1.2 + Math.random() * 1.8; }
    const lateral = _tmpV.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(this.strafeDir * this.speed * 0.6);
    desired.add(lateral);

    // lost sight for a while -> drop to alert and hunt last known position
    if (!this.canSeePlayer && this.alertLevel < 0.4) this.state = STATE.ALERT;
  }

  _updateCover(dt, playerPos, toPlayer, dist, desired) {
    this.yaw = Math.atan2(toPlayer.x, toPlayer.z);
    if (this.coverPoint) {
      _tmpV.set(this.coverPoint.x - this.position.x, 0, this.coverPoint.z - this.position.z);
      const d = _tmpV.length();
      if (d > 0.7) {
        _tmpV.multiplyScalar(1 / d);
        desired.copy(_tmpV).multiplyScalar(this.speed);
        this.yaw = Math.atan2(_tmpV.x, _tmpV.z);
        this.peek = 0; // running, not shooting
      } else {
        // in cover: peek out to fire on a cycle
        this.peek = (Math.sin(this.ctx.elapsed * 1.6 + this.animPhase) > 0.3) ? 1 : 0;
      }
    }
    this.coverTimer -= dt;
    if (this.coverTimer <= 0) {
      this.coverPoint = null;
      this.state = STATE.COMBAT;
    }
  }

  _serviceWeapon(dt, playerPos, toPlayer, dist) {
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) { this.reloading = false; this.ammo = this.magSize; }
      return;
    }
    // don't fire while sprinting to cover
    if (this.state === STATE.COVER && this.peek < 0.5) return;
    if (dist > 72) return;

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;

    if (this.burstLeft <= 0) {
      // start a new burst (only if we have something to shoot at / suppress)
      if (!this.canSeePlayer && this.alertLevel < 0.3) { this.fireTimer = 0.5; return; }
      this.burstLeft = 3 + Math.floor(Math.random() * 3);
    }
    this._fire(playerPos, toPlayer, dist);
    this.burstLeft--;
    if (this.reloading) { this.burstLeft = 0; return; }
    if (this.burstLeft > 0) this.fireTimer = 0.09 + Math.random() * 0.05;     // intra-burst cadence
    else this.fireTimer = 0.9 + Math.random() * 1.4;                          // recovery between bursts
  }

  _move(dt, desired) {
    // accelerate toward desired velocity for a bit of weight
    this.velocity.x += (desired.x - this.velocity.x) * Math.min(1, dt * 8);
    this.velocity.z += (desired.z - this.velocity.z) * Math.min(1, dt * 8);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // light AABB avoidance so soldiers don't walk into cover geometry
    const cols = this.ctx.colliders;
    if (cols) {
      for (const c of cols) {
        if (!c.box) continue;
        const b = c.box;
        if (this.position.x > b.min.x - 0.3 && this.position.x < b.max.x + 0.3 &&
            this.position.z > b.min.z - 0.3 && this.position.z < b.max.z + 0.3 &&
            this.position.y + 1.5 > b.min.y && this.position.y < b.max.y) {
          // push out along the shallowest axis
          const dxMin = this.position.x - (b.min.x - 0.3);
          const dxMax = (b.max.x + 0.3) - this.position.x;
          const dzMin = this.position.z - (b.min.z - 0.3);
          const dzMax = (b.max.z + 0.3) - this.position.z;
          const m = Math.min(dxMin, dxMax, dzMin, dzMax);
          if (m === dxMin) this.position.x = b.min.x - 0.3;
          else if (m === dxMax) this.position.x = b.max.x + 0.3;
          else if (m === dzMin) this.position.z = b.min.z - 0.3;
          else this.position.z = b.max.z + 0.3;
        }
      }
    }

    // stick to the terrain
    const gy = this.ctx.environment?.getHeight?.(this.position.x, this.position.z);
    if (typeof gy === 'number') this.position.y = gy;
  }
}

export class EnemyManager {
  constructor(ctx) { this.ctx = ctx; this.enemies = []; }

  async init() {
    // Spawn points with a small patrol loop generated around each. The first
    // two sit in the near engagement zone (~12-16m ahead) so the player always
    // has a readable, legible combatant in frame from the opening advance.
    const spots = [
      [-4, 13], [7, 16],
      [-14, 24], [12, 30], [-24, 48], [20, 55], [0, 70], [-30, 82], [28, 92], [-8, 105],
    ];
    for (const [x, z] of spots) {
      const y = this.ctx.environment?.getHeight ? this.ctx.environment.getHeight(x, -z) : 0;
      const spawn = new THREE.Vector3(x, y, -z);
      this.enemies.push(new Enemy(this.ctx, spawn, this._makeRoute(spawn)));
    }
    this._buildShadows();
    this.remaining = this.enemies.length;
    this.ctx.on('enemy-killed', () => {
      this.remaining--;
      if (this.remaining <= 0) this.ctx.hud?.setObjective?.('Sector cleared. Hold position.');
    });
  }

  // One pooled InstancedMesh drives every soldier's contact shadow — a single
  // draw call for all of them, updated to the feet each frame.
  _buildShadows() {
    const { shadowMat, shadowGeo } = buildAssets();
    const mesh = new THREE.InstancedMesh(shadowGeo, shadowMat, this.enemies.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1; // draw before enemies so their rim/body sits on top
    this.ctx.scene.add(mesh);
    this.shadowMesh = mesh;
    this._shadowDummy = new THREE.Object3D();
    this._shadowDummy.rotation.x = -Math.PI / 2; // lay flat on the ground
  }

  _updateShadows() {
    const mesh = this.shadowMesh;
    if (!mesh) return;
    const dummy = this._shadowDummy;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      // Dead soldiers spread their shadow (toppled body); living ones tighten it.
      const dead = e.state === STATE.DEAD;
      const s = dead ? 1.55 : 1.15 - e.crouch * 0.15;
      dummy.position.set(e.position.x, e.position.y + 0.03, e.position.z);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Build a short 3-4 point patrol loop around a spawn, snapped to terrain.
  _makeRoute(spawn) {
    const pts = [];
    const n = 3 + Math.floor(Math.random() * 2);
    const rad = 4 + Math.random() * 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const px = spawn.x + Math.cos(a) * rad;
      const pz = spawn.z + Math.sin(a) * rad;
      const py = this.ctx.environment?.getHeight ? this.ctx.environment.getHeight(px, pz) : spawn.y;
      pts.push(new THREE.Vector3(px, py, pz));
    }
    return pts;
  }

  // Called by weapon hitscan. Returns {killed} or null.
  raycastHit(raycaster, damage) {
    let closest = null, closestDist = Infinity, isHead = false;
    for (const e of this.enemies) {
      if (e.state === STATE.DEAD) continue;
      // cheap broad-phase reject before per-mesh tests
      if (raycaster.ray.distanceSqToPoint(e.position) > 9) {
        // only skip when the whole soldier is well off the ray
        const near = _tmpV.copy(e.position); near.y += 1.2;
        if (raycaster.ray.distanceSqToPoint(near) > 4) continue;
      }
      const headHit = raycaster.intersectObject(e.headMesh, false);
      const helmHit = e.helmetMesh ? raycaster.intersectObject(e.helmetMesh, false) : [];
      const bodyHit = raycaster.intersectObject(e.torsoMesh, false);
      const head = headHit[0] || helmHit[0];
      const hit = head || bodyHit[0];
      if (hit && hit.distance < closestDist) {
        closestDist = hit.distance; closest = e; isHead = !!head;
      }
    }
    if (closest) return closest.hit(damage, isHead);
    return null;
  }

  update(dt) {
    const p = this.ctx.player.position;
    for (const e of this.enemies) e.update(dt, p);
    this._updateShadows();
  }
}
