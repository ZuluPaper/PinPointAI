// Weapon system: detailed FN FAL viewmodel, procedural animation
// (sway/bob/recoil/reload/ADS), textured muzzle flash, and hitscan.
//
// PUBLIC INTERFACE (do not break): constructor(ctx), async init(),
//   .mag .reserve .reloading .ads .spec.name .switchWeapon(k) .update(dt)
import * as THREE from 'three';

const WEAPONS = {
  FAL: {
    name: 'FAL 7.62', magSize: 20, reserve: 120, fireRate: 0.14, damage: 34,
    recoil: 0.028, spread: 0.006, adsSpread: 0.0016, reloadTime: 2.3, auto: false,
  },
  AK: {
    name: 'AKM 7.62', magSize: 30, reserve: 150, fireRate: 0.1, damage: 26,
    recoil: 0.033, spread: 0.011, adsSpread: 0.0022, reloadTime: 2.6, auto: true,
  },
};

// ---- Procedural canvas textures (shared, built once) -----------------------
// Cached so both weapons and every material reuse the same GPU uploads.
let _tex = null;
function getTextures() {
  if (_tex) return _tex;

  // --- Walnut wood: grain, colour variation, subtle sheen roughness map ---
  const woodC = document.createElement('canvas'); woodC.width = woodC.height = 256;
  const wc = woodC.getContext('2d');
  // warm walnut base tone
  wc.fillStyle = '#4a2f1a'; wc.fillRect(0, 0, 256, 256);
  // long grain streaks
  for (let i = 0; i < 220; i++) {
    const y = Math.random() * 256;
    const shade = 20 + Math.random() * 40;
    wc.strokeStyle = `rgba(${20 + shade},${12 + shade * 0.6},${6 + shade * 0.3},${0.10 + Math.random() * 0.18})`;
    wc.lineWidth = 0.5 + Math.random() * 1.6;
    wc.beginPath();
    wc.moveTo(0, y);
    // gently waving horizontal grain line
    for (let x = 0; x <= 256; x += 16) {
      wc.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 + (Math.random() - 0.5) * 2);
    }
    wc.stroke();
  }
  // darker figure/knots
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 18;
    const kg = wc.createRadialGradient(x, y, 1, x, y, r);
    kg.addColorStop(0, 'rgba(20,10,4,0.55)'); kg.addColorStop(1, 'rgba(20,10,4,0)');
    wc.fillStyle = kg; wc.beginPath(); wc.arc(x, y, r, 0, Math.PI * 2); wc.fill();
  }
  const woodTex = new THREE.CanvasTexture(woodC);
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.anisotropy = 4; woodTex.colorSpace = THREE.SRGBColorSpace;

  // wood roughness (grain slightly glossier than valleys)
  const woodR = document.createElement('canvas'); woodR.width = woodR.height = 256;
  const wr = woodR.getContext('2d');
  wr.fillStyle = '#9a9a9a'; wr.fillRect(0, 0, 256, 256);
  wr.drawImage(woodC, 0, 0); // grain modulates roughness
  wr.globalCompositeOperation = 'source-over';
  const woodRough = new THREE.CanvasTexture(woodR);
  woodRough.wrapS = woodRough.wrapT = THREE.RepeatWrapping;

  // --- Parkerized/blued steel: fine brushed noise ---
  const metalC = document.createElement('canvas'); metalC.width = metalC.height = 128;
  const mc = metalC.getContext('2d');
  mc.fillStyle = '#23252b'; mc.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    const v = Math.random() * 40;
    mc.fillStyle = `rgba(${v},${v},${v + 4},0.06)`;
    mc.fillRect(x, y, 1 + Math.random() * 2, 1);
  }
  // faint horizontal machining bands
  for (let y = 0; y < 128; y += 3) {
    mc.fillStyle = `rgba(255,255,255,${Math.random() * 0.02})`;
    mc.fillRect(0, y, 128, 1);
  }
  const metalTex = new THREE.CanvasTexture(metalC);
  metalTex.wrapS = metalTex.wrapT = THREE.RepeatWrapping;
  metalTex.anisotropy = 4;

  // metal roughness map (mostly matte parkerizing with worn shinier edges)
  const metalR = document.createElement('canvas'); metalR.width = metalR.height = 128;
  const mrc = metalR.getContext('2d');
  mrc.fillStyle = '#7c7c7c'; mrc.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * 128, y = Math.random() * 128;
    mrc.fillStyle = `rgba(60,60,60,${Math.random() * 0.4})`; // wear = smoother
    mrc.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const metalRough = new THREE.CanvasTexture(metalR);
  metalRough.wrapS = metalRough.wrapT = THREE.RepeatWrapping;

  // --- Muzzle flash sprite (radial star, additive) ---
  const flashC = document.createElement('canvas'); flashC.width = flashC.height = 128;
  const fc = flashC.getContext('2d');
  const fg = fc.createRadialGradient(64, 64, 0, 64, 64, 64);
  fg.addColorStop(0, 'rgba(255,255,245,1)');
  fg.addColorStop(0.18, 'rgba(255,224,150,0.95)');
  fg.addColorStop(0.45, 'rgba(255,150,50,0.45)');
  fg.addColorStop(1, 'rgba(255,90,20,0)');
  fc.fillStyle = fg; fc.fillRect(0, 0, 128, 128);
  // spikes
  fc.translate(64, 64);
  fc.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    fc.rotate((Math.PI * 2 / 7) + Math.random() * 0.4);
    const len = 40 + Math.random() * 22;
    const sg = fc.createLinearGradient(0, 0, len, 0);
    sg.addColorStop(0, 'rgba(255,235,180,0.9)');
    sg.addColorStop(1, 'rgba(255,140,40,0)');
    fc.fillStyle = sg;
    fc.beginPath(); fc.moveTo(0, -3); fc.lineTo(len, 0); fc.lineTo(0, 3); fc.closePath(); fc.fill();
  }
  const flashTex = new THREE.CanvasTexture(flashC);
  flashTex.colorSpace = THREE.SRGBColorSpace;

  _tex = { woodTex, woodRough, metalTex, metalRough, flashTex };
  return _tex;
}

