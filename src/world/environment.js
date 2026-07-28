// Environment: sky, sun, atmospheric lighting, layered fog, PBR terrain, grass.
// Golden-hour Angolan savanna: warm dusty haze, laterite/dry-earth ground,
// patchy dry grass blended by height & slope, instanced wind-swayed tufts.
// Renderer uses ACES filmic tone mapping (exposure ~1.05, set in engine.js);
// all canvas textures below are authored in that expectation.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class Environment {
  constructor(ctx) {
    this.ctx = ctx;
    this._noiseSeed = 1337;
    this._time = 0;
    this._windMats = []; // materials that carry a uWind time uniform
  }

  async init() {
    const scene = this.ctx.scene;

    // ---- lighting: warm late-afternoon savanna ----
    // Hemisphere: cool skylight from above, warm bounced laterite from below.
    this.hemi = new THREE.HemisphereLight(0xbcd2e2, 0x5c4a2e, 0.5);
    scene.add(this.hemi);

    // Low, warm, strong key light for long golden-hour shadows.
    this.sun = new THREE.DirectionalLight(0xffdba0, 2.7);
    this.sun.position.set(72, 58, 46);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    const s = 100;
    this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3.5; // soft PCF edge
    scene.add(this.sun);
    scene.add(this.sun.target);

    // A faint warm fill opposite the sun to lift shadow cores (no shadow cast).
    this.fill = new THREE.DirectionalLight(0xe8a35c, 0.35);
    this.fill.position.set(-50, 22, -40);
    scene.add(this.fill);

    // ---- sky: hazy golden hour, sun low on the horizon ----
    this.sky = new Sky();
    this.sky.scale.setScalar(5000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 8.5;        // dusty air
    u.rayleigh.value = 2.2;         // warmer, deeper sky gradient
    u.mieCoefficient.value = 0.009; // strong sun halo through haze
    u.mieDirectionalG.value = 0.82;
    // Sun ~14 deg above horizon → long shadows, warm rim.
    const elevation = 14, azimuth = 108;
    const phi = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunDir);
    scene.add(this.sky);

    // Align the actual light with the sky's sun for coherent shadows/rim.
    this.sun.position.copy(sunDir).multiplyScalar(140);
    this.sun.position.y = Math.max(this.sun.position.y, 40);

    // ---- fog: layered dusty heat haze ----
    // Distance term (exp2) for depth; a warm horizon tint sells the golden haze.
    // A cheap height component is injected into the terrain/grass shaders below
    // so low-lying dust reads thicker than the clear upper air.
    this._fogColor = new THREE.Color(0xd8bd93);
    scene.fog = new THREE.FogExp2(this._fogColor.getHex(), 0.0052);

    this._buildTerrain();
    this._buildGrass();
  }

  // ---------------------------------------------------------------- noise
  _hash(x, z) {
    const n = Math.sin(x * 127.1 + z * 311.7 + this._noiseSeed) * 43758.5453;
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

  _fbm(x, z) {
    // 3-octave fractal noise for softly varied macro relief.
    return this._noise(x, z) * 0.6 + this._noise(x * 2.03, z * 2.03) * 0.28 +
           this._noise(x * 4.11, z * 4.11) * 0.12;
  }

  getHeight(x, z) {
    // Gentle rolling savanna; keep the central play corridor traversable.
    const h = this._fbm(x * 0.015, z * 0.015) * 6.5 + this._noise(x * 0.06, z * 0.06) * 1.1;
    const corridor = Math.exp(-(x * x) / 900); // flatten near center path
    return h * (1 - corridor * 0.7) - 2;
  }

  // ------------------------------------------------------------- terrain
  _buildTerrain() {
    const size = 500, seg = 220;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;

    // Per-vertex color = large-scale ground palette variation blended by
    // height & slope: reddish laterite in low/flat ground, paler cracked
    // earth on rises, dry-grass ochre on gentle mid slopes.
    const colors = new Float32Array(pos.count * 3);
    const cLaterite = new THREE.Color(0x8a4a2c); // iron-red soil
    const cEarth    = new THREE.Color(0xb59a63); // pale cracked dry earth
    const cGrass    = new THREE.Color(0x9c8a44); // patchy dry grass ochre
    const tmp = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const nv = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      nv.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      const slope = 1 - Math.max(0, nv.dot(up)); // 0 flat .. ~1 steep
      const hN = THREE.MathUtils.clamp((y + 4) / 9, 0, 1); // normalized height
      // Patchiness mask so grass appears in irregular clumps, not bands.
      const patch = this._noise(x * 0.05 + 11, z * 0.05 - 7);

      tmp.copy(cLaterite).lerp(cEarth, THREE.MathUtils.smoothstep(hN, 0.15, 0.75));
      const grassAmt = THREE.MathUtils.clamp(
        (0.7 - slope * 2.2) * THREE.MathUtils.smoothstep(patch, 0.35, 0.75), 0, 1);
      tmp.lerp(cGrass, grassAmt * 0.65);
      // Subtle per-vertex grain so tiling never looks flat.
      const grain = 0.92 + this._hash(x * 3.1, z * 3.1) * 0.16;
      colors[i * 3] = tmp.r * grain;
      colors[i * 3 + 1] = tmp.g * grain;
      colors[i * 3 + 2] = tmp.b * grain;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Canvas-generated PBR detail maps (albedo/normal/roughness), tiled.
    const { albedo, normal, rough } = this._makeGroundTextures();
    const repeat = 42;
    [albedo, normal, rough].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
      t.anisotropy = 8;
    });
    albedo.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      roughnessMap: rough,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 1.0,
      metalness: 0.0,
      vertexColors: true,
      color: 0xffffff,
      dithering: true,
    });
    this._injectHeightFog(mat);

    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    ground.castShadow = false;
    this.ctx.scene.add(ground);
    this.ground = ground;
    this.ctx.level && this.ctx.level.collidables?.push(ground);
  }

  // Inject a low-altitude fog term so dust settles thickest near the ground,
  // blended on top of the scene's exp2 distance fog. Shared warm color.
  _injectHeightFog(mat) {
    const prev = mat.onBeforeCompile; // compose, don't clobber (grass wind)
    mat.onBeforeCompile = (shader) => {
      if (prev) prev(shader);
      shader.uniforms.uFogHeightColor = { value: this._fogColor };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <fog_pars_fragment>',
          '#include <fog_pars_fragment>\n uniform vec3 uFogHeightColor;\n varying vec3 vWorldPosH;')
        .replace('#include <fog_fragment>', `#include <fog_fragment>
          #ifdef USE_FOG
            float hFog = clamp((3.0 - vWorldPosH.y) / 24.0, 0.0, 1.0);
            hFog *= hFog * 0.35;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogHeightColor, hFog);
          #endif`);
      shader.vertexShader = shader.vertexShader
        .replace('#include <fog_vertex>', `#include <fog_vertex>
          vec4 wpH = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wpH = instanceMatrix * wpH;
          #endif
          vWorldPosH = (modelMatrix * wpH).xyz;`)
        .replace('#include <common>',
          '#include <common>\n varying vec3 vWorldPosH;');
    };
  }

  _makeGroundTextures() {
    const S = 512;
    const alb = document.createElement('canvas'); alb.width = alb.height = S;
    const rgh = document.createElement('canvas'); rgh.width = rgh.height = S;
    const nrm = document.createElement('canvas'); nrm.width = nrm.height = S;
    const ac = alb.getContext('2d');
    const rc = rgh.getContext('2d');

    // Base dry-earth field.
    ac.fillStyle = '#a2814f'; ac.fillRect(0, 0, S, S);
    rc.fillStyle = '#c8c8c8'; rc.fillRect(0, 0, S, S); // fairly rough overall

    const rand = (() => { let s = 9271; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

    // Mottled soil + reddish laterite blotches (albedo) with matching roughness.
    for (let i = 0; i < 2600; i++) {
      const x = rand() * S, y = rand() * S, r = 2 + rand() * 22;
      const red = rand();
      const shade = 50 + rand() * 55;
      if (red > 0.72) {
        ac.fillStyle = `rgba(${120 + shade * 0.6 | 0},${60 + shade * 0.3 | 0},${38 + shade * 0.2 | 0},0.16)`;
      } else {
        ac.fillStyle = `rgba(${150 + shade | 0},${125 + shade * 0.8 | 0},${80 + shade * 0.5 | 0},0.13)`;
      }
      ac.beginPath(); ac.arc(x, y, r, 0, Math.PI * 2); ac.fill();
      rc.fillStyle = `rgba(${180 + rand() * 60 | 0},${180 | 0},${180 | 0},0.12)`;
      rc.beginPath(); rc.arc(x, y, r * 0.8, 0, Math.PI * 2); rc.fill();
    }

    // Fine sandy grain / pebbles.
    for (let i = 0; i < 14000; i++) {
      const x = rand() * S, y = rand() * S;
      const b = rand();
      ac.fillStyle = `rgba(${b > 0.5 ? 60 : 220},${b > 0.5 ? 45 : 205},${b > 0.5 ? 30 : 160},${0.05 + rand() * 0.08})`;
      ac.fillRect(x, y, 1.4, 1.4);
    }

    // Cracked-earth network → dark albedo lines + roughness + normal crevices.
    const nc = nrm.getContext('2d');
    nc.fillStyle = '#8080ff'; nc.fillRect(0, 0, S, S); // flat normal
    const cracks = this._genCracks(S, rand);
    // draw cracks tileably (also wrap ±S offsets so seams match)
    for (const seg of cracks) {
      for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        ac.strokeStyle = 'rgba(40,26,16,0.5)';
        ac.lineWidth = seg.w; ac.lineCap = 'round';
        ac.beginPath(); ac.moveTo(seg.x0 + ox, seg.y0 + oy); ac.lineTo(seg.x1 + ox, seg.y1 + oy); ac.stroke();
        rc.strokeStyle = 'rgba(90,90,90,0.5)'; // cracks slightly smoother (packed)
        rc.lineWidth = seg.w; rc.lineCap = 'round';
        rc.beginPath(); rc.moveTo(seg.x0 + ox, seg.y0 + oy); rc.lineTo(seg.x1 + ox, seg.y1 + oy); rc.stroke();
        // normal: dark valley + bright lip for a carved crevice
        nc.strokeStyle = 'rgba(60,60,200,0.55)';
        nc.lineWidth = seg.w + 1.5; nc.lineCap = 'round';
        nc.beginPath(); nc.moveTo(seg.x0 + ox, seg.y0 + oy); nc.lineTo(seg.x1 + ox, seg.y1 + oy); nc.stroke();
      }
    }
    // Bump-derived normal detail from the albedo grain (cheap tangent noise).
    for (let i = 0; i < 5000; i++) {
      const x = rand() * S, y = rand() * S;
      const dx = (rand() - 0.5), dy = (rand() - 0.5);
      nc.fillStyle = `rgba(${128 + dx * 90 | 0},${128 + dy * 90 | 0},235,0.10)`;
      nc.beginPath(); nc.arc(x, y, 1 + rand() * 2.5, 0, Math.PI * 2); nc.fill();
    }

    return {
      albedo: new THREE.CanvasTexture(alb),
      normal: new THREE.CanvasTexture(nrm),
      rough: new THREE.CanvasTexture(rgh),
    };
  }

  // Random walk crack segments forming a dried-mud polygon network.
  _genCracks(S, rand) {
    const segs = [];
    const nodes = 22;
    for (let n = 0; n < nodes; n++) {
      let x = rand() * S, y = rand() * S;
      let ang = rand() * Math.PI * 2;
      const steps = 6 + (rand() * 10 | 0);
      for (let k = 0; k < steps; k++) {
        ang += (rand() - 0.5) * 1.1;
        const len = 8 + rand() * 26;
        const x1 = x + Math.cos(ang) * len, y1 = y + Math.sin(ang) * len;
        segs.push({ x0: x, y0: y, x1, y1, w: 0.8 + rand() * 2.2 });
        x = x1; y = y1;
      }
    }
    return segs;
  }

  // -------------------------------------------------------------- grass
  _buildGrass() {
    const COUNT = 5200;            // perf-safe, single draw call
    const AREA = 150;              // spread around the play corridor
    const tex = this._makeGrassTexture();

    // Small billboarded tuft: two crossed quads keep it cheap yet volumetric.
    const blade = new THREE.PlaneGeometry(1.1, 1.1, 1, 1);
    blade.translate(0, 0.55, 0); // pivot at base for wind bending
    const cross = blade.clone(); cross.rotateY(Math.PI / 2);
    const geo = this._mergeGeoms([blade, cross]);

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.42,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
      color: 0xc7b25e,
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    this._injectGrassWind(mat);
    this._injectHeightFog(mat); // grass drinks the same low dust

    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    const dummy = new THREE.Object3D();
    const rand = (() => { let s = 4451; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    let placed = 0;
    for (let i = 0; i < COUNT; i++) {
      // Bias placement into flatter, grassier ground; skip steep/high spots.
      const x = (rand() * 2 - 1) * AREA;
      const z = (rand() * 2 - 1) * AREA;
      const y = this.getHeight(x, z);
      const patch = this._noise(x * 0.05 + 11, z * 0.05 - 7);
      if (patch < 0.42 && rand() > 0.25) continue; // clump into grassy patches
      const scale = 0.7 + rand() * 1.5;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.scale.set(scale * (0.8 + rand() * 0.4), scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed++, dummy.matrix);
    }
    mesh.count = placed; // only render the tufts we actually placed
    mesh.instanceMatrix.needsUpdate = true;
    // Generous bounds so culling never pops the whole field near the camera.
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), AREA * 1.6);

    this.ctx.scene.add(mesh);
    this.grass = mesh;
  }

  // Minimal in-file geometry merge (avoids importing BufferGeometryUtils).
  _mergeGeoms(geoms) {
    let vCount = 0, iCount = 0;
    for (const g of geoms) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : 0; }
    const pos = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const nrm = new Float32Array(vCount * 3);
    const idx = new Uint16Array(iCount);
    let vo = 0, io = 0, base = 0;
    for (const g of geoms) {
      const p = g.attributes.position, u = g.attributes.uv, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        pos[vo * 3] = p.getX(i); pos[vo * 3 + 1] = p.getY(i); pos[vo * 3 + 2] = p.getZ(i);
        nrm[vo * 3] = n.getX(i); nrm[vo * 3 + 1] = n.getY(i); nrm[vo * 3 + 2] = n.getZ(i);
        uv[vo * 2] = u.getX(i); uv[vo * 2 + 1] = u.getY(i);
        vo++;
      }
      const gi = g.index;
      for (let i = 0; i < gi.count; i++) idx[io++] = gi.getX(i) + base;
      base += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  // Vertex-shader wind sway driven by a shared time uniform (no CPU cost/frame).
  _injectGrassWind(mat) {
    const uWind = { value: 0 };
    mat.userData.uWind = uWind;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // sway grows toward the tip (uv.y); phase varies per instance origin
          float ph = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.6;
          float sway = sin(uWind * 1.6 + ph) * 0.14 + sin(uWind * 3.1 + ph * 1.7) * 0.05;
          transformed.x += sway * uv.y * uv.y;
          transformed.z += sway * 0.6 * uv.y * uv.y;`);
      // keep the height-fog varying available if _injectHeightFog also ran
      mat.userData._windShader = shader;
    };
  }

  _makeGrassTexture() {
    const W = 128, H = 128;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const rand = (() => { let s = 7717; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    // A cluster of dry blades, tapering, ochre → pale gold, some greenish.
    const blades = 26;
    for (let i = 0; i < blades; i++) {
      const bx = W * (0.15 + rand() * 0.7);
      const bw = 2 + rand() * 3;
      const bh = H * (0.45 + rand() * 0.5);
      const lean = (rand() - 0.5) * 26;
      const green = rand() < 0.3;
      const r = green ? 120 + rand() * 40 : 190 + rand() * 50;
      const gg = green ? 130 + rand() * 40 : 165 + rand() * 45;
      const b = 60 + rand() * 40;
      g.strokeStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.lineWidth = bw; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(bx, H);
      g.quadraticCurveTo(bx + lean * 0.5, H - bh * 0.5, bx + lean, H - bh);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  // -------------------------------------------------------------- update
  update(dt) {
    this._time += dt;
    // Advance the shared grass-wind clock (single uniform, all instances).
    if (this.grass && this.grass.material.userData.uWind) {
      this.grass.material.userData.uWind.value = this._time;
    }
  }
}
