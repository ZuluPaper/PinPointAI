// Player controller: FPS movement, physics, camera, collision, head-bob.
// Owns "player feel": acceleration/friction, air control, sprint-FOV coupling,
// smooth crouch, landing impact dip, weapon-coupled camera sway and refined bob.
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

    // Ground/air acceleration model (units/s^2) — gives weight without sluggishness.
    this.groundAccel = 60;
    this.groundFriction = 11;   // exponential damping toward target velocity
    this.airAccel = 10;
    this.airControl = 0.35;     // fraction of steering authority while airborne

    this.health = 100;
    this.maxHealth = 100;
    this._regenTimer = 0;

    // Head-bob + view feel state.
    this.bobT = 0;
    this.bobOffset = new THREE.Vector3();   // public: read by weapons/HUD
    this._bobAmp = 0;                        // smoothed bob amplitude [0..1]
    this._viewRoll = 0;                      // strafe-coupled camera roll (rad)
    this._landDip = 0;                       // vertical dip from landing impact
    this._landDipVel = 0;                    // spring velocity for the dip
    this._prevFallSpeed = 0;                 // downward speed last frame (for impact)
    this._swayYaw = 0;                       // smoothed look-delta for weapon sway
    this._swayPitch = 0;
    this._stepPhase = 0;                     // tracks footfalls for audio triggering

    // Sprint-FOV coupling (hook via camera). Base FOV captured on init.
    this._baseFov = 70;
    this._fovBoost = 0;                      // smoothed additive FOV [0..1]
    this.sprintFovAdd = 9;                   // extra degrees at full sprint

    // Reusable temporaries (avoid per-frame allocation).
    this._tmpDir = new THREE.Vector3();
    this._tmpWish = new THREE.Vector3();
  }

  init() {
    const cam = this.ctx.camera;
    if (cam && typeof cam.fov === 'number') this._baseFov = cam.fov;
    cam.position.copy(this.position);
  }

  takeDamage(amount, fromDir) {
    if (this.ctx.state !== 'playing') return;
    this.health = Math.max(0, this.health - amount);
    this._regenTimer = 5;
    this.ctx.emit('player-hit', { amount, health: this.health, fromDir });
    if (this.health <= 0) this.ctx.emit('player-died', {});
  }

  update(dt) {
    // Clamp dt so a stall (tab switch, GC hitch) can't tunnel us through walls.
    dt = Math.min(dt, 0.05);
    const input = this.ctx.input;

    // --- look ---
    const look = input.consumeLook();
    this.yaw -= look.dx;
    this.pitch -= look.dy;
    const maxPitch = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    // Smoothed look velocity → weapon-coupled camera sway (subtle, lags the aim).
    const swayK = 1 - Math.exp(-dt * 12);
    this._swayYaw += (look.dx - this._swayYaw) * swayK;
    this._swayPitch += (look.dy - this._swayPitch) * swayK;

    // --- movement intent ---
    this.crouching = input.isDown('ControlLeft') || input.isDown('KeyC');
    const wantSprint = input.isDown('ShiftLeft') && !this.crouching;

    const forward = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const strafe = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    this.sprinting = wantSprint && forward > 0;

    const speed = this.crouching ? this.crouchSpeed
      : (this.sprinting ? this.sprintSpeed : this.walkSpeed);

    // Desired horizontal velocity in world space.
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const wish = this._tmpWish.set(
      -sinY * forward + cosY * strafe,
      0,
      -cosY * forward - sinY * strafe
    );
    if (wish.lengthSq() > 0) wish.normalize();
    const wishX = wish.x * speed;
    const wishZ = wish.z * speed;

    // Accelerate toward wish velocity — grounded uses friction+accel for weight,
    // airborne keeps existing momentum and only allows partial steering (air control).
    if (this.onGround) {
      const fr = 1 - Math.exp(-dt * this.groundFriction);
      this.velocity.x += (wishX - this.velocity.x) * fr;
      this.velocity.z += (wishZ - this.velocity.z) * fr;
    } else {
      const ac = this.airAccel * this.airControl * dt;
      this.velocity.x += (wishX - this.velocity.x) * Math.min(1, ac);
      this.velocity.z += (wishZ - this.velocity.z) * Math.min(1, ac);
    }

    // --- gravity / jump ---
    if (input.isDown('Space') && this.onGround) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }
    this.velocity.y -= this.gravity * dt;

    // Remember fall speed before integration to size the landing impact.
    this._prevFallSpeed = this.velocity.y < 0 ? -this.velocity.y : 0;

    // --- integrate + collide (horizontal), then resolve ground ---
    const next = this.position.clone().addScaledVector(this.velocity, dt);
    this._collide(next);
    this.position.copy(next);

    // Smooth crouch: interpolate eye height (feet stay planted on ground).
    const targetEye = this.crouching ? this.crouchHeight : this.standHeight;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-dt * 12));

    // Ground/terrain following.
    const groundY = this._sampleGround(this.position.x, this.position.z);
    const floorEye = groundY + this.eyeHeight;
    const wasAir = !this.onGround;
    if (this.position.y <= floorEye) {
      // Landing this frame? Convert impact into a camera dip via a spring.
      if (wasAir && this._prevFallSpeed > 2.5) {
        const impact = Math.min(1, (this._prevFallSpeed - 2.5) / 8);
        this._landDipVel -= impact * 3.2;
        if (this.ctx.audio) this.ctx.audio.play('land', this.position);
      }
      this.position.y = floorEye;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // --- landing dip spring (critically-ish damped) ---
    const dipStiff = 90, dipDamp = 14;
    this._landDipVel += (-this._landDip * dipStiff - this._landDipVel * dipDamp) * dt;
    this._landDip += this._landDipVel * dt;
    this._landDip = Math.max(-0.28, Math.min(0.05, this._landDip));

    // --- refined head-bob ---
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.onGround && horizSpeed > 0.4;
    // Smooth the bob amplitude so start/stop doesn't pop.
    const targetAmp = moving ? Math.min(1, horizSpeed / this.walkSpeed) : 0;
    this._bobAmp += (targetAmp - this._bobAmp) * (1 - Math.exp(-dt * 9));

    if (moving) {
      const cadence = this.sprinting ? 2.2 : (this.crouching ? 1.15 : 1.65);
      this.bobT += dt * horizSpeed * cadence;
    }
    // Vertical bob is double-frequency (both feet); horizontal is single.
    const vBob = Math.abs(Math.sin(this.bobT)) * 0.055 * this._bobAmp;
    const hBob = Math.cos(this.bobT) * 0.04 * this._bobAmp;
    this.bobOffset.set(
      hBob,
      vBob + this._landDip,
      0
    );

    // Footstep audio on bob down-beats.
    const phase = Math.sin(this.bobT);
    if (moving && phase < 0 && this._stepPhase >= 0 && this.ctx.audio) {
      this.ctx.audio.play('step', this.position);
    }
    this._stepPhase = phase;

    // Strafe-coupled camera roll — leans slightly into lateral movement.
    const targetRoll = -strafe * 0.012 * this._bobAmp;
    this._viewRoll += (targetRoll - this._viewRoll) * (1 - Math.exp(-dt * 8));

    // --- sprint-FOV coupling (hook via camera) ---
    const fovTarget = this.sprinting ? 1 : 0;
    this._fovBoost += (fovTarget - this._fovBoost) * (1 - Math.exp(-dt * 8));
    const cam = this.ctx.camera;
    if (typeof cam.fov === 'number') {
      const desiredFov = this._baseFov + this.sprintFovAdd * this._fovBoost;
      if (Math.abs(cam.fov - desiredFov) > 0.01) {
        cam.fov = desiredFov;
        cam.updateProjectionMatrix();
      }
    }

    // --- apply to camera ---
    cam.position.copy(this.position).add(this.bobOffset);
    cam.rotation.set(0, 0, 0);
    // Weapon-coupled sway: nudge view opposite to fast look input, plus bob roll.
    cam.rotateY(this.yaw + this._swayYaw * 0.15);
    cam.rotateX(this.pitch + this._swayPitch * 0.12 + Math.sin(this.bobT * 2) * 0.0025 * this._bobAmp);
    cam.rotateZ(this._viewRoll + this._swayYaw * 0.4);

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
    // Cylinder-vs-AABB resolution against ctx.colliders. Iterate a few times so
    // corner cases (touching two boxes at once) settle without jitter/tunneling.
    const r = this.radius;
    const r2 = r * r;
    const colliders = this.ctx.colliders;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let i = 0; i < colliders.length; i++) {
        const c = colliders[i];
        const box = c.box || c;
        if (!box.min) continue;

        // Vertical overlap test: does our body span the box in Y?
        const footY = next.y - this.eyeHeight;
        const headY = footY + this.standHeight;
        if (headY <= box.min.y || footY >= box.max.y) continue;

        // Closest point on the box footprint to our center (in XZ).
        const cx = Math.max(box.min.x, Math.min(next.x, box.max.x));
        const cz = Math.max(box.min.z, Math.min(next.z, box.max.z));
        const dx = next.x - cx, dz = next.z - cz;
        const d2 = dx * dx + dz * dz;

        if (d2 < r2) {
          if (d2 > 1e-8) {
            // Push out along the nearest surface normal.
            const d = Math.sqrt(d2);
            const push = (r - d);
            next.x += (dx / d) * push;
            next.z += (dz / d) * push;
          } else {
            // Center is inside the box: eject along the shallowest axis.
            const toMinX = next.x - box.min.x, toMaxX = box.max.x - next.x;
            const toMinZ = next.z - box.min.z, toMaxZ = box.max.z - next.z;
            const mx = Math.min(toMinX, toMaxX);
            const mz = Math.min(toMinZ, toMaxZ);
            if (mx < mz) {
              next.x += (toMinX < toMaxX ? -(mx + r) : (mx + r));
            } else {
              next.z += (toMinZ < toMaxZ ? -(mz + r) : (mz + r));
            }
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }
}
