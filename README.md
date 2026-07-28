# KWANZA — Angola 1975

A browser-based first-person shooter built in **Three.js** (WebGL), set during the
Angolan Civil War. It is a work of fiction that aims to treat the period with gravity,
not to glorify the conflict or any faction within it.

> **Scope note.** This is the best-in-class *browser* FPS we can build in WebGL — not a
> literal Call of Duty. A modern AAA title is a $100M+, multi-year effort on a custom
> engine with hand-authored/mocap assets. This project targets a polished, cohesive,
> good-looking WebGL shooter that plays at 60fps in a normal browser tab.

## Run it

It's fully static and self-contained (Three.js is vendored under `vendor/`, no CDN):

```bash
# any static file server works, e.g.
npx serve .
# or
python3 -m http.server 8000
```

Then open the served `index.html`. Click **DEPLOY**, then:

| Action | Key |
| --- | --- |
| Move | `WASD` |
| Look | Mouse |
| Fire | Left click |
| Aim (ADS) | Right click |
| Sprint | `Shift` |
| Crouch | `Ctrl` / `C` |
| Jump | `Space` |
| Reload | `R` |
| Switch weapon | `1` / `2` |
| Pause | `Esc` |

## Architecture

A single `GameContext` (in `src/main.js`) is shared across independent systems, each
owning one module and exposing `init()` / `update(dt)`:

| System | File | Responsibility |
| --- | --- | --- |
| Engine | `src/core/engine.js` | Renderer, scene, camera, post-processing (SSAO, bloom, SMAA, tone map) |
| Input | `src/core/input.js` | Pointer lock, keyboard/mouse |
| Player | `src/player/controller.js` | Movement, physics, collision, head-bob, health |
| Weapons | `src/weapons/weapon.js` | Viewmodel, ADS, recoil, muzzle flash, reload, hitscan |
| Enemies | `src/enemies/ai.js` | Spawning, patrol/alert/combat AI, hit resolution |
| Environment | `src/world/environment.js` | Sky, sun, fog, terrain heightfield |
| Level | `src/world/level.js` | Structures, foliage, cover, colliders |
| Particles | `src/fx/particles.js` | Muzzle smoke, impacts, blood, dust |
| Audio | `src/audio/audio.js` | Procedural WebAudio SFX |
| HUD | `src/ui/hud.js` | Health, ammo, crosshair, hit markers, objective |

## Development tooling

`tools/shoot.mjs` is a headless Playwright harness that serves the game, boots it, and
captures a screenshot while reporting console errors — used to visually verify quality.

```bash
node tools/shoot.mjs tools/shot.png 5000
```
