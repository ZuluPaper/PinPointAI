// Level: props, cover, structures forming an Angolan plantation/village corridor.
import * as THREE from 'three';

export class Level {
  constructor(ctx) {
    this.ctx = ctx;
    this.collidables = []; // meshes for hitscan raycasts
  }

  async init() {
    this._mats = {
      wall: new THREE.MeshStandardMaterial({ color: 0xb8a077, roughness: 0.95 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x53381f, roughness: 0.85 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x6e4a34, roughness: 0.8, metalness: 0.3 }),
      sand: new THREE.MeshStandardMaterial({ color: 0x9c8a55, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0x3d5230, roughness: 0.9 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.95 }),
    };

    this._buildStructures();
    this._buildFoliage();
    this._buildCover();
  }

  _addCollider(mesh) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    this.ctx.colliders.push({ box, mesh });
    this.collidables.push(mesh);
  }

  _colonialHouse(x, z, rot = 0) {
    const g = new THREE.Group();
    const h = this.ctx.environment.getHeight(x, z);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 6), this._mats.wall);
    walls.position.y = 2;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 2.4, 4), this._mats.rust);
    roof.position.y = 5.2; roof.rotation.y = Math.PI / 4;
    g.add(walls, roof);
    g.position.set(x, h, z); g.rotation.y = rot;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.ctx.scene.add(g);
    this._addCollider(walls);
    return g;
  }

  _buildStructures() {
    this._colonialHouse(-16, -20, 0.3);
    this._colonialHouse(15, -42, -0.4);
    this._colonialHouse(-22, -72, 0.1);
    this._colonialHouse(24, -95, -0.2);

    // a low perimeter wall segment near spawn
    for (let i = 0; i < 6; i++) {
      const wx = -10 + i * 4;
      const h = this.ctx.environment.getHeight(wx, -8);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.2, 0.4), this._mats.wall);
      seg.position.set(wx, h + 0.6, -8);
      seg.castShadow = true; seg.receiveShadow = true;
      this.ctx.scene.add(seg);
      this._addCollider(seg);
    }
  }

  _tree(x, z, scale = 1) {
    const g = new THREE.Group();
    const h = this.ctx.environment.getHeight(x, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * scale, 0.4 * scale, 6 * scale, 7), this._mats.trunk);
    trunk.position.y = 3 * scale;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6 * scale, 8, 6), this._mats.leaf);
    canopy.position.y = 6.5 * scale; canopy.scale.y = 0.7;
    g.add(trunk, canopy);
    g.position.set(x, h, z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.ctx.scene.add(g);
    this._addCollider(trunk);
  }

  _buildFoliage() {
    // scattered trees along the corridor edges
    const rng = (seed) => { const n = Math.sin(seed * 12.9898) * 43758.5453; return n - Math.floor(n); };
    for (let i = 0; i < 40; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -10 - i * 3 - rng(i) * 4;
      const x = side * (14 + rng(i * 3) * 20);
      this._tree(x, z, 0.8 + rng(i * 7) * 0.7);
    }
  }

  _buildCover() {
    // crates & sandbags as combat cover
    for (let i = 0; i < 14; i++) {
      const rng = (s) => { const n = Math.sin(s * 78.233) * 43758.5; return n - Math.floor(n); };
      const z = -18 - i * 7;
      const x = (rng(i) - 0.5) * 22;
      const h = this.ctx.environment.getHeight(x, z);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), this._mats.wood);
      crate.position.set(x, h + 0.6, z);
      crate.rotation.y = rng(i * 2) * Math.PI;
      crate.castShadow = true; crate.receiveShadow = true;
      this.ctx.scene.add(crate);
      this._addCollider(crate);
    }
  }

  update(dt) {}
}
