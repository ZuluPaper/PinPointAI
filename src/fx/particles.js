// Particle & FX system: muzzle smoke, impacts, blood, dust — pooled sprites.
import * as THREE from 'three';

function makeSpriteTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner); grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

class Pool {
  constructor(scene, material, size) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const s = new THREE.Sprite(material.clone());
      s.visible = false; s.userData.life = 0;
      scene.add(s); this.items.push(s);
    }
  }
  spawn(pos, opts) {
    const s = this.items.find((it) => !it.visible) || this.items[0];
    s.visible = true;
    s.position.copy(pos);
    s.userData.life = opts.life;
    s.userData.maxLife = opts.life;
    s.userData.vel = opts.vel || new THREE.Vector3();
    s.userData.grow = opts.grow || 0;
    s.userData.startScale = opts.scale || 1;
    s.scale.setScalar(opts.scale || 1);
    s.material.opacity = opts.opacity ?? 1;
    if (opts.color) s.material.color.set(opts.color);
    return s;
  }
  update(dt) {
    for (const s of this.items) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { s.visible = false; continue; }
      const t = 1 - s.userData.life / s.userData.maxLife;
      s.position.addScaledVector(s.userData.vel, dt);
      s.userData.vel.multiplyScalar(1 - dt * 1.5);
      s.scale.setScalar(s.userData.startScale + s.userData.grow * t);
      s.material.opacity = (1 - t);
    }
  }
}

export class ParticleSystem {
  constructor(ctx) { this.ctx = ctx; }

  init() {
    const scene = this.ctx.scene;
    this.smokeTex = makeSpriteTexture('rgba(180,180,180,0.9)', 'rgba(120,120,120,0)');
    this.sparkTex = makeSpriteTexture('rgba(255,220,140,1)', 'rgba(255,140,40,0)');
    this.bloodTex = makeSpriteTexture('rgba(140,20,10,1)', 'rgba(80,10,5,0)');
    this.dustTex = makeSpriteTexture('rgba(200,180,130,0.8)', 'rgba(160,140,90,0)');

    const smokeMat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false });
    const sparkMat = new THREE.SpriteMaterial({ map: this.sparkTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const bloodMat = new THREE.SpriteMaterial({ map: this.bloodTex, transparent: true, depthWrite: false });
    const dustMat = new THREE.SpriteMaterial({ map: this.dustTex, transparent: true, depthWrite: false });

    this.smoke = new Pool(scene, smokeMat, 40);
    this.sparks = new Pool(scene, sparkMat, 60);
    this.blood = new Pool(scene, bloodMat, 40);
    this.dust = new Pool(scene, dustMat, 30);
  }

  spawnMuzzleSmoke(pos) {
    this.smoke.spawn(pos, { life: 0.6, scale: 0.15, grow: 0.6, vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.6, (Math.random() - 0.5) * 0.5) });
  }

  spawnImpact(pos, normal) {
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
      this.sparks.spawn(pos, { life: 0.25, scale: 0.08, vel: v });
    }
    this.dust.spawn(pos, { life: 0.7, scale: 0.2, grow: 0.5, vel: new THREE.Vector3(0, 0.4, 0) });
  }

  spawnBlood(pos) {
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 1.5, (Math.random() - 0.5) * 2.5);
      this.blood.spawn(pos, { life: 0.4, scale: 0.09, vel: v });
    }
  }

  update(dt) {
    this.smoke.update(dt); this.sparks.update(dt); this.blood.update(dt); this.dust.update(dt);
  }
}