export class WeaponSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.current = 'FAL';
    this.mag = WEAPONS.FAL.magSize;
    this.reserve = WEAPONS.FAL.reserve;
    this.cooldown = 0;
    this.reloading = 0;
    this.ads = 0;            // 0..1 aim blend
    this.recoilKick = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();

    // animation state ---------------------------------------------------
    this._swayPos = new THREE.Vector3();   // smoothed look-sway (pos)
    this._swayRot = new THREE.Vector3();   // smoothed look-sway (rot)
    this._recoilRot = new THREE.Vector3(); // viewmodel recoil rotation
    this._recoilPos = new THREE.Vector3(); // viewmodel recoil push-back
    this._bobPhase = 0;                    // procedural idle breathing phase
    this._flashLife = 0;                   // 0..1 flash animation
    this._reloadTotal = 0;                 // captured reload duration
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
  }

  get spec() { return WEAPONS[this.current]; }

  async init() {
    this._buildViewModel();
  }

  // ---- Viewmodel construction ---------------------------------------------
  _buildViewModel() {
    const T = getTextures();
    const g = new THREE.Group();

    // PBR materials -------------------------------------------------------
    // Emissive "floor": a tiny self-lit warm term so no surface ever crushes to
    // pure black when the world sun is backlighting the camera. Kept far below
    // 1.0 so lit surfaces still read as lit, not glowing.
    const metal = new THREE.MeshStandardMaterial({
      color: 0x33353d, map: T.metalTex, roughnessMap: T.metalRough,
      roughness: 0.52, metalness: 0.9,
      emissive: 0x0b0c10, emissiveIntensity: 1.0,
    });
    const blackMetal = new THREE.MeshStandardMaterial({
      color: 0x1b1c22, roughness: 0.58, metalness: 0.85,
      emissive: 0x090a0d, emissiveIntensity: 1.0,
    });
    const wood = new THREE.MeshStandardMaterial({
      color: 0x7a4e28, map: T.woodTex, roughnessMap: T.woodRough,
      roughness: 0.7, metalness: 0.02,
      emissive: 0x0d0906, emissiveIntensity: 1.0,
    });

    // Root pivot so recoil rotates around the shoulder/wrist convincingly.
    const rig = new THREE.Group();
    g.add(rig);
    this.rig = rig;

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      rig.add(m); return m;
    };

    // --- Receiver / upper body ---
    add(new THREE.BoxGeometry(0.062, 0.072, 0.34), metal, 0, 0, -0.28);
    // lower receiver (magwell housing)
    add(new THREE.BoxGeometry(0.058, 0.05, 0.14), blackMetal, 0, -0.052, -0.30);
    // dust cover ridge on top
    add(new THREE.BoxGeometry(0.05, 0.016, 0.30), blackMetal, 0, 0.043, -0.27);

    // --- Barrel + flash hider ---
    const barrel = add(new THREE.CylinderGeometry(0.013, 0.013, 0.46, 14), metal, 0, 0.012, -0.60, Math.PI / 2);
    const flashHider = add(new THREE.CylinderGeometry(0.019, 0.017, 0.055, 12), blackMetal, 0, 0.012, -0.83, Math.PI / 2);
    // gas tube above barrel
    add(new THREE.CylinderGeometry(0.007, 0.007, 0.30, 8), blackMetal, 0, 0.036, -0.55, Math.PI / 2);

    // --- Wood handguard (fore-end) with slight taper ---
    add(new THREE.BoxGeometry(0.05, 0.052, 0.24), wood, 0, -0.006, -0.52);
    add(new THREE.BoxGeometry(0.056, 0.03, 0.22), wood, 0, -0.028, -0.52);
    // metal trunnion ring that visually breaks handguard from receiver, and a
    // stepped gas block up front — clear diameter changes down the barrel line.
    add(new THREE.CylinderGeometry(0.033, 0.033, 0.03, 12), metal, 0, 0.006, -0.40, Math.PI / 2);
    add(new THREE.BoxGeometry(0.03, 0.05, 0.045), metal, 0, 0.03, -0.66);

    // --- Wood buttstock ---
    add(new THREE.BoxGeometry(0.056, 0.10, 0.26), wood, 0, -0.014, 0.02, -0.06);
    // butt pad
    add(new THREE.BoxGeometry(0.05, 0.12, 0.02), blackMetal, 0, -0.02, 0.15, -0.06);

    // --- Pistol grip (wood) — fuller, with a flared cap so it reads as a grip ---
    add(new THREE.BoxGeometry(0.05, 0.14, 0.058), wood, 0, -0.105, -0.14, 0.34);
    add(new THREE.BoxGeometry(0.056, 0.02, 0.066), blackMetal, 0.004, -0.175, -0.115, 0.34); // grip cap
    // --- Trigger guard loop + trigger: a strong, unmistakable "gun" cue ---
    add(new THREE.TorusGeometry(0.026, 0.006, 8, 16), blackMetal, 0, -0.06, -0.20, 0, Math.PI / 2, 0);
    add(new THREE.BoxGeometry(0.008, 0.026, 0.006), blackMetal, 0, -0.052, -0.20); // trigger blade

    // --- Magazine (curved-ish, angled) as its own group so it can drop out ---
    const magGroup = new THREE.Group();
    const magBody = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.15, 0.09), metal);
    magBody.position.set(0, -0.075, 0);
    const magFloor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.014, 0.095), blackMetal);
    magFloor.position.set(0, -0.152, 0);
    magGroup.add(magBody, magFloor);
    magGroup.position.set(0, -0.062, -0.30);
    magGroup.rotation.x = 0.16;
    rig.add(magGroup);
    this.magGroup = magGroup;
    this._magRest = magGroup.position.clone();

    // --- Charging handle (left side) that racks during reload ---
    const chargeGroup = new THREE.Group();
    const chBar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 8), blackMetal);
    chBar.rotation.z = Math.PI / 2; chBar.position.set(-0.03, 0, 0);
    const chKnob = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), blackMetal);
    chKnob.position.set(-0.055, 0, 0);
    chargeGroup.add(chBar, chKnob);
    chargeGroup.position.set(-0.02, 0.02, -0.20);
    rig.add(chargeGroup);
    this.chargeGroup = chargeGroup;
    this._chargeRest = chargeGroup.position.z;

    // --- Iron sights: rear aperture + front post (raised so they break the
    // top silhouette and read as a sight line, not a flat rib) ---
    // Rear sight (aperture on a raised block)
    add(new THREE.BoxGeometry(0.03, 0.032, 0.024), blackMetal, 0, 0.062, -0.16);
    const rearRing = add(new THREE.TorusGeometry(0.008, 0.0026, 8, 12), blackMetal, 0, 0.076, -0.16);
    // Front sight tower: post on a base flanked by protective ears
    add(new THREE.BoxGeometry(0.03, 0.026, 0.03), blackMetal, 0, 0.052, -0.78);   // base
    add(new THREE.BoxGeometry(0.005, 0.036, 0.006), blackMetal, 0, 0.076, -0.78); // post
    add(new THREE.BoxGeometry(0.006, 0.034, 0.006), blackMetal, -0.013, 0.075, -0.78); // left ear
    add(new THREE.BoxGeometry(0.006, 0.034, 0.006), blackMetal, 0.013, 0.075, -0.78);  // right ear
    this.sightRef = rearRing; // used to align ADS to screen centre

    // --- Sling swivel nubs ---
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 8), blackMetal, 0, -0.05, -0.66, 0, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.005, 0.005, 0.02, 8), blackMetal, 0, -0.05, 0.10, 0, 0, Math.PI / 2);

    // Ensure viewmodel always draws over the world, unlit-safe.
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false; o.receiveShadow = false;
        o.frustumCulled = false; o.renderOrder = 999;
        if (o.material) o.material.depthTest = true;
      }
    });

    // --- Muzzle flash: additive textured sprite + point light + smoke seed ---
    this.muzzle = new THREE.PointLight(0xffcc66, 0, 7, 2.0);
    this.muzzle.position.set(0, 0.012, -0.86);
    rig.add(this.muzzle);

    const flashMat = new THREE.MeshBasicMaterial({
      map: T.flashTex, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
    this.flash.position.set(0, 0.012, -0.87);
    this.flash.renderOrder = 1000;
    this.flash.visible = false;
    rig.add(this.flash);
    // small forward-facing flash quad for depth
    this.flash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), flashMat.clone());
    this.flash2.material.opacity = 0;
    this.flash2.position.set(0, 0.012, -0.92);
    this.flash2.rotation.y = Math.PI / 2;
    this.flash2.renderOrder = 1000;
    this.flash2.visible = false;
    rig.add(this.flash2);

    // --- Dedicated viewmodel lighting rig -----------------------------------
    // The world key light (sun) is a backlight in golden hour, so the
    // camera-facing side of the gun receives almost nothing and crushes to a
    // black silhouette. Parent a warm, range-limited fill light to the camera
    // so the weapon is lit from the viewer's side regardless of sun direction.
    // The tight `distance` (falls to zero well before world cover) keeps this a
    // viewmodel light in practice — the gun sits 0.3-0.9m away and takes almost
    // all of it, while the savanna beyond 2.4m receives nothing.
    const keyFill = new THREE.PointLight(0xffe6c0, 1.35, 2.4, 2.0);
    keyFill.position.set(-0.28, 0.34, -0.35); // up and left of the muzzle line
    this.ctx.camera.add(keyFill);
    this.viewFill = keyFill;
    // A dim, cooler bounce from the lower right lifts the shadow side so the
    // receiver/wood read as rounded forms rather than a flat wedge.
    const rimFill = new THREE.PointLight(0xbfd0e0, 0.4, 2.0, 2.0);
    rimFill.position.set(0.34, -0.22, -0.25);
    this.ctx.camera.add(rimFill);
    this.viewRim = rimFill;

    this.viewModel = g;
    this.restPos = new THREE.Vector3(0.16, -0.155, -0.4);
    this.adsPos = new THREE.Vector3(0, -0.112, -0.30); // aperture aligned to centre
    // Resting low-ready cant: muzzle dipped, canted inboard so the receiver's
    // side profile, magazine and grip read as a rifle rather than an end-on
    // slab. Blended out toward zero as the player aims (see _animate).
    this.restRot = new THREE.Vector3(-0.07, 0.11, 0.06);
    g.position.copy(this.restPos);
    g.rotation.set(this.restRot.x, this.restRot.y, this.restRot.z);
    this.ctx.camera.add(g);
  }

  switchWeapon(key) {
    if (!WEAPONS[key] || key === this.current) return;
    this.current = key;
    this.mag = WEAPONS[key].magSize;
    this.reserve = WEAPONS[key].reserve;
    this.reloading = 0;
    // quick lowered "switch" pose kick
    this._recoilPos.z += 0.12;
    this._recoilRot.x += 0.25;
    this.ctx.emit('weapon-changed', { name: this.spec.name });
  }

  reload() {
    if (this.reloading > 0 || this.mag >= this.spec.magSize || this.reserve <= 0) return;
    this.reloading = this.spec.reloadTime;
    this._reloadTotal = this.spec.reloadTime;
    this.ctx.audio?.play('reload');
  }

  _fire() {
    const spec = this.spec;
    this.mag--;
    this.cooldown = spec.fireRate;

    // recoil kick — camera pitch plus viewmodel rotation/push for feel
    const recoil = spec.recoil * (1 - this.ads * 0.55);
    this.recoilKick.y += recoil;
    this.recoilKick.x += (Math.random() - 0.5) * recoil * 0.6;
    this.ctx.player.pitch += recoil;
    // viewmodel: kick back and muzzle-up, random roll
    this._recoilPos.z += 0.05 * (1 - this.ads * 0.5);
    this._recoilPos.y += 0.012 * (1 - this.ads * 0.5);
    this._recoilRot.x -= 0.22 * (1 - this.ads * 0.4);           // muzzle rises
    this._recoilRot.z += (Math.random() - 0.5) * 0.10 * (1 - this.ads * 0.6);
    this._recoilRot.y += (Math.random() - 0.5) * 0.05;

    // muzzle flash
    this.muzzle.intensity = 6;
    this._flashLife = 1;
    this.flash.visible = this.flash2.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.85 + Math.random() * 0.5;
    this.flash.scale.setScalar(s);
    this.ctx.audio?.play('shot');
    this.ctx.particles?.spawnMuzzleSmoke?.(this._muzzleWorldPos());

    // hitscan
    const cam = this.ctx.camera;
    const spread = (this.ads > 0.5 ? spec.adsSpread : spec.spread);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();
    this.raycaster.set(cam.getWorldPosition(new THREE.Vector3()), dir);
    this.raycaster.far = 400;

    const hitEnemy = this.ctx.enemies?.raycastHit?.(this.raycaster, spec.damage);
    if (hitEnemy) {
      this.ctx.hud?.showHitMarker?.(hitEnemy.killed);
    } else {
      const worldHits = this.raycaster.intersectObjects(this.ctx.level?.collidables || [], true);
      if (worldHits.length) {
        this.ctx.particles?.spawnImpact?.(worldHits[0].point, worldHits[0].face?.normal);
      }
    }
  }

  _muzzleWorldPos() { return this.muzzle.getWorldPosition(new THREE.Vector3()); }

  update(dt) {
    const input = this.ctx.input;
    const cdt = Math.min(1, dt * 12); // clamped blend factor

    // ADS blend (block full ADS during reload)
    const wantAds = input.mouse.right && this.reloading <= 0;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    this.ctx.camera.fov += ((wantAds ? 58 : 72) - this.ctx.camera.fov) * cdt;
    this.ctx.camera.updateProjectionMatrix();

    // reload timer
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = this.spec.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take; this.reserve -= take;
      }
    }
    if (input.isDown('KeyR')) this.reload();
    if (input.isDown('Digit1')) this.switchWeapon('FAL');
    if (input.isDown('Digit2')) this.switchWeapon('AK');

    // firing
    this.cooldown -= dt;
    const canFire = this.cooldown <= 0 && this.mag > 0 && this.reloading <= 0;
    if (canFire && input.mouse.left) {
      this._fire();
      if (!this.spec.auto) input.mouse.left = false; // semi-auto
    }
    if (this.mag === 0 && input.mouse.left && this.reloading <= 0) this.reload();

    // --- decay muzzle & camera recoil kick ---
    this.muzzle.intensity *= Math.pow(0.0008, dt);
    this.recoilKick.multiplyScalar(Math.pow(0.02, dt));

    // --- animate flash sprite life ---
    this._flashLife = Math.max(0, this._flashLife - dt * 18);
    const fl = this._flashLife;
    this.flash.material.opacity = fl;
    this.flash2.material.opacity = fl * 0.8;
    if (fl <= 0) { this.flash.visible = this.flash2.visible = false; }
    else { this.flash.rotation.z += dt * 6; }

    this._animate(dt, input);
  }

  // ---- Procedural viewmodel animation -------------------------------------
  _animate(dt, input) {
    const g = this.viewModel;
    const rig = this.rig;
    const t = this.ctx.elapsed || 0;

    // Spring-recover the recoil offsets toward zero.
    const recover = Math.pow(0.0006, dt);
    this._recoilPos.multiplyScalar(recover);
    this._recoilRot.multiplyScalar(recover);

    // --- Look sway: lag the weapon behind fast mouse movement ---
    // (mouse.dx/dy reflect this frame's look delta; player already consumed look)
    const dx = input.mouse.dx || 0;
    const dy = input.mouse.dy || 0;
    const swayScale = 1 - this.ads * 0.7;
    // target sway from angular velocity (smoothed)
    const targPX = -dx * 0.00022 * swayScale;
    const targPY = dy * 0.00022 * swayScale;
    this._swayPos.x += (THREE.MathUtils.clamp(targPX, -0.03, 0.03) - this._swayPos.x) * Math.min(1, dt * 10);
    this._swayPos.y += (THREE.MathUtils.clamp(targPY, -0.03, 0.03) - this._swayPos.y) * Math.min(1, dt * 10);
    // rotational sway (yaw/pitch tilt) with a bit of counter-roll
    const targRY = THREE.MathUtils.clamp(-dx * 0.00035 * swayScale, -0.06, 0.06);
    const targRX = THREE.MathUtils.clamp(dy * 0.00035 * swayScale, -0.06, 0.06);
    this._swayRot.y += (targRY - this._swayRot.y) * Math.min(1, dt * 9);
    this._swayRot.x += (targRX - this._swayRot.x) * Math.min(1, dt * 9);
    this._swayRot.z += (-this._swayRot.y * 0.5 - this._swayRot.z) * Math.min(1, dt * 8);

    // --- Idle breathing / weapon settle (figure-eight) ---
    this._bobPhase += dt;
    const idle = 1 - this.ads * 0.85;
    const idleX = Math.sin(this._bobPhase * 1.1) * 0.0016 * idle;
    const idleY = Math.sin(this._bobPhase * 2.2) * 0.0012 * idle;

    // --- Walk bob coupling from player.bobOffset ---
    let bobX = 0, bobY = 0, bobRoll = 0;
    if (this.ctx.player && this.ctx.player.bobOffset) {
      const b = this.ctx.player.bobOffset;
      const bScale = (1 - this.ads * 0.75);
      bobX = b.x * 0.55 * bScale;
      bobY = b.y * 0.55 * bScale;
      bobRoll = b.x * 2.2 * bScale; // sway roll coupled to lateral bob
    }

    // --- Reload animation ---
    let reloadPos = this._tmpV.set(0, 0, 0);
    let reloadRotX = 0, reloadRotZ = 0;
    if (this.reloading > 0 && this._reloadTotal > 0) {
      const p = 1 - (this.reloading / this._reloadTotal); // 0..1 progress
      // tilt the rifle inboard so player "sees" the magwell
      const tilt = Math.sin(Math.min(1, p / 0.15) * Math.PI * 0.5); // ramp in
      const outtilt = p > 0.85 ? (1 - (p - 0.85) / 0.15) : 1;       // ramp out
      const tiltAmt = tilt * outtilt;
      reloadRotZ = -0.5 * tiltAmt;
      reloadRotX = 0.18 * tiltAmt;
      reloadPos.set(-0.03 * tiltAmt, -0.04 * tiltAmt, 0.02 * tiltAmt);

      // magazine drop-out (0.1-0.35) and new mag insert (0.45-0.7)
      let magDrop = 0;
      if (p < 0.35) magDrop = THREE.MathUtils.smoothstep(p, 0.1, 0.35);          // 0->1 down
      else if (p < 0.45) magDrop = 1;                                            // gone
      else if (p < 0.7) magDrop = 1 - THREE.MathUtils.smoothstep(p, 0.45, 0.7);  // 1->0 back in
      this.magGroup.position.y = this._magRest.y - magDrop * 0.18;
      this.magGroup.position.z = this._magRest.z + magDrop * 0.02;
      this.magGroup.rotation.x = 0.16 + magDrop * 0.25;

      // charging handle rack near the end (0.78-0.95)
      let rack = 0;
      if (p > 0.78 && p < 0.95) {
        const rp = (p - 0.78) / 0.17;
        rack = Math.sin(rp * Math.PI); // pull back and release
      }
      this.chargeGroup.position.z = this._chargeRest + rack * 0.05;
    } else {
      // rest positions
      this.magGroup.position.y += (this._magRest.y - this.magGroup.position.y) * Math.min(1, dt * 12);
      this.magGroup.position.z += (this._magRest.z - this.magGroup.position.z) * Math.min(1, dt * 12);
      this.magGroup.rotation.x += (0.16 - this.magGroup.rotation.x) * Math.min(1, dt * 12);
      this.chargeGroup.position.z += (this._chargeRest - this.chargeGroup.position.z) * Math.min(1, dt * 14);
    }

    // --- Compose target position: rest <-> ADS + all offsets ---
    const target = this._tmpV2.copy(this.restPos).lerp(this.adsPos, this.ads);
    target.x += this._swayPos.x + idleX + bobX + reloadPos.x;
    target.y += this._swayPos.y + idleY + bobY + reloadPos.y;
    target.z += reloadPos.z;
    // recoil push
    target.add(this._recoilPos);

    // smoothly move the whole viewmodel group
    g.position.lerp(target, Math.min(1, dt * 20));

    // --- Compose rotation on the outer group ---
    // Base low-ready cant at the hip, straightened as the player aims so the
    // iron sights settle onto screen centre.
    const cant = 1 - this.ads;
    const rx = this.restRot.x * cant + this._swayRot.x + this._recoilRot.x + reloadRotX;
    const ry = this.restRot.y * cant + this._swayRot.y + this._recoilRot.y;
    const rz = this.restRot.z * cant + this._swayRot.z + this._recoilRot.z + bobRoll + reloadRotZ;
    g.rotation.x += (rx - g.rotation.x) * Math.min(1, dt * 22);
    g.rotation.y += (ry - g.rotation.y) * Math.min(1, dt * 22);
    g.rotation.z += (rz - g.rotation.z) * Math.min(1, dt * 22);

    // When aiming, nudge the rig laterally so the rear aperture sits on the
    // optical centre (sights aligned to screen centre).
    const aimShift = -0.0 * this.ads; // rig is already centred; keep hook for tuning
    rig.position.x += (aimShift - rig.position.x) * Math.min(1, dt * 16);
  }
}
