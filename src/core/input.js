// Input: pointer lock, keyboard & mouse state.
export class Input {
  constructor(ctx) {
    this.ctx = ctx;
    this.keys = {};
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.locked = false;
    this.onPause = () => {};
    this.sensitivity = 0.0022;
  }

  init() {
    const canvas = this.ctx.engine.renderer.domElement;
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Escape') this.onPause();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  requestLock() { this.canvas.requestPointerLock?.(); }
  exitLock() { document.exitPointerLock?.(); }

  isDown(code) { return !!this.keys[code]; }

  // Consume accumulated mouse delta for this frame.
  consumeLook() {
    const dx = this.mouse.dx * this.sensitivity;
    const dy = this.mouse.dy * this.sensitivity;
    this.mouse.dx = 0; this.mouse.dy = 0;
    return { dx, dy };
  }

  update(dt) {}
}
