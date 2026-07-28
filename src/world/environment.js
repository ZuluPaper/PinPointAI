// Environment: sky, sun, atmospheric lighting, fog, terrain heightfield.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class Environment {
  constructor(ctx) { this.ctx = ctx; this._noiseSeed = 1337; }

  async init() {
    const scene = this.ctx.scene;

    // --- lighting: warm late-afternoon African savanna ---
    this.hemi = new THREE.HemisphereLight(0xbfd4e0, 0x6b5a3a, 0.55);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe6b8, 2.4);
    this.sun.position.set(60, 80, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    const s = 90;
    this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // --- sky ---
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.8;
    const phi = THREE.MathUtils.degToRad(90 - 28);
    const theta = THREE.MathUtils.degToRad(50);
    const sunPos = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunPos);
    scene.add(this.sky);

    // --- fog: dusty heat haze ---
    scene.fog = new THREE.FogExp2(0xc9b48a, 0.0045);

    this._buildTerrain();
  }

  _hash(x, z) {
    let n = Math.sin(x * 127.1 + z * 311.7 + this._noiseSeed) * 43758.5453;
    return n - Math.floor(n);
  }

  _noise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    const a = this._hash(xi, zi), b = this._hash(xi + 1, zi);
    const c = this._hash(xi, zi + 1), d = this._hash(xi + 1, zi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  getHeight(x, z) {
    // gentle rolling terrain; keep the play corridor fairly flat
    const h = this._noise(x * 0.015, z * 0.015) * 6 + this._noise(x * 0.06, z * 0.06) * 1.2;
    const corridor = Math.exp(-(x * x) / 900); // flatten near center path
    return h * (1 - corridor * 0.7) - 2;
  }

  _buildTerrain() {
    const size = 500, seg = 200;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.getHeight(x, z));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x8a7b4a, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.ctx.scene.add(ground);
    this.ground = ground;
    this.ctx.level && this.ctx.level.collidables?.push(ground);
  }

  update(dt) {}
}
