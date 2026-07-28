// Weapon system: viewmodel, ADS, recoil, muzzle flash, reload, hitscan.
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
  }

  get spec() { return WEAPONS[this.current]; }

  async init() {
    this._buildViewModel();
  }

  _buildViewModel() {
    // Procedural low-poly rifle held in view space, parented to camera.
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.7, metalness: 0.05 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.6), metal);
    body.position.set(0, 0, -0.3);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 12), metal);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.62);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.28), wood);
    stock.position.set(0, -0.02, 0.04);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), wood);
    grip.position.set(0, -0.11, -0.15); grip.rotation.x = 0.35;
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.1), metal);
    mag.position.set(0, -0.14, -0.28); mag.rotation.x = 0.15;

    g.add(body, barrel, stock, grip, mag);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; o.renderOrder = 999; if (o.material) o.material.depthTest = true; } });

    // muzzle flash
    this.muzzle = new THREE.PointLight(0xffcc66, 0, 6, 2);
    this.muzzle.position.set(0, 0.02, -0.9);
    g.add(this.muzzle);
    const flashGeo = new THREE.PlaneGeometry(0.35, 0.35);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false });
    this.flash = new THREE.Mesh(flashGeo, flashMat);
    this.flash.position.set(0, 0.02, -0.9);
    this.flash.renderOrder = 1000;
    g.add(this.flash);

    this.viewModel = g;
    this.restPos = new THREE.Vector3(0.16, -0.16, -0.4);
    this.adsPos = new THREE.Vector3(0, -0.11, -0.28);
    g.position.copy(this.restPos);
    this.ctx.camera.add(g);
  }

  switchWeapon(key) {
    if (!WEAPONS[key] || key === this.current) return;
    this.current = key;
    this.mag = WEAPONS[key].magSize;
    this.reserve = WEAPONS[key].reserve;
    this.ctx.emit('weapon-changed', { name: this.spec.name });
  }

  reload() {
    if (this.reloading > 0 || this.mag >= this.spec.magSize || this.reserve <= 0) return;
    this.reloading = this.spec.reloadTime;
    this.ctx.audio?.play('reload');
  }

  _fire() {
    const spec = this.spec;
    this.mag--;
    this.cooldown = spec.fireRate;

    // recoil kick
    const recoil = spec.recoil * (1 - this.ads * 0.55);
    this.recoilKick.y += recoil;
    this.recoilKick.x += (Math.random() - 0.5) * recoil * 0.6;
    this.ctx.player.pitch += recoil;

    // muzzle
    this.muzzle.intensity = 5;
    this.flash.material.opacity = 1;
    this.flash.rotation.z = Math.random() * Math.PI;
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

    // ADS blend
    const wantAds = input.mouse.right;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 12);
    this.ctx.camera.fov += ((wantAds ? 62 : 75) - this.ctx.camera.fov) * Math.min(1, dt * 12);
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
    if (this.mag === 0 && input.mouse.left) this.reload();

    // decay muzzle & recoil
    this.muzzle.intensity *= Math.pow(0.001, dt);
    this.flash.material.opacity *= Math.pow(0.0001, dt);
    this.recoilKick.multiplyScalar(Math.pow(0.02, dt));

    // viewmodel position: rest <-> ads + recoil + sway
    const target = this.restPos.clone().lerp(this.adsPos, this.ads);
    const sway = this.ctx.player ? new THREE.Vector3(-input.mouse.dx * 0.00002, input.mouse.dy * 0.00002, 0) : new THREE.Vector3();
    target.add(sway);
    target.z += this.recoilKick.y * 0.5;
    target.y += this.recoilKick.y * 0.3;
    this.viewModel.position.lerp(target, Math.min(1, dt * 18));

    // bob on viewmodel
    if (this.ctx.player) {
      const bob = this.ctx.player.bobOffset;
      this.viewModel.position.x += bob.x * 0.5 * (1 - this.ads);
      this.viewModel.position.y += bob.y * 0.5 * (1 - this.ads);
    }
  }
}
