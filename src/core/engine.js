// Rendering engine: renderer, scene, camera, post-processing pipeline.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class Engine {
  constructor(ctx) { this.ctx = ctx; }

  async init() {
    const w = window.innerWidth, h = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.ssao = new SSAOPass(this.scene, this.camera, w, h);
    this.ssao.kernelRadius = 0.7;
    this.ssao.minDistance = 0.002;
    this.ssao.maxDistance = 0.09;
    this.composer.addPass(this.ssao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.55, 0.85);
    this.composer.addPass(this.bloom);

    this.smaa = new SMAAPass(w, h);
    this.composer.addPass(this.smaa);

    this.composer.addPass(new OutputPass());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
