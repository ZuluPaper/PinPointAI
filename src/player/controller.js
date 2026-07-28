// Player controller: FPS movement, physics, camera, collision, head-bob.
import * as THREE from 'three';

export class PlayerController {
  constructor(ctx) {
    this.ctx = ctx;
    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 1.7, 6);
    this.yaw = 0;
    this.pitch = 0;

    this.standHeight = 1.7;
    this.crouchHeight = 1.05;
    this.eyeHeight = this.standHeight;
    this.radius = 0.35;

    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;

    this.walkSpeed = 4.4;
    this.sprintSpeed = 7.4;
    this.crouchSpeed = 2.2;
    this.jumpForce = 6.2;
    this.gravity = 20;

    this.health = 100;
    this.maxHealth = 100;
    this._regenTimer = 0;

    this.bobT = 0;
    this.bobOffset = new THREE.Vector3();
  }

  init() {
    this.ctx.camera.position.copy(this.position);
  }

  takeDamage(amount, fromDir) {
    if (this.ctx.state !== 'playing') return;
    this.health = Math.max(0, this.health - amount);
    this._regenTimer = 5;
    this.ctx.emit('player-hit', { amount, health: this.health, fromDir });
    if (this.health <= 0) this.ctx.emit('player-died', {});
  }

  update(dt) {
    const input = this.ctx.input;

    // --- look ---
    const look = input.consumeLook();
    this.yaw -= look.dx;
    this.pitch -= look.dy;
    const maxPitch = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    // --- movement intent ---
    this.crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
    const wantSprint = input.isDown('ShiftLeft') && !this.crouching;

    const forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    this.sprinting = wantSprint && forward > 0;

    let speed = this.crouching ? this.crouchSpeed : (this.sprinting ? this.sprintSpeed : this.walkSpeed);

    const dir = new THREE.Vector3();
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    dir.x += -sinY * forward + cosY * strafe;
    dir.z += -cosY * forward - sinY * strafe;
    if (dir.lengthSq() > 0) dir.normalize();

    this.velocity.x = dir.x * speed;
    this.velocity.z = dir.z * speed;

    // --- gravity / jump ---
    if (input.isDown('Space') && this.onGround) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }
    this.velocity.y -= this.gravity * dt;

    // --- integrate + collide ---
    const next = this.position.clone().addScaledVector(this.velocity, dt);
    this._collide(next);
    this.position.copy(next);

    // ground plane at y=0 (terrain height hook lives in Environment)
    const groundY = this._sampleGround(this.position.x, this.position.z);
    const targetEye = this.crouching ? this.crouchHeight : this.standHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    if (this.position.y <= groundY + this.eyeHeight) {
      this.position.y = groundY + this.eyeHeight;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // --- head bob ---
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && horizSpeed > 0.5) {
      this.bobT += dt * horizSpeed * 1.7;
      this.bobOffset.set(Math.cos(this.bobT) * 0.035, Math.abs(Math.sin(this.bobT)) * 0.05, 0);
    } else {
      this.bobOffset.multiplyScalar(1 - Math.min(1, dt * 8));
    }

    // --- apply to camera ---
    const cam = this.ctx.camera;
    cam.position.copy(this.position).add(this.bobOffset);
    cam.rotation.set(0, 0, 0);
    cam.rotateY(this.yaw);
    cam.rotateX(this.pitch);

    // --- health regen ---
    this._regenTimer -= dt;
    if (this._regenTimer <= 0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + dt * 12);
    }
  }

  _sampleGround(x, z) {
    return this.ctx.environment?.getHeight ? this.ctx.environment.getHeight(x, z) : 0;
  }

  _collide(next) {
    // Simple cylinder-vs-AABB resolution against ctx.colliders.
    for (const c of this.ctx.colliders) {
      const box = c.box || c;
      if (!box.min) continue;
      const cx = Math.max(box.min.x, Math.min(next.x, box.max.x));
      const cz = Math.max(box.min.z, Math.min(next.z, box.max.z));
      const dx = next.x - cx, dz = next.z - cz;
      const d2 = dx * dx + dz * dz;
      const footY = next.y - this.eyeHeight;
      const vertOverlap = footY < box.max.y && (footY + this.standHeight) > box.min.y;
      if (d2 < this.radius * this.radius && vertOverlap) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (this.radius - d);
        next.x += (dx / d) * push;
        next.z += (dz / d) * push;
      }
    }
  }
}
