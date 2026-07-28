export const meta = {
  name: 'kwanza-critic-fix',
  description: 'Harsh art-director critic grades gameplay screenshots, assigns prioritized defects to files, then per-file fix agents repair them; integrate & self-verify',
  phases: [
    { title: 'Critique', detail: 'independent harsh critic reads pose screenshots' },
    { title: 'Fix', detail: 'one agent per defective file' },
    { title: 'Integrate', detail: 'boot headless, drive console errors to zero' },
  ],
};

// args: { images: string[], round: number }
const IMAGES = (args && args.images) || [];
const ROUND = (args && args.round) || 1;

const FILES = [
  'src/core/engine.js', 'src/world/environment.js', 'src/world/level.js',
  'src/weapons/weapon.js', 'src/enemies/ai.js', 'src/fx/particles.js',
  'src/player/controller.js', 'src/audio/audio.js', 'src/ui/hud.js', 'index.html',
];

const CRITIC_PROMPT = `You are a BRUTALLY HONEST AAA art director and technical director reviewing a browser
(Three.js/WebGL) first-person shooter, "Kwanza — Angola 1975" (golden-hour Angolan savanna, serious tone).
This is review round ${ROUND}.

You are given in-game screenshots from several poses (survey, advance, ADS, firing, near-enemy):
${IMAGES.map((p, i) => `  ${i + 1}. ${p}`).join('\n')}

READ every image with the Read tool and judge them like you're comparing against a modern military shooter.
Be harsh and SPECIFIC. Do NOT be encouraging. Your job is to find everything that looks amateur, wrong,
broken, flat, or cheap, and turn each into an actionable engineering fix.

Score these dimensions 0-10 (10 = genuinely AAA-for-WebGL):
  lighting, materials_textures, foliage_vegetation, weapon_viewmodel, characters_enemies,
  environment_readability, fx_particles, ui_hud, overall_cohesion.

Then produce a prioritized DEFECTS list. Each defect MUST include:
  - severity: "critical" | "major" | "minor"  (critical = looks broken/unshippable)
  - file: EXACTLY one of these owners: ${FILES.join(', ')}
  - area: short tag (e.g. "weapon lighting", "grass", "palm trees", "window interiors")
  - problem: what is wrong and why it looks bad (reference which pose image)
  - fix: concrete technical instruction the owning engineer can implement in that file

Known suspicions to verify (confirm or dismiss from the images, and add anything else you see):
  - the weapon viewmodel appears pure black / unlit (likely needs a camera-attached fill light or material tweak — weapon.js, or engine ambient)
  - instanced grass reads as flat vertical "cardboard sticks" (environment.js / level.js)
  - palm trees look claw-like / broken silhouettes (level.js)
  - broken windows are pure black voids with no interior (level.js)
  - overall exposure/backlight may wash out or crush contrast (engine.js grade / environment.js exposure)

Return StructuredOutput with scores and the full defects array (aim for the 8-16 highest-impact defects).`;

const CRITIC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scores', 'verdict', 'defects'],
  properties: {
    scores: {
      type: 'object', additionalProperties: false,
      required: ['lighting', 'materials_textures', 'foliage_vegetation', 'weapon_viewmodel', 'characters_enemies', 'environment_readability', 'fx_particles', 'ui_hud', 'overall_cohesion'],
      properties: Object.fromEntries(['lighting', 'materials_textures', 'foliage_vegetation', 'weapon_viewmodel', 'characters_enemies', 'environment_readability', 'fx_particles', 'ui_hud', 'overall_cohesion'].map((k) => [k, { type: 'number' }])),
    },
    verdict: { type: 'string', description: 'One-paragraph harsh overall verdict' },
    defects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['severity', 'file', 'area', 'problem', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          file: { type: 'string' },
          area: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
};

phase('Critique');
const critique = await agent(CRITIC_PROMPT, { label: `critic:round${ROUND}`, phase: 'Critique', schema: CRITIC_SCHEMA, effort: 'high' });

if (!critique || !critique.defects) { return { error: 'critic returned nothing', critique }; }

const avg = Object.values(critique.scores).reduce((a, b) => a + b, 0) / Object.keys(critique.scores).length;
log(`Round ${ROUND} critic avg score: ${avg.toFixed(1)}/10. ${critique.defects.length} defects.`);

// Group defects by owning file (ignore unknown files).
const byFile = {};
for (const d of critique.defects) {
  if (!FILES.includes(d.file)) continue;
  (byFile[d.file] ||= []).push(d);
}
const targets = Object.keys(byFile);
log(`Dispatching ${targets.length} fix agents for: ${targets.join(', ')}`);

const CONTRACT_TAIL = `
HARD RULES: Edit ONLY your assigned file. Preserve the public interface other systems rely on
(constructors, init(), update(dt), and named methods/props). No new npm deps; no runtime network —
generate textures via canvas. Prefer InstancedMesh/pooling for perf (target 60fps on real GPUs).
Keep the serious golden-hour Angolan-savanna art direction cohesive. Read your file first, then fix.
This is a browser Three.js FPS; be pragmatic — implement the fix well, don't gold-plate.`;

phase('Fix');
const fixes = await parallel(targets.map((file) => () => {
  const list = byFile[file].map((d, i) => `  [${d.severity.toUpperCase()}] (${d.area}) ${d.problem}\n     FIX: ${d.fix}`).join('\n');
  const prompt = `You are the engineer who owns ${file} in the Kwanza Three.js FPS.
A harsh art director flagged these defects in YOUR file from round ${ROUND} gameplay screenshots:

${list}

You may also Read these screenshots to see the problems yourself: ${IMAGES.join(', ')}

Implement fixes for every defect above, at high quality.
${CONTRACT_TAIL}

Return StructuredOutput.`;
  return agent(prompt, {
    label: `fix:${file.split('/').pop()}`, phase: 'Fix', effort: 'high',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['file', 'fixed', 'summary', 'interfacePreserved'],
      properties: {
        file: { type: 'string' },
        fixed: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        interfacePreserved: { type: 'boolean' },
      },
    },
  });
}));

phase('Integrate');
const integ = await agent(`Integration & repair for the Kwanza Three.js FPS after parallel per-file fixes.
Run: node tools/shoot.mjs tools/wf_shot.png 8000
If "ERRORS: 0", Read tools/wf_shot.png to confirm the 3D scene renders (not blank/black/menu). Done.
If there are errors or a blank frame, open the offending file(s), fix ONLY genuine breakages
(undefined vars, bad imports, interface violations, exceptions, NaN geometry, 0-count instances),
re-run, and repeat until ERRORS: 0 and the scene renders. Keep fixes minimal; preserve each fix's intent.
Return StructuredOutput.`, {
    label: `integrate:round${ROUND}`, phase: 'Integrate', effort: 'high',
    schema: {
      type: 'object', additionalProperties: false,
      required: ['booted', 'sceneRendered', 'errorsFixed', 'finalErrors', 'notes'],
      properties: {
        booted: { type: 'boolean' }, sceneRendered: { type: 'boolean' },
        errorsFixed: { type: 'array', items: { type: 'string' } },
        finalErrors: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    },
  });

return { round: ROUND, avgScore: avg, scores: critique.scores, verdict: critique.verdict, defectCount: critique.defects.length, fixes: fixes.filter(Boolean), integration: integ };
