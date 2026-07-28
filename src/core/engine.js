// Rendering engine: renderer, scene, camera, and the cinematic post-processing pipeline.
// Owns the whole render path. Public surface (kept stable for the rest of the game):
//   .scene .camera .renderer .render(dt) .onResize() ; init() async
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// -----------------------------------------------------------------------------
// Final tone-map + grade pass — a single fullscreen ShaderPass that replaces the
// former OutputPass + separate grade pass (one fewer fullscreen pass = perf win).
//
// It takes the linear-HDR frame (post bloom) and, in ONE pass:
//   * applies exposure + ACES filmic tone mapping (HDR -> LDR)
//   * encodes to sRGB display space
//   * stitches the golden-hour look: split-tone grade (warm highlights,
//     cool-teal shadows), a *gentle* S-curve with a shadow lift so the
//     shadow side keeps detail, saturation, vignette, restrained film grain
//
// Doing the grade in display (sRGB) space keeps the S-curve centred on real
// mid-grey. toneMapped is forced off on the material so three doesn't double
// tone-map when this pass writes to the screen.
// -----------------------------------------------------------------------------
const ToneGradeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uExposure:   { value: 0.9 },    // ACES exposure (was 1.05 — was blowing the sky)
    uVignette:   { value: 0.30 },   // vignette strength (0 = off)
    uGrain:      { value: 0.04 },   // film-grain amount
    uContrast:   { value: 1.03 },   // S-curve steepness (softened from 1.06)
    uShadowLift: { value: 0.03 },   // raise shadow side so it doesn't crush to black
    uSaturation: { value: 1.06 },   // global saturation
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
    uniform float uExposure;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uContrast;
    uniform float uShadowLift;
    uniform float uSaturation;
    uniform float uWarmth;
    varying vec2 vUv;

    // Hash-based grain — animated, tiled to screen so it reads like film emulsion.
    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    // ACES filmic (Narkowicz fit) — matches the ACES look with far less cost than
    // the full matrix version, and rolls off highlights so the sky stops clipping.
    vec3 acesFilmic(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 c) {
      c = max(c, vec3(0.0));
      return mix(1.055 * pow(c, vec3(0.41666)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
    }

    void main() {
      // --- Exposure + ACES tone map (linear HDR -> display-referred 0..1) --------
      vec3 hdr = texture2D(tDiffuse, vUv).rgb * uExposure;
      vec3 c = acesFilmic(hdr);

      // --- Encode to sRGB so the grade below operates in display space ----------
      c = linearToSRGB(c);

      // --- Gentle S-curve contrast around mid-grey ------------------------------
      c = (c - 0.5) * uContrast + 0.5;

      // --- Shadow lift: rescue the shadow side the S-curve would otherwise crush -
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float shadowMask = 1.0 - smoothstep(0.0, 0.4, luma);
      c += uShadowLift * shadowMask;

      // --- Split-tone: push highlights warm (amber) and shadows cool (teal) ------
      luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      vec3 warm = vec3(1.05, 1.0, 0.92);
      vec3 cool = vec3(0.94, 1.0, 1.06);
      vec3 tone = mix(cool, warm, smoothstep(0.15, 0.85, luma));
      c *= mix(vec3(1.0), tone, uWarmth * 4.0);

      // --- Saturation -----------------------------------------------------------
      c = mix(vec3(luma), c, uSaturation);

      // --- Cinematic vignette (soft, radial, aspect-tolerant) -------------------
      vec2 v = vUv - 0.5;
      float vig = smoothstep(0.85, 0.25, length(v));
      c *= mix(1.0, vig, uVignette);

      // --- Film grain (luminance-weighted so shadows stay cleaner) --------------
      float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 431.7) - 0.5;
      c += g * uGrain * (0.6 + 0.4 * (1.0 - luma));

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export class Engine {
  constructor(ctx) {
    this.ctx = ctx;
    // Adaptive-quality state: an EMA of frame time drives a coarse quality guard.
    // It now reacts fast and hard — dropping internal resolution and softening
    // bloom well before the frame rate collapses.
    this._emaDt = 1 / 60;
    this._qualityLow = false;
    this._guardCooldown = 0;
    this._renderScale = 1;
    // Baseline bloom strength — restrained; guard halves it under load.
    this._bloomStrength = 0.16;
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
    // Tone mapping is done manually in the final ToneGrade pass, so the renderer
    // itself must NOT tone-map (that would double-apply on the screen write).
    // toneMappingExposure is still honoured — the pass reads it each frame.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 0.9;
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

    // 2. SSAO — grounded contact shadows, but OFF by default. At this DPR it is
    //    the single most expensive pass and the scene reads fine without it; the
    //    guard leaves it off. (Kept in the chain, disabled, so it costs nothing.)
    this.ssao = new SSAOPass(this.scene, this.camera, w, h);
    this.ssao.kernelRadius = 0.7;
    this.ssao.minDistance = 0.0018;
    this.ssao.maxDistance = 0.08;
    this.ssao.enabled = false;
    this.composer.addPass(this.ssao);

    // 3. Bloom — restrained. Threshold raised to 1.1 (HDR) so only genuine
    //    speculars / muzzle flash bloom, NOT the whole bright sky. Lower strength
    //    and radius kill the white haze halo across the horizon.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this._bloomStrength, 0.55, 1.1);
    this.composer.addPass(this.bloom);

    // 4. SMAA — edge AA (before the final tone-map/grade write). -----------------
    this.smaa = new SMAAPass(w * this._dpr, h * this._dpr);
    this.composer.addPass(this.smaa);

    // 5. Final tone-map + grade — exposure/ACES/sRGB + color grade in ONE pass.
    //    Writes to the screen, so force toneMapped off to avoid a double map.
    this.gradePass = new ShaderPass(ToneGradeShader);
    this.gradePass.material.toneMapped = false;
    this.composer.addPass(this.gradePass);
  }

  // Push the internal (composer) resolution up or down. The final screen write
  // stays full-res; only the heavy off-screen passes shrink — cheap dynamic-res.
  _applyRenderScale(s) {
    if (Math.abs(this._renderScale - s) < 0.001) return;
    this._renderScale = s;
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this._dpr * s;
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    if (this.ssao) this.ssao.setSize(w, h);
    if (this.smaa) this.smaa.setSize(w * pr, h * pr);
  }

  // Coarse adaptive guard. Reacts fast (aggressive EMA) and early (fps < 55, not
  // 48) so it engages well before the frame rate sinks to the ~20fps we were
  // seeing. Under load it drops internal resolution and softens bloom; it
  // restores only once there is real headroom.
  _updateQualityGuard(dt) {
    // Clamp pathological dt (tab switches, first frame) so the EMA stays sane.
    const clamped = Math.min(Math.max(dt, 1 / 240), 1 / 15);
    this._emaDt += (clamped - this._emaDt) * 0.1; // faster than before (was 0.05)
    this._guardCooldown -= dt;
    if (this._guardCooldown > 0) return;

    const fps = 1 / this._emaDt;
    if (!this._qualityLow && fps < 55) {
      // Slipping under budget — shed resolution and soften bloom immediately.
      this._qualityLow = true;
      if (this.bloom) this.bloom.strength = this._bloomStrength * 0.5;
      this._applyRenderScale(0.75);
      this._guardCooldown = 1.2;
    } else if (this._qualityLow && fps > 60) {
      // Comfortable headroom regained — restore full resolution / bloom.
      this._qualityLow = false;
      if (this.bloom) this.bloom.strength = this._bloomStrength;
      this._applyRenderScale(1.0);
      this._guardCooldown = 1.2;
    }
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this._dpr);
    this.renderer.setSize(w, h);
    // Honour the current dynamic-resolution scale when resizing the composer.
    const pr = this._dpr * this._renderScale;
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    if (this.ssao) this.ssao.setSize(w, h);
    if (this.smaa) this.smaa.setSize(w * pr, h * pr);
  }

  render(dt) {
    this._updateQualityGuard(dt);
    if (this.gradePass) {
      // Keep exposure in sync with the renderer setting so external tweaks apply.
      this.gradePass.uniforms.uExposure.value = this.renderer.toneMappingExposure;
      // Advance grain animation (wrapped to keep the uniform's precision high).
      this.gradePass.uniforms.uTime.value = (this.gradePass.uniforms.uTime.value + dt) % 1000;
    }
    this.composer.render(dt);
  }
}
