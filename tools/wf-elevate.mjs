export const meta = {
  name: 'kwanza-elevate',
  description: 'Elevate each Kwanza FPS subsystem to max WebGL visual/gameplay quality, then integrate & self-repair',
  phases: [
    { title: 'Elevate', detail: 'one agent per subsystem, disjoint file ownership' },
    { title: 'Integrate', detail: 'run headless build, report & repair console errors' },
  ],
};

// ---- Shared interface contract every agent MUST preserve ----
const CONTRACT = `
PROJECT: "Kwanza — Angola 1975", a Three.js (v0.160, vendored at ./vendor/three) browser FPS.
Set during the Angolan Civil War; tone is serious/respectful historical, NOT gratuitous.
Runs as static files; ES modules; import three via bare "three" and addons via "three/addons/...".

GOAL: Push VISUAL and GAMEPLAY quality as high as WebGL/Three.js realistically allows —
golden-hour Angolan savanna, cohesive art direction, photoreal-leaning-stylized, 60fps target.
This is NOT literal Call of Duty parity (impossible in a browser); it IS "best-in-class WebGL FPS".

HARD RULES:
- Edit ONLY the file(s) you are assigned. Do NOT touch main.js or any other module or index.html
  unless index.html is explicitly assigned to you.
- PRESERVE the exact public interface below (constructors, init(), update(dt), and named methods/props
  that other systems call). Breaking these breaks the whole game.
- Keep it performant: prefer InstancedMesh for repeated geometry, pooled objects, canvas-generated
  textures (albedo/normal/roughness) over external asset files (no network at runtime).
- Code must be syntactically valid ES module JS and self-contained. No new npm deps.
- Match the surrounding code style. Add brief comments where non-obvious.

SHARED GameContext (ctx) — available to every system:
  ctx.THREE, ctx.scene, ctx.camera, ctx.engine, ctx.input, ctx.player, ctx.weapons,
  ctx.enemies, ctx.level, ctx.environment, ctx.particles, ctx.audio, ctx.hud,
  ctx.elapsed (seconds), ctx.state, ctx.colliders (array of {box:THREE.Box3, mesh}),
  ctx.emit(type,detail), ctx.on(type,fn).
  Events in use: 'player-hit', 'player-died', 'weapon-changed', 'enemy-killed'.

CROSS-MODULE PUBLIC INTERFACE (do not break the ones outside your file):
  engine:      .scene .camera .renderer .render(dt) .onResize() ; init() async
  input:       .consumeLook()->{dx,dy} .isDown(code) .mouse{left,right,dx,dy} .requestLock() .exitLock() .onPause() .update(dt)
  player:      .position(Vec3) .yaw .pitch .velocity(Vec3) .bobOffset(Vec3) .health .maxHealth .takeDamage(amt,dir) .init() .update(dt)
  weapons:     .mag .reserve .reloading .ads(0..1) .spec.name .switchWeapon(k) .update(dt) ; init() async
  enemies:     .raycastHit(raycaster,damage)->({killed:bool}|null) .update(dt) ; init() async
  environment: .getHeight(x,z)->y .update(dt) ; init() async
  level:       .collidables(array of meshes for hitscan) .update(dt) ; init() async
  particles:   .spawnMuzzleSmoke(pos) .spawnImpact(pos,normal) .spawnBlood(pos) .init() .update(dt)
  audio:       .play(type,worldPos) .resume() .update(dt) ; init() async
  hud:         .showHitMarker(killed) .setObjective(text) .init() .update(dt)

WORKFLOW: First Read your assigned file(s) to see current code, then rewrite/extend for maximum quality.
Return your StructuredOutput when done.
`;

const OUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'summary', 'techniques', 'interfacePreserved'],
  properties: {
    file: { type: 'string' },
    summary: { type: 'string', description: 'What you changed and the visual/gameplay impact' },
    techniques: { type: 'array', items: { type: 'string' } },
    interfacePreserved: { type: 'boolean' },
    risk: { type: 'string', description: 'Any integration risk or empty' },
  },
};

