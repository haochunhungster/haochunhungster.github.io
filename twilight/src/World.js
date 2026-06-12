import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// ---------- 2D value noise（CPU 端可採樣，地形與植被共用） ----------
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function smooth(t) { return t * t * (3 - 2 * t); }
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += amp * noise2(x * f, y * f);
    amp *= 0.5; f *= 2.1;
  }
  return v;
}

export const ISLAND_R = 78;       // 島嶼半徑
export const WATER_Y = 0;         // 水面高度

// 島嶼高度場：fbm × 徑向衰減，中央隆起放遺跡
export function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  const falloff = Math.max(0, 1 - Math.pow(d / ISLAND_R, 2.2));
  let h = fbm(x * 0.018 + 7.3, z * 0.018 + 2.9, 5) * 14 * falloff;
  // 中央高地（遺跡台座）
  const plateau = Math.max(0, 1 - d / 22);
  h += smooth(Math.min(1, plateau * 1.4)) * 5.5;
  // 平整中央，方便放遺跡
  if (d < 11) h = THREE.MathUtils.lerp(h, 9.2, smooth(1 - d / 11) * 0.85);
  return h - 2.2; // 整體下沉讓邊緣入水
}

export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.q = quality || { grass: 30000, trees: 110, fireflies: 220, shadow: 2048 };
    this.time = 0;
    this.windUniforms = [];
    this.relics = [];
    this.portal = null;
    this.portalActive = false;

    this._buildSky();
    this._buildLights();
    this._buildTerrain();
    this._buildWater();
    this._buildGrass();
    this._buildTrees();
    this._buildRocks();
    this._buildRuins();
    this._buildRelics();
    this._buildPortal();
    this._buildFireflies();
    this.scene.fog = new THREE.FogExp2(0x2f2240, 0.0032);
  }

  // ---------- 天空與環境光照 ----------
  _buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(2000);
    this.scene.add(sky);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 2.8;
    u.mieCoefficient.value = 0.008;
    u.mieDirectionalG.value = 0.8;
    // 黃昏：太陽貼近地平線
    const sunElev = 12, sunAz = 205;
    const phi = THREE.MathUtils.degToRad(90 - sunElev);
    const theta = THREE.MathUtils.degToRad(sunAz);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);

    // 以天空產生環境反射貼圖（PBR 材質的 IBL）
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    const skyClone = new Sky();
    skyClone.scale.setScalar(2000);
    Object.keys(u).forEach(k => { skyClone.material.uniforms[k].value = u[k].value; });
    skyScene.add(skyClone);
    this.scene.environment = pmrem.fromScene(skyScene, 0.02).texture;
    pmrem.dispose();
  }

  _buildLights() {
    // 黃昏主光
    const sun = new THREE.DirectionalLight(0xffa060, 4.0);
    sun.position.copy(this.sunDir).multiplyScalar(120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.sun = sun;
    // 天光補光：紫色天頂 / 暖色地面反射
    this.scene.add(new THREE.HemisphereLight(0x9a8aab, 0x5a4530, 2.0));
    // Lambert 系材質吃不到 scene.environment 的 IBL，用 ambient 補基礎亮度
    this.scene.add(new THREE.AmbientLight(0x4a4252, 0.7));
  }

  // ---------- 地形（頂點色：沙→草→岩） ----------
  _buildTerrain() {
    const SIZE = ISLAND_R * 2.6, SEG = 240;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0x9a8662);
    const grassA = new THREE.Color(0x4a6b35);
    const grassB = new THREE.Color(0x6b7d3a);
    const rock = new THREE.Color(0x6e6258);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      // 坡度近似
      const e = 0.8;
      const slope = Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h);
      const n = noise2(x * 0.08, z * 0.08);
      if (h < WATER_Y + 0.9) c.copy(sand);
      else if (slope > 1.15 || h > 11.5) c.copy(rock);
      else c.lerpColors(grassA, grassB, n);
      // 沙草過渡
      if (h >= WATER_Y + 0.9 && h < WATER_Y + 2.0 && slope <= 1.15)
        c.lerp(sand, 1 - (h - WATER_Y - 0.9) / 1.1);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // 水下海床（防穿幫）
    const bed = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE * 3, SIZE * 3),
      new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 1 })
    );
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -3.5;
    this.scene.add(bed);
  }

  // ---------- 水面（envMap 反射天空，零額外渲染 pass） ----------
  _buildWater() {
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    this.waterTex = new THREE.TextureLoader().load('./assets/waternormals.jpg', t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(48, 48);
    });
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1c4450,
      normalMap: this.waterTex,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.12,
      metalness: 0.82,
      envMapIntensity: 1.3,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    this.scene.add(this.water);
  }

  // ---------- 草（InstancedMesh + 風吹 shader） ----------
  _buildGrass() {
    const COUNT = this.q.grass;
    const blade = new THREE.PlaneGeometry(0.09, 0.48, 1, 2);
    blade.translate(0, 0.24, 0);
    // emissive 當背光面底色：草葉背面不受光，沒有它會變黑籤
    const mat = new THREE.MeshLambertMaterial({
      color: 0x6d7c30, emissive: 0x2a2e14, side: THREE.DoubleSide,
    });
    const windU = { value: 0 };
    this.windUniforms.push(windU);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = windU;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = instanceMatrix * vec4(0.,0.,0.,1.);
          float sway = sin(uTime * 1.7 + wp.x * 0.35 + wp.z * 0.45) * 0.5
                     + sin(uTime * 3.3 + wp.z * 0.8) * 0.22;
          float k = position.y / 0.48;
          transformed.x += sway * k * k * 0.35;
          transformed.z += sway * k * k * 0.18;
        }`
      );
    };
    const inst = new THREE.InstancedMesh(blade, mat, COUNT);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    let placed = 0, tries = 0;
    while (placed < COUNT && tries < COUNT * 4) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (ISLAND_R - 4);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h < WATER_Y + 1.6 || h > 11) continue;
      if (Math.hypot(x, z - 34) < 5) continue; // 出生點留空
      const slope = Math.abs(terrainHeight(x + 0.8, z) - h);
      if (slope > 0.9) continue;
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      const sc = 0.7 + Math.random() * 0.7;
      s.set(sc, sc, sc);
      m.compose(new THREE.Vector3(x, h, z), q, s);
      inst.setMatrixAt(placed, m);
      color.setHSL(0.23 + Math.random() * 0.05, 0.42, 0.3 + Math.random() * 0.14);
      inst.setColorAt(placed, color);
      placed++;
    }
    inst.count = placed;
    this.scene.add(inst);
  }

  // ---------- 樹（程序化松樹，幹/葉兩個 InstancedMesh） ----------
  _buildTrees() {
    const COUNT = this.q.trees;
    const positions = [];
    let tries = 0;
    while (positions.length < COUNT && tries < 3000) {
      tries++;
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.sqrt(Math.random()) * (ISLAND_R - 24);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h < WATER_Y + 1.8 || h > 10.5) continue;
      if (Math.hypot(x, z - 34) < 12) continue; // 出生點視野留空
      const slope = Math.abs(terrainHeight(x + 1, z) - h);
      if (slope > 0.85) continue;
      if (positions.some(p => Math.hypot(p.x - x, p.z - z) < 6)) continue;
      positions.push(new THREE.Vector3(x, h, z));
    }
    this.treePositions = positions;

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 3.4, 7);
    trunkGeo.translate(0, 1.7, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3526 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);

    // 三層圓錐合併成單一葉幾何
    const cones = [];
    const layer = (ry, rad, ht) => {
      const g = new THREE.ConeGeometry(rad, ht, 8);
      g.translate(0, ry, 0);
      return g;
    };
    const leafGeos = [layer(4.2, 2.5, 3.2), layer(6.0, 1.9, 2.8), layer(7.6, 1.2, 2.4)];
    // 簡單合併
    let totalGeo = null;
    {
      const merged = new THREE.BufferGeometry();
      let verts = [], norms = [], idx = [], off = 0;
      for (const g of leafGeos) {
        const p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array;
        verts.push(...p); norms.push(...n);
        for (let i = 0; i < ix.length; i++) idx.push(ix[i] + off);
        off += p.length / 3;
      }
      merged.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      merged.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
      merged.setIndex(idx);
      totalGeo = merged;
    }
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e4a28, emissive: 0x182210 });
    const leaves = new THREE.InstancedMesh(totalGeo, leafMat, positions.length);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    positions.forEach((p, i) => {
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
      const sc = 0.8 + Math.random() * 0.7;
      s.set(sc, sc * (0.9 + Math.random() * 0.3), sc);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      c.setHSL(0.3 + Math.random() * 0.06, 0.35, 0.2 + Math.random() * 0.1);
      leaves.setColorAt(i, c);
    });
    trunks.castShadow = true; trunks.receiveShadow = true;
    leaves.castShadow = true; leaves.receiveShadow = true;
    this.scene.add(trunks, leaves);
  }

  // ---------- 散石 ----------
  _buildRocks() {
    const COUNT = 60;
    const geo = new THREE.IcosahedronGeometry(1, 2);
    // 頂點擾動讓石頭不規則
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      v.multiplyScalar(0.88 + hash2(i * 3.1, i * 7.7) * 0.28);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ color: 0x9a8d7d, emissive: 0x1a1612 });
    const inst = new THREE.InstancedMesh(geo, mat, COUNT);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    this.rockColliders = [];
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * (ISLAND_R - 16);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = terrainHeight(x, z);
      if (h < WATER_Y + 0.5) { i--; continue; }
      const sc = 0.4 + Math.random() * 1.3;
      q.setFromEuler(new THREE.Euler(Math.random(), Math.random() * 6, Math.random()));
      s.set(sc, sc * 0.8, sc);
      m.compose(new THREE.Vector3(x, h + sc * 0.15, z), q, s);
      inst.setMatrixAt(i, m);
      if (sc > 0.8) this.rockColliders.push({ x, z, r: sc * 0.9 });
    }
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
  }

  // ---------- 中央遺跡（石柱環） ----------
  _buildRuins() {
    const group = new THREE.Group();
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8a7f72 });
    const R = 9, N = 8;
    this.pillarColliders = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const broken = i % 3 === 2;
      const ht = broken ? 1.6 + Math.random() * 1.2 : 4.6;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.68, ht, 9), stoneMat);
      const y = terrainHeight(x, z);
      pillar.position.set(x, y + ht / 2, z);
      pillar.rotation.y = Math.random();
      if (broken) pillar.rotation.z = (Math.random() - 0.5) * 0.12;
      pillar.castShadow = true; pillar.receiveShadow = true;
      group.add(pillar);
      this.pillarColliders.push({ x, z, r: 0.85 });
      if (!broken) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 1.5), stoneMat);
        cap.position.set(x, y + ht + 0.22, z);
        cap.rotation.y = pillar.rotation.y;
        cap.castShadow = true; cap.receiveShadow = true;
        group.add(cap);
      }
    }
    // 中央石壇
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.0, 0.9, 24), stoneMat);
    dais.position.set(0, terrainHeight(0, 0) + 0.45, 0);
    dais.castShadow = true; dais.receiveShadow = true;
    group.add(dais);
    this.scene.add(group);
  }

  // ---------- 聖物（5 枚） ----------
  _buildRelics() {
    // 中央 1 + 四象限 4
    const spots = [[0, 0]];
    const QUAD = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (const [sx, sz] of QUAD) {
      let best = null;
      for (let t = 0; t < 60; t++) {
        const x = sx * (25 + Math.random() * 35);
        const z = sz * (25 + Math.random() * 35);
        const h = terrainHeight(x, z);
        if (h > WATER_Y + 2 && h < 11) { best = [x, z]; break; }
      }
      spots.push(best || [sx * 30, sz * 30]);
    }
    const geo = new THREE.OctahedronGeometry(0.55);
    for (const [x, z] of spots) {
      const y = terrainHeight(x, z);
      const grp = new THREE.Group();
      grp.position.set(x, y, z);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x7be8d8, emissive: 0x4fd8c4, emissiveIntensity: 2.4,
        roughness: 0.2, metalness: 0.1,
      });
      const gem = new THREE.Mesh(geo, mat);
      gem.position.y = 1.6;
      grp.add(gem);
      // 光柱
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.5, 14, 12, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x6fe8d4, transparent: true, opacity: 0.16,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
        })
      );
      beam.position.y = 7;
      grp.add(beam);
      const light = new THREE.PointLight(0x5fe8d0, 6, 9, 1.8);
      light.position.y = 1.8;
      grp.add(light);
      this.scene.add(grp);
      this.relics.push({ group: grp, gem, light, x, z, taken: false, baseY: y + 1.6 });
    }
  }

  // ---------- 歸途之門（集滿後啟動） ----------
  _buildPortal() {
    const y = terrainHeight(0, 0);
    const grp = new THREE.Group();
    grp.position.set(0, y + 0.9, 0);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.8 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.32, 12, 32), ringMat);
    ring.position.y = 2.2;
    ring.castShadow = true;
    grp.add(ring);
    // 門面（啟動後顯示）
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xb070ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), planeMat);
    plane.position.y = 2.2;
    grp.add(plane);
    const light = new THREE.PointLight(0xb070ff, 0, 18, 1.8);
    light.position.y = 2.4;
    grp.add(light);
    this.scene.add(grp);
    this.portal = { group: grp, plane, light, ring };
  }

  activatePortal() {
    this.portalActive = true;
  }

  // ---------- 螢火蟲 ----------
  _buildFireflies() {
    const COUNT = this.q.fireflies;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(COUNT * 3);
    this.fireflySeeds = [];
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (ISLAND_R - 8);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = Math.max(terrainHeight(x, z), WATER_Y);
      pos[i * 3] = x; pos[i * 3 + 1] = h + 0.6 + Math.random() * 2.5; pos[i * 3 + 2] = z;
      this.fireflySeeds.push({ x, z, baseY: h + 0.6 + Math.random() * 2.5, ph: Math.random() * 9 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffd890, size: 0.16, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.fireflies = new THREE.Points(geo, mat);
    this.scene.add(this.fireflies);
  }

  // ---------- 障礙碰撞（樹/石/柱），快取一次建好 ----------
  collide(pos, radius) {
    if (!this._colliders) {
      this._colliders = [
        ...this.treePositions.map(t => ({ x: t.x, z: t.z, r: 0.5 })),
        ...this.rockColliders,
        ...this.pillarColliders,
      ];
    }
    for (const o of this._colliders) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + radius;
      if (d < min && d > 0.001) {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      }
    }
  }

  update(dt, playerPos) {
    this.time += dt;
    const t = this.time;
    if (this.waterTex) {
      this.waterTex.offset.set(t * 0.012, t * 0.017);
    }
    for (const u of this.windUniforms) u.value = t;

    // 聖物浮動
    for (const r of this.relics) {
      if (r.taken) continue;
      r.gem.position.y = (r.baseY - terrainHeight(r.x, r.z)) + Math.sin(t * 1.6 + r.x) * 0.18;
      r.gem.rotation.y = t * 1.2;
      r.light.intensity = 5.2 + Math.sin(t * 3 + r.z) * 1.2;
    }

    // 螢火蟲漂移
    const fp = this.fireflies.geometry.attributes.position;
    for (let i = 0; i < this.fireflySeeds.length; i++) {
      const s = this.fireflySeeds[i];
      fp.setX(i, s.x + Math.sin(t * 0.5 + s.ph) * 1.4);
      fp.setY(i, s.baseY + Math.sin(t * 0.9 + s.ph * 2) * 0.5);
      fp.setZ(i, s.z + Math.cos(t * 0.4 + s.ph) * 1.4);
    }
    fp.needsUpdate = true;
    this.fireflies.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.3;

    // 傳送門
    if (this.portalActive) {
      const p = this.portal;
      p.plane.material.opacity = Math.min(0.75, p.plane.material.opacity + dt * 0.4);
      p.light.intensity = Math.min(14, p.light.intensity + dt * 6);
      p.ring.rotation.z += dt * 0.4;
      p.plane.rotation.z -= dt * 0.6;
    }
  }
}
