// Kwanza — Angola 1975. Entry point & system orchestration.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { PlayerController } from './player/controller.js';
import { WeaponSystem } from './weapons/weapon.js';
import { EnemyManager } from './enemies/ai.js';
import { Level } from './world/level.js';
import { Environment } from './world/environment.js';
import { ParticleSystem } from './fx/particles.js';
import { AudioManager } from './audio/audio.js';
import { HUD } from './ui/hud.js';

/**
 * GameContext is the single shared object passed to every system.
 * Systems must NOT reach into each other directly except through this.
 */
class GameContext {
  constructor() {
    this.THREE = THREE;
    this.engine = null;
    this.input = null;
    this.player = null;
    this.weapons = null;
    this.enemies = null;
    this.level = null;
    this.environment = null;
    this.particles = null;
    this.audio = null;
    this.hud = null;

    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.state = 'loading'; // loading | menu | playing | paused | dead
    this.colliders = [];    // world AABB/mesh colliders for player+physics
    this.events = new EventTarget();
  }

  get scene() { return this.engine.scene; }
  get camera() { return this.engine.camera; }

  emit(type, detail) { this.events.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.events.addEventListener(type, fn); }
}

class Game {
  constructor() {
    this.ctx = new GameContext();
  }

  async init() {
    const ctx = this.ctx;
    const setProgress = (p) => {
      const bar = document.getElementById('loading-bar');
      if (bar) bar.style.width = `${Math.round(p * 100)}%`;
    };

    ctx.engine = new Engine(ctx);            await ctx.engine.init();       setProgress(0.15);
    ctx.input = new Input(ctx);              ctx.input.init();               setProgress(0.25);
    ctx.audio = new AudioManager(ctx);       await ctx.audio.init();         setProgress(0.35);
    ctx.environment = new Environment(ctx);  await ctx.environment.init();   setProgress(0.55);
    ctx.level = new Level(ctx);              await ctx.level.init();         setProgress(0.75);
    ctx.particles = new ParticleSystem(ctx); ctx.particles.init();           setProgress(0.82);
    ctx.player = new PlayerController(ctx);  ctx.player.init();              setProgress(0.9);
    ctx.weapons = new WeaponSystem(ctx);     await ctx.weapons.init();       setProgress(0.95);
    ctx.enemies = new EnemyManager(ctx);     await ctx.enemies.init();       setProgress(0.98);
    ctx.hud = new HUD(ctx);                  ctx.hud.init();                 setProgress(1.0);

    this._wireMenu();
    ctx.state = 'menu';
    document.getElementById('start-btn').style.display = 'block';

    window.addEventListener('resize', () => ctx.engine.onResize());
    this.loop();
  }

  _wireMenu() {
    const ctx = this.ctx;
    const startOverlay = document.getElementById('start-overlay');
    const pauseOverlay = document.getElementById('pause-overlay');
    const hud = document.getElementById('hud');

    const begin = () => {
      startOverlay.classList.add('hidden');
      pauseOverlay.classList.add('hidden');
      hud.classList.remove('hidden');
      ctx.state = 'playing';
      ctx.input.requestLock();
      ctx.audio.resume();
    };
    document.getElementById('start-btn').addEventListener('click', begin);
    document.getElementById('resume-btn').addEventListener('click', begin);

    ctx.input.onPause = () => {
      if (ctx.state !== 'playing') return;
      ctx.state = 'paused';
      document.getElementById('pause-title').textContent = 'PAUSED';
      pauseOverlay.classList.remove('hidden');
    };

    ctx.on('player-died', () => {
      ctx.state = 'dead';
      document.getElementById('pause-title').textContent = 'YOU DIED';
      document.getElementById('resume-btn').textContent = 'REDEPLOY';
      pauseOverlay.classList.remove('hidden');
      ctx.input.exitLock();
    });
  }

  loop() {
    const ctx = this.ctx;
    let frames = 0, fpsTime = 0;
    const fpsEl = document.getElementById('fps-counter');

    const tick = () => {
      requestAnimationFrame(tick);
      let dt = ctx.clock.getDelta();
      dt = Math.min(dt, 0.05); // clamp to avoid tunneling on stalls
      ctx.elapsed += dt;

      if (ctx.state === 'playing') {
        ctx.input.update(dt);
        ctx.player.update(dt);
        ctx.weapons.update(dt);
        ctx.enemies.update(dt);
        ctx.particles.update(dt);
        ctx.environment.update(dt);
        ctx.audio.update(dt);
        ctx.hud.update(dt);
      }
      ctx.engine.render(dt);

      frames++; fpsTime += dt;
      if (fpsTime >= 0.5) { fpsEl.textContent = `${Math.round(frames / fpsTime)} fps`; frames = 0; fpsTime = 0; }
    };
    tick();
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error('Fatal init error:', e);
  const btn = document.getElementById('start-btn');
  if (btn) { btn.style.display = 'block'; btn.textContent = 'ERROR — SEE CONSOLE'; }
});

window.__KWANZA__ = game; // debug handle for tests/screenshots