const MODULES = [
  {
    key: 'environment', file: 'src/world/environment.js',
    brief: `Own the ATMOSPHERE. Elevate: sky (golden-hour African savanna, warm haze), sun with soft
    shadows, layered exponential + height fog for depth, and the terrain. Give the terrain a real
    PBR look via canvas-generated albedo+normal+roughness (cracked dry earth, patchy dry grass,
    reddish laterite soil variation blended by height/slope). Optionally add subtle sun-shaft mood
    via fog color and exposure (coordinate only within this file). Keep getHeight(x,z) working and
    keep the play corridor traversable. Consider instanced grass tufts across the terrain for life
    (perf-safe, culled/limited count).`,
  },
  {
    key: 'level', file: 'src/world/level.js',
    brief: `Own the SET DRESSING. Elevate colonial-era plantation/village structures (weathered plaster
    walls with canvas normal/roughness textures, corrugated rusted roofs, broken windows, wood beams),
    denser believable foliage (instanced palms/bushes), and combat cover (sandbag walls, oil drums,
    crates, a wrecked truck) with real materials. Build a readable combat corridor with flanking cover.
    Keep .collidables populated and push proper AABBs to ctx.colliders so the player can't walk through.`,
  },
  {
    key: 'weapon', file: 'src/weapons/weapon.js',
    brief: `Own WEAPON FEEL & VIEWMODEL. Build a detailed FN FAL-style rifle viewmodel (receiver, barrel,
    handguard, wood furniture with grain texture, magazine, front/rear sights, sling nub) with PBR
    metal/wood materials. Add procedural animations: idle sway, walk bob coupling, snappy recoil with
    recovery, reload animation (mag out/in, charging handle), and ADS that aligns the sights to screen
    center. Improve muzzle flash (additive textured sprite + light + smoke). Keep hitscan via
    ctx.enemies.raycastHit and interface (.mag .reserve .reloading .ads .spec.name .switchWeapon .update).`,
  },
  {
    key: 'enemies', file: 'src/enemies/ai.js',
    brief: `Own the OPPONENTS. Elevate enemy soldier models (segmented body: torso, head, arms, legs with
    fatigues material, webbing, rifle prop) and add a procedural walk/aim animation (leg/arm swing,
    aim pose). Improve AI: patrol paths, line-of-sight detection, taking cover, suppressive fire,
    strafing, reload pauses, and a death ragdoll-ish topple. Keep raycastHit(raycaster,damage) returning
    {killed} and calling into ctx.player.takeDamage / ctx.particles. Keep it performant for ~8-16 enemies.`,
  },
  {
    key: 'particles', file: 'src/fx/particles.js',
    brief: `Own FX. Elevate to rich textured particles: rolling muzzle/barrel smoke, dust plumes on impact
    with surface-tinted debris, sparks, blood mist + decals, bullet tracers, shell casing ejection,
    and lingering haze. Use pooled sprites/instanced quads, additive where appropriate, soft particles
    look. Preserve spawnMuzzleSmoke(pos), spawnImpact(pos,normal), spawnBlood(pos), init(), update(dt);
    you may ADD new spawn methods (e.g. spawnTracer, spawnCasing) — other modules will call them only if present.`,
  },
  {
    key: 'engine', file: 'src/core/engine.js',
    brief: `Own the RENDER PIPELINE. Tune renderer + post-processing for a cinematic filmic look: ACES tone
    mapping + exposure, quality shadows, SSAO for contact depth, restrained bloom on highlights, SMAA,
    plus ADD a final subtle color-grade / vignette / film-grain pass (implement as a small inline
    ShaderPass) for cohesive art direction. Keep .scene .camera .renderer .render(dt) .onResize() intact
    and keep 60fps headroom (guard expensive passes). Ensure resize keeps all passes sized correctly.`,
  },
  {
    key: 'controller', file: 'src/player/controller.js',
    brief: `Own PLAYER FEEL. Refine FPS movement to feel weighty and responsive: acceleration/friction,
    air control, sprint FOV coupling hook (via camera), smooth crouch, landing impact dip, subtle
    weapon-coupled camera sway, and refined head-bob. Improve collision robustness against ctx.colliders
    (no jitter/tunneling) and terrain following via ctx.environment.getHeight. Keep public props/methods:
    .position .yaw .pitch .velocity .bobOffset .health .maxHealth .takeDamage .init() .update(dt).`,
  },
  {
    key: 'audio', file: 'src/audio/audio.js',
    brief: `Own SOUND. Elevate procedural WebAudio: punchy layered rifle report (crack + body + tail +
    mechanical), distance-based low-pass + reverb tail for enemy fire, reload foley (mag, charging
    handle), footsteps tied to movement, bullet impacts, and a subtle ambient bed (wind, distant birds,
    faint conflict rumble). Add a lightweight convolver reverb (generated impulse). Preserve
    play(type,worldPos), resume(), init(), update(dt). It's fine to add new sound 'type's; callers pass
    a type string and ignore unknowns.`,
  },
  {
    key: 'hud', file: 'src/ui/hud.js', extra: 'index.html',
    brief: `Own the UI (you also OWN index.html — the only agent allowed to edit it). Elevate the HUD to a
    clean, modern, diegetic-military look: refined crosshair with dynamic spread, hitmarkers (incl.
    headshot/kill states), sleek health + stamina, ammo counter with low-ammo warning, compass strip,
    objective banner, damage direction indicators, kill feed, and a tasteful vignette/scanline overlay.
    Improve the start/pause/death overlays and loading. Keep it period-appropriate and restrained.
    Preserve HUD methods showHitMarker(killed), setObjective(text), init(), update(dt) and the element
    IDs that hud.js reads. You may add new elements/IDs freely.`,
  },
];

