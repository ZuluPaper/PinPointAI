// Enemy AI: spawning, patrol/spot/cover/shoot state machine, hit resolution.
import * as THREE from 'three';

const STATE = { PATROL: 'patrol', ALERT: 'alert', COMBAT: 'combat', DEAD: 'dead' };

class Enemy {
  constructor(ctx, position) {
    this.ctx = ctx;
    this.health = 100;
    this.state = STATE.PATROL;
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.fireCooldown = 1 + Math.random();
    this.stateTimer = 0;
    this.speed = 2.6;
    this._buildMesh();
  }

  _buildMesh() {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x5a5236, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x6b4a34, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), cloth);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12), skin);
    head.position.y = 1.72;
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 4, 8), cloth);
    legs.position.y = 0.5;
    g.add(torso, head, legs);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.copy(this.position);
    this.mesh = g;
    this.headMesh = head;
    this.torsoMesh = torso;
    this.ctx.scene.add(g);
  }

  hit(damage, headshot) {
    if (this.state === STATE.DEAD) return { killed: false };
    this.health -= headshot ? damage * 2.5 : damage;
    this.state = STATE.COMBAT;
    this.ctx.particles?.spawnBlood?.(this.mesh.position.clone().setY(1.3));
    if (this.health <= 0) { this.die(); return { killed: true }; }
    return { killed: false };
  }

  die() {
    this.state = STATE.DEAD;
    this.mesh.rotation.x = -Math.PI / 2.2;
    this.mesh.position.y -= 0.4;
    this.ctx.emit('enemy-killed', {});
  }

  update(dt, playerPos) {
    if (this.state === STATE.DEAD) return;
    const toPlayer = playerPos.clone().sub(this.position);
    const dist = toPlayer.length();
    toPlayer.normalize();

    // detection
    if (dist < 55 && this.state === STATE.PATROL) this.state = STATE.ALERT;

    if (this.state === STATE.ALERT || this.state === STATE.COMBAT) {
      // face player
      this.mesh.lookAt(playerPos.x, this.mesh.position.y, playerPos.z);
      // strafe/advance to a preferred range
      const preferred = 18;
      if (dist > preferred + 4) this.position.addScaledVector(toPlayer, this.speed * dt);
      else if (dist < preferred - 4) this.position.addScaledVector(toPlayer, -this.speed * dt);

      // shoot
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0 && dist < 60) {
        this.fireCooldown = 1.4 + Math.random() * 1.2;
        // accuracy falls with distance
        const hitChance = Math.max(0.08, 0.6 - dist * 0.008);
        if (Math.random() < hitChance) {
          this.ctx.player.takeDamage(8 + Math.random() * 7, toPlayer.clone().negate());
        }
        this.ctx.particles?.spawnMuzzleSmoke?.(this.mesh.position.clone().setY(1.3));
        this.ctx.audio?.play('enemyShot', this.position);
      }
    }
    this.mesh.position.copy(this.position);
  }
}

export class EnemyManager {
  constructor(ctx) { this.ctx = ctx; this.enemies = []; }

  async init() {
    const spots = [
      [-14, 24], [12, 30], [-24, 48], [20, 55], [0, 70], [-30, 82], [28, 92], [-8, 105],
    ];
    for (const [x, z] of spots) {
      const y = this.ctx.environment?.getHeight ? this.ctx.environment.getHeight(x, z) : 0;
      this.enemies.push(new Enemy(this.ctx, new THREE.Vector3(x, y, -z)));
    }
    this.remaining = this.enemies.length;
    this.ctx.on('enemy-killed', () => {
      this.remaining--;
      if (this.remaining <= 0) this.ctx.hud?.setObjective?.('Sector cleared. Hold position.');
    });
  }

  // Called by weapon hitscan. Returns {killed} or null.
  raycastHit(raycaster, damage) {
    let closest = null, closestDist = Infinity, isHead = false;
    for (const e of this.enemies) {
      if (e.state === STATE.DEAD) continue;
      const headHit = raycaster.intersectObject(e.headMesh, false);
      const bodyHit = raycaster.intersectObject(e.torsoMesh, false);
      const hit = headHit[0] || bodyHit[0];
      if (hit && hit.distance < closestDist) {
        closestDist = hit.distance; closest = e; isHead = !!headHit[0];
      }
    }
    if (closest) return closest.hit(damage, isHead);
    return null;
  }

  update(dt) {
    const p = this.ctx.player.position;
    for (const e of this.enemies) e.update(dt, p);
  }
}
