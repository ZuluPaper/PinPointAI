// Level: set dressing for an Angolan colonial plantation/village combat corridor.
// Weathered plaster structures, rusted corrugated roofs, broken windows, wood
// beams; instanced palms/bushes/grass; combat cover (sandbags, oil drums,
// crates, a wrecked truck). All materials use canvas-generated albedo/normal/
// roughness maps so nothing is fetched at runtime. Colliders are pushed as
// AABBs into ctx.colliders; hitscan meshes are kept in .collidables.
import * as THREE from 'three';

export class Level {
  constructor(ctx) {
    this.ctx = ctx;
    this.collidables = []; // meshes for hitscan raycasts
    this._anim = [];       // objects with subtle idle motion (e.g. hanging cloth)
  }

  async init() {
    this._maxAniso = this.ctx.engine?.renderer?.capabilities?.getMaxAnisotropy?.() || 1;
    this._buildMaterials();
    this._buildGroundDetail();
    this._buildStructures();
    this._buildFoliage();
    this._buildCover();
  }

  // ---------------------------------------------------------------------------
  // Canvas texture toolkit
  // ---------------------------------------------------------------------------
  _canvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return { c, g: c.getContext('2d') };
  }

  _finishTex(canvas, { repeat = 1, srgb = false } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = this._maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  // Convert a grayscale height canvas into a tangent-space normal map (Sobel).
  _normalFromHeight(heightCanvas, strength = 1.6, repeat = 1) {
    const s = heightCanvas.width;
    const src = heightCanvas.getContext('2d').getImageData(0, 0, s, s).data;
    const { c, g } = this._canvas(s);
    const out = g.createImageData(s, s);
    const H = (x, y) => {
      const xi = (x + s) % s, yi = (y + s) % s;
      return src[(yi * s + xi) * 4] / 255;
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        let nx = -dx, ny = -dy, nz = 1;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv; ny *= inv; nz *= inv;
        const i = (y * s + x) * 4;
        out.data[i] = (nx * 0.5 + 0.5) * 255;
        out.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        out.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        out.data[i + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    return this._finishTex(c, { repeat });
  }

  _valueNoise(g, size, cells, alpha, color) {
    // Soft blotchy value noise for stains/weathering.
    const step = size / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const v = Math.random();
        if (v > 0.55) {
          g.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${(v - 0.55) * alpha})`;
          g.beginPath();
          g.arc((x + Math.random()) * step, (y + Math.random()) * step,
            step * (0.6 + Math.random()), 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  // --- Weathered colonial plaster -------------------------------------------
  _plasterMaterial() {
    const S = 512;
    // albedo
    const { c: ac, g: ag } = this._canvas(S);
    ag.fillStyle = '#c9b184'; ag.fillRect(0, 0, S, S);
    // broad tonal variation
    for (let i = 0; i < 40; i++) {
      ag.fillStyle = `rgba(${150 + Math.random() * 40 | 0},${130 + Math.random() * 40 | 0},${90 + Math.random() * 30 | 0},0.12)`;
      ag.beginPath();
      ag.ellipse(Math.random() * S, Math.random() * S, 40 + Math.random() * 90, 30 + Math.random() * 70, Math.random() * 6, 0, Math.PI * 2);
      ag.fill();
    }
    // damp / mildew streaks running down from the top
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * S;
      const w = 3 + Math.random() * 10;
      const h = 60 + Math.random() * 260;
      const grad = ag.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(60,55,40,0.28)');
      grad.addColorStop(1, 'rgba(60,55,40,0)');
      ag.fillStyle = grad;
      ag.fillRect(x, 0, w, h);
    }
    // exposed brick where plaster spalled off
    for (let i = 0; i < 5; i++) {
      const px = Math.random() * S, py = Math.random() * S;
      const pw = 40 + Math.random() * 70, ph = 30 + Math.random() * 60;
      ag.fillStyle = '#8a5237';
      ag.fillRect(px, py, pw, ph);
      ag.fillStyle = 'rgba(40,20,15,0.5)';
      for (let by = py; by < py + ph; by += 9) {
        ag.fillRect(px, by, pw, 1.5);
        for (let bx = px + (Math.random() * 8); bx < px + pw; bx += 20) ag.fillRect(bx, by, 1.5, 9);
      }
    }
    this._valueNoise(ag, S, 96, 0.5, [70, 60, 45]);

    // height map: plaster lumps + cracks + the spall patches
    const { c: hc, g: hg } = this._canvas(S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) {
      const v = 128 + (Math.random() - 0.5) * 44;
      hg.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      hg.beginPath();
      hg.arc(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 0, Math.PI * 2);
      hg.fill();
    }
    // cracks (dark, recessed)
    hg.strokeStyle = '#404040'; hg.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      hg.beginPath();
      let x = Math.random() * S, y = Math.random() * S;
      hg.moveTo(x, y);
      for (let s2 = 0; s2 < 10; s2++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; hg.lineTo(x, y); }
      hg.stroke();
    }

    const map = this._finishTex(ac, { srgb: true });
    const normalMap = this._normalFromHeight(hc, 2.0);
    const mat = new THREE.MeshStandardMaterial({
      map, normalMap, roughness: 0.96, metalness: 0.0,
      normalScale: new THREE.Vector2(1.1, 1.1),
    });
    return mat;
  }

  // --- Rusted corrugated metal roofing --------------------------------------
  _corrugatedMaterial() {
    const S = 512;
    const { c: ac, g: ag } = this._canvas(S);
    // base galvanised grey with the ridge shading baked lightly into albedo
    for (let x = 0; x < S; x++) {
      const rib = 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 2 * 22);
      const v = 90 + rib * 55;
      ag.fillStyle = `rgb(${v | 0},${(v * 0.96) | 0},${(v * 0.9) | 0})`;
      ag.fillRect(x, 0, 1, S);
    }
    // heavy rust blooms
    for (let i = 0; i < 220; i++) {
      const r = 8 + Math.random() * 40;
      const x = Math.random() * S, y = Math.random() * S;
      const grad = ag.createRadialGradient(x, y, 0, x, y, r);
      const c1 = `rgba(${120 + Math.random() * 50 | 0},${50 + Math.random() * 30 | 0},${25 + Math.random() * 20 | 0},0.5)`;
      grad.addColorStop(0, c1);
      grad.addColorStop(1, 'rgba(120,50,25,0)');
      ag.fillStyle = grad;
      ag.beginPath(); ag.arc(x, y, r, 0, Math.PI * 2); ag.fill();
    }
    // streaking runoff
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * S;
      const grad = ag.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, 'rgba(90,40,20,0.25)');
      grad.addColorStop(1, 'rgba(90,40,20,0)');
      ag.fillStyle = grad;
      ag.fillRect(x, 0, 2 + Math.random() * 4, S);
    }

    // height: strong sinusoidal ribs + bolt dimples
    const { c: hc, g: hg } = this._canvas(S);
    for (let x = 0; x < S; x++) {
      const v = 128 + Math.sin((x / S) * Math.PI * 2 * 22) * 110;
      hg.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      hg.fillRect(x, 0, 1, S);
    }
    for (let i = 0; i < 60; i++) {
      hg.fillStyle = 'rgba(30,30,30,0.9)';
      hg.beginPath(); hg.arc(Math.random() * S, Math.random() * S, 3, 0, Math.PI * 2); hg.fill();
    }

    const map = this._finishTex(ac, { repeat: 3, srgb: true });
    const normalMap = this._normalFromHeight(hc, 3.0, 3);
    // roughness: rusty patches rougher than bare metal
    const { c: rc, g: rg } = this._canvas(256);
    rg.fillStyle = '#7a7a7a'; rg.fillRect(0, 0, 256, 256);
    this._valueNoise(rg, 256, 40, 1.2, [230, 230, 230]);
    const roughnessMap = this._finishTex(rc, { repeat: 3 });
    return new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap, metalness: 0.55, roughness: 0.85,
      normalScale: new THREE.Vector2(1.4, 1.4),
    });
  }

  // --- Weathered wood (beams, crates, truck bed) ----------------------------
  _woodMaterial(repeat = 1) {
    const S = 256;
    const { c: ac, g: ag } = this._canvas(S);
    ag.fillStyle = '#6a4a2a'; ag.fillRect(0, 0, S, S);
    // plank seams + grain
    for (let py = 0; py < S; py += 32) {
      ag.fillStyle = 'rgba(20,12,6,0.6)'; ag.fillRect(0, py, S, 2);
      const tone = 70 + Math.random() * 40;
      ag.fillStyle = `rgba(${tone | 0},${(tone * 0.65) | 0},${(tone * 0.4) | 0},0.25)`;
      ag.fillRect(0, py, S, 32);
    }
    ag.strokeStyle = 'rgba(30,18,8,0.4)'; ag.lineWidth = 1;
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * S;
      ag.beginPath(); ag.moveTo(0, y);
      for (let x = 0; x < S; x += 16) ag.lineTo(x, y + (Math.random() - 0.5) * 4);
      ag.stroke();
    }
    this._valueNoise(ag, S, 40, 0.5, [30, 20, 10]);

    const { c: hc, g: hg } = this._canvas(S);
    hg.fillStyle = '#888'; hg.fillRect(0, 0, S, S);
    for (let py = 0; py < S; py += 32) { hg.fillStyle = '#303030'; hg.fillRect(0, py, S, 2); }
    for (let i = 0; i < 400; i++) {
      const v = 128 + (Math.random() - 0.5) * 40;
      hg.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      hg.fillRect(Math.random() * S, Math.random() * S, 1, 8 + Math.random() * 24);
    }
    const map = this._finishTex(ac, { repeat, srgb: true });
    const normalMap = this._normalFromHeight(hc, 1.4, repeat);
    return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.9, metalness: 0.0 });
  }

  // --- Sandbag burlap --------------------------------------------------------
  _sandbagMaterial() {
    const S = 128;
    const { c: ac, g: ag } = this._canvas(S);
    ag.fillStyle = '#8a7748'; ag.fillRect(0, 0, S, S);
    // burlap weave
    for (let i = 0; i < S; i += 3) {
      ag.fillStyle = 'rgba(60,50,25,0.25)'; ag.fillRect(i, 0, 1, S); ag.fillRect(0, i, S, 1);
    }
    this._valueNoise(ag, S, 30, 0.6, [110, 95, 60]);
    this._valueNoise(ag, S, 20, 0.5, [50, 40, 20]);
    const { c: hc, g: hg } = this._canvas(S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (let i = 0; i < S; i += 3) { hg.fillStyle = '#606060'; hg.fillRect(i, 0, 1, S); hg.fillStyle = '#a0a0a0'; hg.fillRect(0, i, S, 1); }
    const map = this._finishTex(ac, { srgb: true });
    const normalMap = this._normalFromHeight(hc, 1.2);
    return new THREE.MeshStandardMaterial({ map, normalMap, roughness: 1.0, metalness: 0.0 });
  }

  // --- Painted/rusted steel for drums & truck --------------------------------
  _drumMaterial(base = '#4a6a3f') {
    const S = 256;
    const { c: ac, g: ag } = this._canvas(S);
    ag.fillStyle = base; ag.fillRect(0, 0, S, S);
    // horizontal reinforcing rings baked as darker bands
    for (const ry of [0.28, 0.72]) {
      ag.fillStyle = 'rgba(0,0,0,0.25)'; ag.fillRect(0, ry * S - 5, S, 10);
    }
    // rust eating through the paint
    for (let i = 0; i < 160; i++) {
      const r = 4 + Math.random() * 22, x = Math.random() * S, y = Math.random() * S;
      const grad = ag.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${110 + Math.random() * 40 | 0},${45 + Math.random() * 25 | 0},20,${0.4 + Math.random() * 0.4})`);
      grad.addColorStop(1, 'rgba(110,45,20,0)');
      ag.fillStyle = grad; ag.beginPath(); ag.arc(x, y, r, 0, Math.PI * 2); ag.fill();
    }
    const { c: hc, g: hg } = this._canvas(S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (const ry of [0.28, 0.72]) { hg.fillStyle = '#c0c0c0'; hg.fillRect(0, ry * S - 4, S, 8); }
    const map = this._finishTex(ac, { srgb: true });
    const normalMap = this._normalFromHeight(hc, 1.6);
    const { c: rc, g: rg } = this._canvas(128);
    rg.fillStyle = '#4a4a4a'; rg.fillRect(0, 0, 128, 128);
    this._valueNoise(rg, 128, 30, 1.4, [220, 220, 220]);
    return new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap: this._finishTex(rc), metalness: 0.7, roughness: 0.6,
    });
  }

  _buildMaterials() {
    this._mats = {
      plaster: this._plasterMaterial(),
      roof: this._corrugatedMaterial(),
      wood: this._woodMaterial(1),
      beam: this._woodMaterial(2),
      sandbag: this._sandbagMaterial(),
      drumRust: this._drumMaterial('#7a3a24'),
      drumBlue: this._drumMaterial('#3a5468'),
      drumGreen: this._drumMaterial('#4a5a34'),
      truck: this._drumMaterial('#5b6247'),
      glass: new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.15, metalness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
      // foliage
      palmTrunk: new THREE.MeshStandardMaterial({ color: 0x6a5230, roughness: 0.95 }),
      frond: new THREE.MeshStandardMaterial({ color: 0x4d6a2e, roughness: 0.85, side: THREE.DoubleSide }),
      bush: new THREE.MeshStandardMaterial({ color: 0x40532a, roughness: 0.95 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x8f8a45, roughness: 1, side: THREE.DoubleSide }),
    };
  }

  // ---------------------------------------------------------------------------
  // Collider helpers
  // ---------------------------------------------------------------------------
  _addCollider(mesh) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    this.ctx.colliders.push({ box, mesh });
    this.collidables.push(mesh);
  }

  // Explicit AABB collider (for instanced clusters where per-object boxes matter).
  _addBoxCollider(cx, cy, cz, hx, hy, hz, mesh) {
    const box = new THREE.Box3(
      new THREE.Vector3(cx - hx, cy - hy, cz - hz),
      new THREE.Vector3(cx + hx, cy + hy, cz + hz),
    );
    this.ctx.colliders.push({ box, mesh: mesh || null });
  }

  _shadow(o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); }

  // ---------------------------------------------------------------------------
  // Ground detail: worn dirt path down the corridor + scattered debris decals
  // ---------------------------------------------------------------------------
  _buildGroundDetail() {
    // A dust road running down the fighting corridor, draped over the terrain.
    const len = 130, segs = 40, wSeg = 7;
    const geo = new THREE.PlaneGeometry(wSeg, len, 6, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const env = this.ctx.environment;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i) - 55; // shift so path spans ~ z:0..-110
      pos.setY(i, env.getHeight(x, z) + 0.04);
      pos.setZ(i, z);
    }
    geo.computeVertexNormals();
    const { c, g } = this._canvas(256);
    g.fillStyle = '#a08a56'; g.fillRect(0, 0, 256, 256);
    this._valueNoise(g, 256, 40, 0.7, [120, 100, 60]);
    this._valueNoise(g, 256, 24, 0.6, [70, 55, 35]);
    // wheel ruts
    g.fillStyle = 'rgba(60,45,28,0.4)'; g.fillRect(70, 0, 14, 256); g.fillRect(172, 0, 14, 256);
    const map = this._finishTex(c, { repeat: 1, srgb: true });
    map.repeat.set(1, 8);
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 1 }));
    road.receiveShadow = true;
    road.renderOrder = 1; // draw over terrain to avoid z-fight
    road.material.polygonOffset = true; road.material.polygonOffsetFactor = -1;
    this.ctx.scene.add(road);
  }

  // ---------------------------------------------------------------------------
  // Structures
  // ---------------------------------------------------------------------------
  _colonialHouse(x, z, rot = 0, w = 7, d = 6, hgt = 4) {
    const g = new THREE.Group();
    const baseY = this.ctx.environment.getHeight(x, z);

    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), this._mats.plaster);
    walls.position.y = hgt / 2;
    g.add(walls);

    // low stone plinth
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), this._mats.beam);
    plinth.position.y = 0.25;
    g.add(plinth);

    // corrugated roof: shallow hip made from two sloped panels
    const roofGroup = new THREE.Group();
    roofGroup.position.y = hgt;
    const panelGeo = new THREE.BoxGeometry(w + 1.2, 0.18, d * 0.75);
    const p1 = new THREE.Mesh(panelGeo, this._mats.roof);
    p1.position.set(0, 0.9, d * 0.28); p1.rotation.x = -0.42;
    const p2 = new THREE.Mesh(panelGeo, this._mats.roof);
    p2.position.set(0, 0.9, -d * 0.28); p2.rotation.x = 0.42;
    roofGroup.add(p1, p2);
    // ridge beam
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.18, 0.3), this._mats.beam);
    ridge.position.y = 1.28;
    roofGroup.add(ridge);
    g.add(roofGroup);

    // windows & door on the front (+z) face, recessed dark with broken glass
    const halfD = d / 2 + 0.01;
    const addWindow = (wx, wy, ww = 1.1, wh = 1.3) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.2, wh + 0.2, 0.15), this._mats.beam);
      frame.position.set(wx, wy, halfD);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh),
        Math.random() > 0.5 ? this._mats.dark : this._mats.glass);
      pane.position.set(wx, wy, halfD + 0.08);
      g.add(frame, pane);
    };
    addWindow(-w * 0.3, hgt * 0.6);
    addWindow(w * 0.3, hgt * 0.6);
    // doorway (dark opening)
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.2), this._mats.dark);
    door.position.set(0, 1.15, halfD);
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 0.16), this._mats.beam);
    doorFrame.position.set(0, 1.3, halfD - 0.02);
    g.add(doorFrame, door);

    // corner support beams
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, hgt, 0.3), this._mats.beam);
        beam.position.set(sx * (w / 2 - 0.15), hgt / 2, sz * (d / 2 - 0.15));
        g.add(beam);
      }
    }

    g.position.set(x, baseY, z);
    g.rotation.y = rot;
    this._shadow(g);
    this.ctx.scene.add(g);
    this._addCollider(walls);
    return g;
  }

  _buildStructures() {
    // Buildings frame both flanks of the corridor and create sightline breaks.
    this._colonialHouse(-17, -22, 0.35, 8, 6, 4.2);
    this._colonialHouse(16, -40, -0.45, 7, 6, 4);
    this._colonialHouse(-21, -62, 0.15, 9, 7, 4.6);
    this._colonialHouse(22, -84, -0.25, 7, 6, 4);
    this._colonialHouse(-15, -104, 0.2, 8, 6, 4.2);

    // Ruined plaster wall segments creating flanking cover near spawn.
    const wallRun = (sx, sz, ex, ez, count) => {
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const wx = sx + (ex - sx) * t, wz = sz + (ez - sz) * t;
        if (Math.random() < 0.22) continue; // gaps = ruined/breached
        const hh = 1.0 + Math.random() * 0.8;
        const h = this.ctx.environment.getHeight(wx, wz);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(3.4, hh, 0.5), this._mats.plaster);
        seg.position.set(wx, h + hh / 2, wz);
        seg.rotation.y = Math.atan2(ez - sz, ex - sx);
        this._shadow(seg);
        this.ctx.scene.add(seg);
        this._addCollider(seg);
      }
    };
    wallRun(-12, -9, 12, -9, 7);      // low wall across the mouth of the corridor
    wallRun(-9, -30, -9, -52, 6);     // left flank containment
    wallRun(10, -50, 10, -74, 6);     // right flank containment
  }

  // ---------------------------------------------------------------------------
  // Foliage: instanced palms, bushes and grass tufts
  // ---------------------------------------------------------------------------
  _rng(seed) {
    let s = seed * 9301 + 49297;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }

  _buildFoliage() {
    const env = this.ctx.environment;
    const rnd = this._rng(1975);

    // --- Palms: instanced trunk + instanced fronds ---
    const PALMS = 46;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 6, 6, 1);
    trunkGeo.translate(0, 3, 0);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, this._mats.palmTrunk, PALMS);
    // A curved frond blade
    const frondGeo = new THREE.PlaneGeometry(0.9, 3.4, 1, 4);
    {
      const p = frondGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setZ(i, -Math.pow((y + 1.7) / 3.4, 2) * 1.1); // droop
        p.setX(i, p.getX(i) * (1 - (y + 1.7) / 3.4 * 0.7)); // taper
      }
      frondGeo.computeVertexNormals();
    }
    const FRONDS_PER = 7;
    const frondMesh = new THREE.InstancedMesh(frondGeo, this._mats.frond, PALMS * FRONDS_PER);
    frondMesh.castShadow = true; trunkMesh.castShadow = true;
    frondMesh.receiveShadow = true; trunkMesh.receiveShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
      pos = new THREE.Vector3(), scl = new THREE.Vector3(), e = new THREE.Euler();
    let fi = 0;
    for (let i = 0; i < PALMS; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = -8 - (i * 2.6) - rnd() * 5;
      const x = side * (13 + rnd() * 22);
      const y = env.getHeight(x, z);
      const s = 0.85 + rnd() * 0.7;
      const lean = (rnd() - 0.5) * 0.18;
      const yaw = rnd() * Math.PI * 2;
      e.set(lean, yaw, lean * 0.5); q.setFromEuler(e);
      pos.set(x, y, z); scl.set(s, s, s);
      m.compose(pos, q, scl); trunkMesh.setMatrixAt(i, m);

      // crown of fronds
      const crownY = y + 6 * s;
      for (let f = 0; f < FRONDS_PER; f++) {
        const fyaw = yaw + (f / FRONDS_PER) * Math.PI * 2;
        const pitch = -0.5 - rnd() * 0.4;
        e.set(pitch, fyaw, 0); q.setFromEuler(e);
        pos.set(x + Math.sin(fyaw) * 0.2, crownY, z + Math.cos(fyaw) * 0.2);
        scl.set(s, s, s);
        m.compose(pos, q, scl); frondMesh.setMatrixAt(fi++, m);
      }
      // thin trunk collider so players cannot walk through palms
      this._addBoxCollider(x, y + 3 * s, z, 0.35 * s, 3 * s, 0.35 * s, trunkMesh);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    frondMesh.instanceMatrix.needsUpdate = true;
    this.ctx.scene.add(trunkMesh, frondMesh);
    this.collidables.push(trunkMesh); // hitscan can hit palm trunks

    // --- Bushes: instanced clustered icospheres (low cover / dressing) ---
    const BUSHES = 90;
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const bushMesh = new THREE.InstancedMesh(bushGeo, this._mats.bush, BUSHES);
    bushMesh.castShadow = true; bushMesh.receiveShadow = true;
    for (let i = 0; i < BUSHES; i++) {
      const z = -6 - rnd() * 116;
      const x = (rnd() - 0.5) * 70;
      const y = env.getHeight(x, z);
      const s = 0.6 + rnd() * 0.9;
      e.set(0, rnd() * Math.PI, 0); q.setFromEuler(e);
      pos.set(x, y + s * 0.5, z);
      scl.set(s * (1 + rnd() * 0.5), s * (0.7 + rnd() * 0.4), s * (1 + rnd() * 0.5));
      m.compose(pos, q, scl); bushMesh.setMatrixAt(i, m);
    }
    bushMesh.instanceMatrix.needsUpdate = true;
    this.ctx.scene.add(bushMesh);

    // --- Dry grass tufts: instanced crossed quads (dense ground cover) ---
    const GRASS = 520;
    const bladeGeo = new THREE.PlaneGeometry(0.7, 0.6, 1, 1);
    bladeGeo.translate(0, 0.3, 0);
    const grassMesh = new THREE.InstancedMesh(bladeGeo, this._mats.grass, GRASS);
    grassMesh.receiveShadow = true;
    for (let i = 0; i < GRASS; i++) {
      const z = -4 - rnd() * 120;
      const x = (rnd() - 0.5) * 64;
      const y = env.getHeight(x, z);
      const s = 0.7 + rnd() * 0.9;
      e.set(0, rnd() * Math.PI, 0); q.setFromEuler(e);
      pos.set(x, y, z); scl.set(s, s * (0.8 + rnd() * 0.6), s);
      m.compose(pos, q, scl); grassMesh.setMatrixAt(i, m);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    this.ctx.scene.add(grassMesh);
  }

  // ---------------------------------------------------------------------------
  // Combat cover
  // ---------------------------------------------------------------------------
  _crate(x, z, s = 1.2, rot = 0) {
    const h = this.ctx.environment.getHeight(x, z);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), this._mats.wood);
    crate.position.set(x, h + s / 2, z);
    crate.rotation.y = rot;
    this._shadow(crate);
    this.ctx.scene.add(crate);
    this._addCollider(crate);
    return crate;
  }

  _crateStack(x, z, rot) {
    // A readable waist/chest-high stack for cover.
    this._crate(x, z, 1.2, rot);
    this._crate(x + Math.cos(rot) * 1.25, z + Math.sin(rot) * 1.25, 1.2, rot + 0.1);
    const top = this._crate(x + Math.cos(rot) * 0.6, z + Math.sin(rot) * 0.6, 1.0, rot - 0.2);
    top.position.y += 1.2; // stacked on top
    top.updateMatrixWorld(true);
    // refresh that collider box to the raised position
    const c = this.ctx.colliders[this.ctx.colliders.length - 1];
    c.box.setFromObject(top);
  }

  _oilDrum(x, z, mat, tipped = false) {
    const h = this.ctx.environment.getHeight(x, z);
    const geo = new THREE.CylinderGeometry(0.45, 0.45, 1.2, 16);
    const drum = new THREE.Mesh(geo, mat);
    if (tipped) {
      drum.rotation.z = Math.PI / 2;
      drum.position.set(x, h + 0.45, z);
      drum.rotation.y = Math.random() * Math.PI;
    } else {
      drum.position.set(x, h + 0.6, z);
    }
    this._shadow(drum);
    this.ctx.scene.add(drum);
    this._addCollider(drum);
    return drum;
  }

  _sandbagWall(x, z, rot, length = 4, rows = 3) {
    // Instanced bags forming a defensive emplacement; one AABB per wall.
    const group = new THREE.Group();
    const bagGeo = new THREE.SphereGeometry(0.5, 8, 6);
    bagGeo.scale(1.0, 0.55, 0.7);
    const perRow = Math.max(2, Math.round(length / 0.85));
    const total = perRow * rows;
    const inst = new THREE.InstancedMesh(bagGeo, this._mats.sandbag, total);
    inst.castShadow = true; inst.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
      pos = new THREE.Vector3(), scl = new THREE.Vector3(), e = new THREE.Euler();
    const h = this.ctx.environment.getHeight(x, z);
    let idx = 0, maxY = 0;
    for (let r = 0; r < rows; r++) {
      const offset = (r % 2) * 0.42; // brick-lay the courses
      for (let b = 0; b < perRow; b++) {
        const along = (b - (perRow - 1) / 2) * 0.82 + offset;
        const by = 0.32 + r * 0.42;
        maxY = Math.max(maxY, by + 0.3);
        e.set(0, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.15); q.setFromEuler(e);
        pos.set(along, by, (Math.random() - 0.5) * 0.1);
        scl.set(1, 1, 1);
        m.compose(pos, q, scl); inst.setMatrixAt(idx++, m);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    group.position.set(x, h, z);
    group.rotation.y = rot;
    this.ctx.scene.add(group);
    this.collidables.push(inst);
    // AABB spanning the wall footprint (approx, in world space)
    const halfLen = (perRow * 0.82) / 2 + 0.4;
    const hx = Math.abs(Math.cos(rot)) * halfLen + Math.abs(Math.sin(rot)) * 0.5;
    const hz = Math.abs(Math.sin(rot)) * halfLen + Math.abs(Math.cos(rot)) * 0.5;
    this._addBoxCollider(x, h + maxY / 2, z, hx, maxY / 2, hz, inst);
  }

  _wreckedTruck(x, z, rot) {
    // Centerpiece hard cover mid-corridor: a burnt-out cargo truck.
    const g = new THREE.Group();
    const h = this.ctx.environment.getHeight(x, z);
    const M = this._mats.truck;

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 6.2), M);
    chassis.position.y = 1.0;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 1.8), M);
    cab.position.set(0, 1.9, 2.0);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 1.6), this._mats.roof);
    cabRoof.position.set(0, 2.7, 2.0);
    // shattered windscreen
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.9), this._mats.dark);
    glass.position.set(0, 2.1, 2.95); glass.rotation.x = -0.15;
    // cargo bed with wooden slat sides
    const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.15, 3.6), this._mats.beam);
    bedFloor.position.set(0, 1.3, -1.1);
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 3.6), this._mats.beam);
    sideL.position.set(-1.1, 1.8, -1.1);
    const sideR = sideL.clone(); sideR.position.x = 1.1;
    const backSlat = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 0.12), this._mats.beam);
    backSlat.position.set(0, 1.8, -2.9);
    g.add(chassis, cab, cabRoof, glass, bedFloor, sideL, sideR, backSlat);

    // wheels (one deflated / missing to sell the wreck)
    const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.4, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelPos = [[-1.1, 0.6, 2.0], [1.1, 0.6, 2.0], [-1.1, 0.6, -1.8], [1.1, 0.55, -1.8]];
    wheelPos.forEach((wp, i) => {
      if (i === 1) return; // missing front-right wheel
      const w = new THREE.Mesh(wheelGeo, this._mats.tyre);
      w.position.set(wp[0], wp[1], wp[2]);
      if (i === 3) w.scale.y = 0.7; // flat rear tyre
      g.add(w);
    });
    // truck tilts where the wheel is gone
    g.position.set(x, h, z);
    g.rotation.y = rot;
    g.rotation.z = 0.05;
    this._shadow(g);
    this.ctx.scene.add(g);
    // Two colliders: cab block and bed block, for reliable cover.
    this._addCollider(cab);
    this._addCollider(bedFloor);
    this._addCollider(chassis);
  }

  _buildCover() {
    // --- Sandbag emplacements: staggered flanking cover down the corridor ---
    this._sandbagWall(-6, -16, 0.1, 4.5, 3);
    this._sandbagWall(7, -34, -1.2, 4, 3);
    this._sandbagWall(-8, -55, 1.4, 5, 3);
    this._sandbagWall(6, -78, -0.3, 4, 3);
    this._sandbagWall(-5, -98, 0.4, 4.5, 3);

    // --- Wrecked truck: the mid-corridor centerpiece ---
    this._wreckedTruck(2, -48, 0.6);

    // --- Oil drum clusters (some tipped) ---
    const drumMats = [this._mats.drumRust, this._mats.drumBlue, this._mats.drumGreen];
    const drumSpots = [
      [-4, -24], [-2.6, -25.2], [8, -46], [9.2, -47], [-9, -70], [4, -66], [-3, -90], [10, -100],
    ];
    drumSpots.forEach((d, i) => this._oilDrum(d[0], d[1], drumMats[i % 3], i % 4 === 0));

    // --- Crate stacks as movable-looking hard cover ---
    this._crateStack(5, -20, 0.4);
    this._crateStack(-7, -42, -0.8);
    this._crateStack(9, -62, 1.1);
    this._crateStack(-4, -82, 0.2);
    this._crate(3, -12, 1.2, 0.5);
    this._crate(-6, -14, 1.0, -0.3);
    this._crate(7, -108, 1.2, 0.9);
  }

  update(dt) {}
}