phase('Elevate');
log(`Elevating ${MODULES.length} subsystems in parallel (disjoint file ownership)...`);

const results = await parallel(MODULES.map((m) => () => {
  const files = m.extra ? `${m.file} AND ${m.extra}` : m.file;
  const prompt = `${CONTRACT}

YOUR ASSIGNMENT: ${m.key}
FILE(S) YOU OWN (edit ONLY these): ${files}

DIRECTIVE:
${m.brief}

Steps:
1. Read your assigned file(s) fully.
2. Rewrite/extend them to dramatically raise quality per the directive, honoring every HARD RULE
   and preserving the public interface exactly.
3. Save with the Write/Edit tools.
4. Return StructuredOutput describing your changes.`;
  return agent(prompt, { label: `elevate:${m.key}`, phase: 'Elevate', schema: OUT_SCHEMA });
}));

const done = results.filter(Boolean);
log(`Elevation complete: ${done.length}/${MODULES.length} subsystems returned.`);

// ---- Integrate & self-repair ----
phase('Integrate');
const integratePrompt = `You are the INTEGRATION & REPAIR engineer for the Kwanza Three.js FPS.
Nine agents just rewrote separate subsystem files in parallel. Your job: make sure the game still
BOOTS AND RENDERS with zero console errors.

Run the headless harness (it serves the game, boots it, screenshots, and prints console/page errors):
  node tools/shoot.mjs tools/wf_shot.png 6000

If it prints "ERRORS: 0", you are done — Read tools/wf_shot.png to confirm something rendered.
If there are errors:
  - Read the error text. Open the offending file(s). Fix ONLY genuine breakages (undefined vars,
    broken imports, interface violations, exceptions on boot). Do NOT redo anyone's art direction.
  - Common risks: an agent renamed/removed a public method another module calls, a bad import path,
    a texture/canvas call before DOM ready, an InstancedMesh count of 0, NaN geometry.
  - Re-run the harness. Repeat until "ERRORS: 0" and the screenshot clearly shows the 3D scene
    (not a blank/black frame, not the menu still up).
  - You MAY edit any file to repair integration, but keep fixes minimal and preserve each agent's intent.

Return StructuredOutput: booted (bool), errorsFixed (array of short strings), finalErrors (array),
sceneRendered (bool), notes (string).`;

const integ = await agent(integratePrompt, {
  label: 'integrate+repair', phase: 'Integrate',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['booted', 'errorsFixed', 'finalErrors', 'sceneRendered', 'notes'],
    properties: {
      booted: { type: 'boolean' },
      errorsFixed: { type: 'array', items: { type: 'string' } },
      finalErrors: { type: 'array', items: { type: 'string' } },
      sceneRendered: { type: 'boolean' },
      notes: { type: 'string' },
    },
  },
});

return { elevated: done, integration: integ };
