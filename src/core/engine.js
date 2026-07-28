// Rendering engine: renderer, scene, camera, and the cinematic post-processing pipeline.
// Owns the whole render path. Public surface (kept stable for the rest of the game):
//   .scene .camera .renderer .render(dt) .onResize() ; init() async
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// -----------------------------------------------------------------------------
// Final grade pass — inline ShaderPass. Runs LAST, in display (sRGB) space,
// after tone mapping. It stitches the frame into one cohesive golden-hour look:
//   * split-tone color grade (warm highlights, cool-teal shadows)
//   * gentle S-curve contrast + saturation lift
//   * cinematic vignette
//   * animated film grain (very restrained — texture, not noise)
// All effects are cheap (one fullscreen pass, no extra buffers).
// -----------------------------------------------------------------------------
const GradeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uVignette:   { value: 0.32 },   // vignette strength (0 = off)
    uGrain:      { value: 0.045 },  // film-grain amount
    uContrast:   { value: 1.06 },   // S-curve steepness
    uSaturation: { value: 1.08 },   // global saturation
    uWarmth:     { value: 0.05 },   // highlight warm / shadow cool split-tone
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uWarmth;
    varying vec2 vUv;

    // Hash-based grain — animated, tiled to screen so it reads like film emulsion.
    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // --- S-curve contrast around mid-grey (keeps blacks/whites from clipping) ---
      c = (c - 0.5) * uContrast + 0.5;

      // --- Split-tone: push highlights warm (amber) and shadows cool (teal) ---
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 warm = vec3(1.05, 1.0, 0.92);
      vec3 cool = vec3(0.94, 1.0, 1.06);
      vec3 tone = mix(cool, warm, smoothstep(0.15, 0.85, luma));
      c *= mix(vec3(1.0), tone, uWarmth * 4.0);

      // --- Saturation ---
      c = mix(vec3(luma), c, uSaturation);

      // --- Cinematic vignette (soft, radial, aspect-tolerant) ---
      vec2 v = vUv - 0.5;
      float vig = smoothstep(0.85, 0.25, length(v));
      c *= mix(1.0, vig, uVignette);

      // --- Film grain (luminance-weighted so shadows stay cleaner) ---
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 431.7) - 0.5;
      c += g * uGrain * (0.6 + 0.4 * (1.0 - luma));

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    // Adaptive-quality state: an EMA of frame time drives a coarse quality guard
    // so the heavy passes (SSAO) can bow out if we ever fall under budget.
    this._emaDt = 1 / 60;
    this._qualityLow = false;
    this._guardCooldown = 0;
  }

  async init() {
    const w = window.innerWidth, h = window.innerHeight;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,            // handled by SMAA in the composer
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setPixelRatio(this._dpr);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // ACES filmic tone mapping is applied by OutputPass (it reads these two).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(75, w / h, 0.05, 1200);
    this.camera.position.set(0, 1.7, 0);
    this.scene.add(this.camera);

    this._setupComposer(w, h);
  }

  _setupComposer(w, h) {
    // HDR render target so bloom and tone mapping have real headroom above 1.0.
    const renderTarget = new THREE.WebGLRenderTarget(
      w * this._dpr, h * this._dpr,
      { type: THREE.HalfFloatType, samples: 0 }
    );
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(this._dpr);
    this.composer.setSize(w, h);

    // 1. Scene ------------------------------------------------------------------
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    // 2. SSAO — contact shadows / ambient occlusion for grounded depth ----------
    this.ssao = new SSAOPass(this.scene, this.camera, w, h);
    this.ssao.kernelRadius = 0.7;
    this.ssao.minDistance = 0.0018;
    this.ssao.maxDistance = 0.08;
    this.composer.addPass(this.ssao);

    // 3. Bloom — restrained, only genuine highlights (sun glints, muzzle) bleed --
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.30, 0.65, 0.88);
    this.composer.addPass(this.bloom);

    // 4. Output — ACES tone map (HDR -> LDR) + sRGB conversion ------------------
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // 5. SMAA — edge AA in display space (cleaner than in linear HDR) -----------
    this.smaa = new SMAAPass(w * this._dpr, h * this._dpr);
    this.composer.addPass(this.smaa);

    // 6. Final grade — color grade / vignette / film grain (see GradeShader) ----
    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);
  }

  // Coarse adaptive guard: if we sustain slow frames, drop the most expensive
  // pass (SSAO) to protect the 60fps target; restore it once we have headroom.
  _updateQualityGuard(dt) {
    // Clamp pathological dt (tab switches, first frame) so the EMA stays sane.
    const clamped = Math.min(Math.max(dt, 1 / 240), 1 / 15);
    this._emaDt += (clamped - this._emaDt) * 0.05;
    this._guardCooldown -= dt;
    if (this._guardCooldown > 0) return;

    const fps = 1 / this._emaDt;
    if (!this._qualityLow && fps < 48) {
      // Sustained below budget — shed SSAO and soften bloom.
      this._qualityLow = true;
      if (this.ssao) this.ssao.enabled = false;
      if (this.bloom) this.bloom.strength = 0.22;
      this._guardCooldown = 2.0;
    } else if (this._qualityLow && fps > 58) {
      // Comfortable headroom regained — restore full quality.
      this._qualityLow = false;
      if (this.ssao) this.ssao.enabled = true;
      if (this.bloom) this.bloom.strength = 0.30;
      this._guardCooldown = 2.0;
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this._dpr);
    this.renderer.setSize(w, h);
    // Composer resizes RenderPass, SSAO, bloom, SMAA and the grade pass together.
    this.composer.setPixelRatio(this._dpr);
    this.composer.setSize(w, h);
    if (this.ssao) this.ssao.setSize(w, h);
    if (this.smaa) this.smaa.setSize(w * this._dpr, h * this._dpr);
  }

  render(dt) {
    this._updateQualityGuard(dt);
    // Advance grain animation (wrapped to keep the uniform's precision high).
    if (this.gradePass) {
      this.gradePass.uniforms.uTime.value = (this.gradePass.uniforms.uTime.value + dt) % 1000;
    }
    this.composer.render(dt);
  }
}
