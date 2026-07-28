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
      // Shadowed room depth seen through window openings: dark warm brown, faintly lit.
      winInterior: new THREE.MeshStandardMaterial({
        color: 0x1c1206, emissive: 0x2a1a0c, emissiveIntensity: 0.35,
        roughness: 1, metalness: 0, side: THREE.DoubleSide,
      }),
      // foliage
      palmTrunk: this._palmTrunkMaterial(),
      frond: this._frondMaterial(),
      bush: new THREE.MeshStandardMaterial({ color: 0x40532a, roughness: 0.95 }),
      grass: this._grassMaterial(),
    };
  }

  // --- Palm bark: textured wood with leaf-scar rings & vertical ridges -------
  _palmTrunkMaterial() {
    const S = 256;
    const { c: ac, g: ag } = this._canvas(S);
    ag.fillStyle = '#6a5230'; ag.fillRect(0, 0, S, S);
    // vertical bark columns / value variation
    for (let x = 0; x < S; x++) {
      const n = 0.5 + 0.5 * Math.sin(x * 0.13) + (Math.random() - 0.5) * 0.35;
      const v = 0.65 + 0.35 * Math.max(0, Math.min(1, n));
      ag.fillStyle = `rgba(${(58 * v) | 0},${(44 * v) | 0},${(26 * v) | 0},0.4)`;
      ag.fillRect(x, 0, 1, S);
    }
    // horizontal leaf-scar rings (the diamond-banded palm look)
    for (let y = 4; y < S; y += 12 + Math.random() * 7) {
      ag.fillStyle = 'rgba(34,24,12,0.55)'; ag.fillRect(0, y, S, 2 + Math.random() * 2);
      ag.fillStyle = 'rgba(158,134,92,0.18)'; ag.fillRect(0, y - 2, S, 1);
    }
    this._valueNoise(ag, S, 40, 0.5, [38, 28, 15]);
    this._valueNoise(ag, S, 22, 0.4, [128, 106, 66]);

    // height map: ridges + recessed scar grooves
    const { c: hc, g: hg } = this._canvas(S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x++) {
      const v = 128 + Math.sin(x * 0.38) * 26 + (Math.random() - 0.5) * 22;
      hg.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      hg.fillRect(x, 0, 1, S);
    }
    for (let y = 4; y < S; y += 12 + Math.random() * 7) {
      hg.fillStyle = '#484848'; hg.fillRect(0, y, S, 3);
      hg.fillStyle = '#c0c0c0'; hg.fillRect(0, y - 2, S, 1);
    }
    const map = this._finishTex(ac, { srgb: true }); map.repeat.set(1, 2.2);
    const normalMap = this._normalFromHeight(hc, 1.8); normalMap.repeat.set(1, 2.2);
    return new THREE.MeshStandardMaterial({
      map, normalMap, roughness: 0.92, metalness: 0.0,
      normalScale: new THREE.Vector2(1.0, 1.0),
    });
  }

  // --- Palm frond: alpha-cut feathered leaf (pinnate leaflets on a rachis) ---
  _frondMaterial() {
    const W = 128, H = 512;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    // In UV space, tip is at top (y small), base at bottom (y large).
    const leafCol = (t) => { // t: 0 near tip .. 1 near base
      const r = 44 + (1 - t) * 26, gg = 74 + t * 46, b = 26 + t * 16;
      return `rgb(${r | 0},${gg | 0},${b | 0})`;
    };
    // central rachis (spine)
    g.strokeStyle = '#57692a'; g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, 10); g.lineTo(cx, H - 10); g.stroke();
    // leaflets fanning off both sides, longest mid-frond, sweeping toward tip
    const n = 58;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);            // 0 tip .. 1 base
      const y = 14 + t * (H - 28);
      const len = 8 + Math.sin(t * Math.PI) * (W * 0.46);
      const sweep = 26 * (1 - t) + 6;   // leaflets angle toward the tip
      g.strokeStyle = leafCol(t);
      g.lineWidth = 3;
      for (const dir of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx, y);
        g.quadraticCurveTo(cx + dir * len * 0.5, y - sweep * 0.4, cx + dir * len, y - sweep);
        g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this._maxAniso;
    tex.needsUpdate = true;
    // map's own alpha channel drives the cutout (alphaTest); no alphaMap needed.
    return new THREE.MeshStandardMaterial({
      map: tex, transparent: false, alphaTest: 0.4,
      side: THREE.DoubleSide, roughness: 0.82, metalness: 0.0,
    });
  }

  // --- Dry grass blade: alpha-cut pointed blade with a soft edge ------------
  _grassBladeTexture() {
    const W = 32, H = 64;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    // white blade shape (alpha only) — tapered, pointed tip at top
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(W * 0.5, 1);           // tip
    g.quadraticCurveTo(W * 0.9, H * 0.5, W * 0.72, H);  // right edge
    g.lineTo(W * 0.28, H);
    g.quadraticCurveTo(W * 0.1, H * 0.5, W * 0.5, 1);   // left edge
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = this._maxAniso;
    tex.needsUpdate = true;
    return tex;
  }

  _grassMaterial() {
    // Darkened base value + vertex-color gradient keeps backlit tufts from
    // glowing like paper slabs; alpha cutout removes hard rectangle edges.
    return new THREE.MeshStandardMaterial({
      color: 0x9a9250, vertexColors: true,
      alphaMap: this._grassBladeTexture(), transparent: false, alphaTest: 0.45,
      roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
    });
  }

  // Crossed-quad tapered grass tuft with a root→tip vertex-color gradient.
  _grassBladeGeometry() {
    const h = 0.62, wB = 0.11, wT = 0.02;
    const root = [0.16, 0.13, 0.05];   // dark shadowed root
    const tip = [0.78, 0.72, 0.34];    // pale gold tip
    const positions = [], colors = [], uvs = [], indices = [];
    let v = 0;
    const addBlade = (axis) => {
      // axis 0: blade spans X (faces ±Z); axis 1: blade spans Z (faces ±X)
      const corners = axis === 0
        ? [[-wB / 2, 0, 0], [wB / 2, 0, 0], [wT / 2, h, 0], [-wT / 2, h, 0]]
        : [[0, 0, -wB / 2], [0, 0, wB / 2], [0, h, wT / 2], [0, h, -wT / 2]];
      const uvC = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const colC = [root, root, tip, tip];
      for (let k = 0; k < 4; k++) {
        positions.push(corners[k][0], corners[k][1], corners[k][2]);
        colors.push(colC[k][0], colC[k][1], colC[k][2]);
        uvs.push(uvC[k][0], uvC[k][1]);
      }
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    };
    addBlade(0); addBlade(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // A jagged triangular glass shard (for broken window frames).
  _shardGeometry(w, h) {
    const geo = new THREE.BufferGeometry();
    const jx = (Math.random() - 0.5) * w * 0.5;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -w / 2, -h / 2, 0,
      w / 2, -h / 2 + (Math.random() - 0.5) * h * 0.3, 0,
      jx, h / 2, 0,
    ], 3));
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    return geo;
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

    // windows & door on the front (+z) face: recessed interior room shell so
    // the opening reads as depth into a solid volume, not a black billboard hole.
    const halfD = d / 2 + 0.01;
    const addWindow = (wx, wy, ww = 1.1, wh = 1.3) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.2, wh + 0.2, 0.18), this._mats.beam);
      frame.position.set(wx, wy, halfD);
      g.add(frame);

      // Shallow recessed interior: back wall + 4 sides, faintly-lit warm brown.
      const depth = 0.6 + Math.random() * 0.25;
      const zi = halfD - depth;               // interior back plane (into the wall)
      const wi = this._mats.winInterior;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), wi);
      back.position.set(wx, wy, zi);
      const sideGeo = new THREE.PlaneGeometry(depth, wh);
      const sL = new THREE.Mesh(sideGeo, wi);
      sL.rotation.y = Math.PI / 2; sL.position.set(wx - ww / 2, wy, halfD - depth / 2);
      const sR = new THREE.Mesh(sideGeo, wi);
      sR.rotation.y = -Math.PI / 2; sR.position.set(wx + ww / 2, wy, halfD - depth / 2);
      const capGeo = new THREE.PlaneGeometry(ww, depth);
      const cTop = new THREE.Mesh(capGeo, wi);
      cTop.rotation.x = Math.PI / 2; cTop.position.set(wx, wy + wh / 2, halfD - depth / 2);
      const cBot = new THREE.Mesh(capGeo, wi);
      cBot.rotation.x = -Math.PI / 2; cBot.position.set(wx, wy - wh / 2, halfD - depth / 2);
      g.add(back, sL, sR, cTop, cBot);

      if (Math.random() > 0.5) {
        // intact-ish grimy pane sitting in the frame
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), this._mats.glass);
        pane.position.set(wx, wy, halfD + 0.02);
        g.add(pane);
      } else {
        // broken window: a few jagged glass shard slivers clinging to the frame
        const nSh = 3 + (Math.random() * 3 | 0);
        for (let s = 0; s < nSh; s++) {
          const edge = s % 4; // top/bottom/left/right of the opening
          const sw = 0.12 + Math.random() * 0.18, sh = 0.18 + Math.random() * 0.4;
          const shard = new THREE.Mesh(this._shardGeometry(sw, sh), this._mats.glass);
          let sx = wx, sy = wy;
          if (edge === 0) { sy = wy + wh / 2 - sh / 2; sx = wx + (Math.random() - 0.5) * ww; }
          else if (edge === 1) { sy = wy - wh / 2 + sh / 2; sx = wx + (Math.random() - 0.5) * ww; }
          else if (edge === 2) { sx = wx - ww / 2 + sw / 2; sy = wy + (Math.random() - 0.5) * wh; }
          else { sx = wx + ww / 2 - sw / 2; sy = wy + (Math.random() - 0.5) * wh; }
          shard.position.set(sx, sy, halfD + 0.015);
          shard.rotation.z = (Math.random() - 0.5) * 0.9;
          g.add(shard);
        }
      }
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
    const TRUNK_H = 6.2;
    // Tapered trunk (wide base, narrow crown) with a gentle lean/curve baked in.
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.40, TRUNK_H, 8, 8);
    trunkGeo.translate(0, TRUNK_H / 2, 0);
    {
      const p = trunkGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / TRUNK_H;        // 0 base .. 1 crown
        p.setX(i, p.getX(i) + Math.pow(t, 1.6) * 0.9); // sweep the trunk over
      }
      trunkGeo.computeVertexNormals();
    }
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, this._mats.palmTrunk, PALMS);
    // A long, arched, drooping frond blade — base at origin, tip curling down.
    const FROND_L = 3.8;
    const frondGeo = new THREE.PlaneGeometry(0.9, FROND_L, 1, 8);
    frondGeo.translate(0, FROND_L / 2, 0); // pivot at the base (attaches to crown)
    {
      const p = frondGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / FROND_L;        // 0 base .. 1 tip
        p.setZ(i, -Math.pow(t, 2) * 1.7);     // arch: tip droops forward/down
        p.setX(i, p.getX(i) * (1.0 - t * 0.72)); // width taper toward the tip
      }
      frondGeo.computeVertexNormals();
    }
    const FRONDS_PER = 14;
    const frondMesh = new THREE.InstancedMesh(frondGeo, this._mats.frond, PALMS * FRONDS_PER);
    // Fronds don't cast shadow: alpha-cut quads would drop ugly solid rectangles.
    frondMesh.castShadow = false; trunkMesh.castShadow = true;
    frondMesh.receiveShadow = true; trunkMesh.receiveShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
      pos = new THREE.Vector3(), scl = new THREE.Vector3(), e = new THREE.Euler();
    const qYaw = new THREE.Quaternion(), qTilt = new THREE.Quaternion();
    const AX_Y = new THREE.Vector3(0, 1, 0), AX_X = new THREE.Vector3(1, 0, 0);
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

      // crown sits at the swept-over trunk top (curve pushed local +x by ~0.9)
      const sweep = 0.9 * s;
      const crownX = x + Math.cos(yaw) * sweep;
      const crownZ = z - Math.sin(yaw) * sweep;
      const crownY = y + TRUNK_H * s;
      for (let f = 0; f < FRONDS_PER; f++) {
        // Break radial-spoke symmetry with per-frond yaw jitter.
        const fyaw = yaw + (f / FRONDS_PER) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        // Vary elevation: ~half the fronds arch outward toward horizontal,
        // the rest rise up. tilt = angle from vertical (0 = straight up).
        const tier = f % 3;
        const tilt = tier === 0 ? 0.35 + rnd() * 0.3          // upright inner crown
          : tier === 1 ? 0.85 + rnd() * 0.35                   // mid spread
            : 1.25 + rnd() * 0.4;                              // outer, near-horizontal droop
        qYaw.setFromAxisAngle(AX_Y, fyaw);
        qTilt.setFromAxisAngle(AX_X, tilt);
        q.copy(qYaw).multiply(qTilt);
        const fs = s * (0.9 + rnd() * 0.25);
        pos.set(crownX, crownY - 0.15 * s, crownZ);
        scl.set(fs, fs, fs);
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
    const bladeGeo = this._grassBladeGeometry(); // genuinely crossed, tapered, gradient
    const grassMesh = new THREE.InstancedMesh(bladeGeo, this._mats.grass, GRASS);
    grassMesh.receiveShadow = true;
    for (let i = 0; i < GRASS; i++) {
      const z = -4 - rnd() * 120;
      const x = (rnd() - 0.5) * 64;
      const y = env.getHeight(x, z);
      const s = 0.7 + rnd() * 0.9;
      // per-instance yaw + a little tilt/lean so the clump isn't a rigid grid
      e.set((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35);
      q.setFromEuler(e);
      pos.set(x, y, z);
      scl.set(s * (0.8 + rnd() * 0.5), s * (0.8 + rnd() * 0.7), s * (0.8 + rnd() * 0.5));
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
