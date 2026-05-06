import * as THREE from 'three';

// 場景常量
const MAP_SIZE = 60; // 60x60 公尺廢棄工廠

// === 工具：建立程序紋理（噪聲 + 條紋）===
function makeConcreteTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // 底色
  ctx.fillStyle = '#56544f';
  ctx.fillRect(0, 0, size, size);

  // 大尺度斑塊（先鋪基底，純灰階）
  for (let k = 0; k < 8; k++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 60 + Math.random() * 100;
    const col = 60 + Math.random() * 26;
    ctx.fillStyle = `rgba(${col}, ${col-1}, ${col-2}, 0.5)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 細微雜訊（強度大幅降低）
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
    img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n * 0.9));
    img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n * 0.8));
  }
  ctx.putImageData(img, 0, 0);

  // 油漬塊
  ctx.fillStyle = 'rgba(15, 12, 10, 0.45)';
  for (let k = 0; k < 16; k++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 14 + Math.random() * 36;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 接縫線（橫豎隔幾格）
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  ctx.lineWidth = 1.5;
  for (let k = 1; k < 4; k++) {
    const y = (size / 4) * k;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(y, 0); ctx.lineTo(y, size); ctx.stroke();
  }

  // 細裂痕
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.6;
  for (let k = 0; k < 12; k++) {
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 80);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function makeMetalTexture(baseColor = '#3d3530') {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // 鐵鏽（更柔和的色）
  ctx.fillStyle = 'rgba(80, 38, 22, 0.45)';
  for (let k = 0; k < 10; k++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 8 + Math.random() * 22;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // 暗條紋（瓦楞鐵感）
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 8; k++) {
    const y = (size / 8) * k + (Math.random() * 2 - 1);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // 微亮高光條紋
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let k = 0; k < 8; k++) {
    const y = (size / 8) * k + 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }

  // 細噪點（強度減半）
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    img.data[i]   += n;
    img.data[i+1] += n * 0.9;
    img.data[i+2] += n * 0.8;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// 撤離區
class ExtractionZone {
  constructor(scene, position, radius = 3.5) {
    this.position = position.clone();
    this.radius = radius;
    this.countdown = 10;
    this.armed = false;
    this.completed = false;

    const group = new THREE.Group();

    // 地面圓圈（綠色發光）
    const ringGeo = new THREE.RingGeometry(radius - 0.15, radius, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6cff8c, transparent: true, opacity: 0.85,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.position.copy(position);
    this.ring.position.y = 0.02;
    group.add(this.ring);

    // 內圈柔和
    const innerGeo = new THREE.CircleGeometry(radius * 0.92, 64);
    innerGeo.rotateX(-Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x6cff8c, transparent: true, opacity: 0.10,
    });
    this.inner = new THREE.Mesh(innerGeo, innerMat);
    this.inner.position.copy(position);
    this.inner.position.y = 0.03;
    group.add(this.inner);

    // 直立光柱
    const beamGeo = new THREE.CylinderGeometry(radius * 0.2, radius * 0.6, 14, 16, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0x6cff8c, transparent: true, opacity: 0.20, side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.position.copy(position);
    this.beam.position.y = 7;
    group.add(this.beam);

    scene.add(group);
    this.group = group;
  }

  reset() {
    this.countdown = 10;
    this.armed = false;
    this.completed = false;
    this.ring.material.color.setHex(0x6cff8c);
    this.inner.material.color.setHex(0x6cff8c);
    this.beam.material.color.setHex(0x6cff8c);
  }

  update(dt, player) {
    // 脈動
    const t = performance.now() * 0.002;
    this.beam.material.opacity = 0.18 + Math.sin(t) * 0.06;

    if (this.completed) return;

    const d = player.position.distanceTo(this.position);
    const inside = d < this.radius;

    // 如果敵人還沒清完，進入時不開始倒數
    const enemiesLeft = player.game.enemies.aliveCount();

    if (inside && enemiesLeft === 0) {
      this.armed = true;
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.completed = true;
        player.game.victory();
      }
    } else if (inside && enemiesLeft > 0) {
      // 還有敵人時撤離區是紅色（提示）
      this.ring.material.color.setHex(0xd23028);
      this.inner.material.color.setHex(0xd23028);
      this.beam.material.color.setHex(0xd23028);
      this.armed = false;
      this.countdown = 10;
    } else {
      // 重置顏色與倒數
      if (enemiesLeft === 0) {
        this.ring.material.color.setHex(0x6cff8c);
        this.inner.material.color.setHex(0x6cff8c);
        this.beam.material.color.setHex(0x6cff8c);
      }
      this.armed = false;
      this.countdown = 10;
    }
  }

  isArmed() { return this.armed; }
  isCompleted() { return this.completed; }
}

export function buildMap(scene) {
  const colliders = []; // 所有 AABB（{min,max,height}）
  const obstacles = []; // 用於 raycast（mesh 集合）
  const obstacleGroup = new THREE.Group();
  scene.add(obstacleGroup);

  // === 地板 ===
  const floorTex = makeConcreteTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // === 邊界牆 ===
  const wallTex = makeMetalTexture('#2a2823');
  wallTex.repeat.set(6, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.15, color: 0xaaaaaa });
  const wallH = 4;
  const wallT = 0.6;
  const half = MAP_SIZE / 2;
  const wallSpecs = [
    { x: 0, z: -half, w: MAP_SIZE, d: wallT },
    { x: 0, z:  half, w: MAP_SIZE, d: wallT },
    { x: -half, z: 0, w: wallT, d: MAP_SIZE },
    { x:  half, z: 0, w: wallT, d: MAP_SIZE },
  ];
  for (const s of wallSpecs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, wallH, s.d), wallMat);
    m.position.set(s.x, wallH / 2, s.z);
    m.castShadow = true; m.receiveShadow = true;
    obstacleGroup.add(m);
    colliders.push({
      min: new THREE.Vector3(s.x - s.w/2, 0, s.z - s.d/2),
      max: new THREE.Vector3(s.x + s.w/2, wallH, s.z + s.d/2),
    });
    obstacles.push(m);
  }

  // === 程序生成內部障礙 ===
  // 確保性可重現性的偽隨機
  let seed = 1337;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // 工具：放一個 box 並登記碰撞
  function placeBox(x, z, w, h, d, color, opts = {}) {
    const tex = opts.tex || makeMetalTexture(color);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xffffff,
      roughness: opts.rough ?? 0.8,
      metalness: opts.metal ?? 0.2,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    if (opts.rotY) m.rotation.y = opts.rotY;
    m.castShadow = true; m.receiveShadow = true;
    obstacleGroup.add(m);

    // 旋轉時計算 AABB（簡化：取 OBB 的 AABB 包圍盒）
    const halfDiag = Math.max(w, d) / 2;
    const useSquareAABB = !!opts.rotY;
    if (useSquareAABB) {
      colliders.push({
        min: new THREE.Vector3(x - halfDiag, 0, z - halfDiag),
        max: new THREE.Vector3(x + halfDiag, h, z + halfDiag),
      });
    } else {
      colliders.push({
        min: new THREE.Vector3(x - w/2, 0, z - d/2),
        max: new THREE.Vector3(x + w/2, h, z + d/2),
      });
    }
    obstacles.push(m);
    return m;
  }

  // 1. 大型貨櫃（4 個）
  const containerColors = ['#4a382a', '#3a4030', '#2a3540', '#3a2820'];
  const containerSpots = [
    { x: -16, z: -10, rot: 0.0 },
    { x:  14, z:   8, rot: 0.5 },
    { x: -10, z:  16, rot: -0.3 },
    { x:  18, z: -16, rot: 0.2 },
  ];
  for (let i = 0; i < containerSpots.length; i++) {
    const s = containerSpots[i];
    placeBox(s.x, s.z, 12, 2.8, 2.6, containerColors[i], { rotY: s.rot });
    // 第二層
    if (rand() > 0.5) {
      placeBox(s.x + Math.cos(s.rot) * 0.5, s.z + Math.sin(s.rot) * 0.5, 11, 2.6, 2.4, containerColors[(i+1)%4], { rotY: s.rot });
    }
  }

  // 2. 小型木箱 / 油桶（散落）
  for (let i = 0; i < 16; i++) {
    const x = (rand() - 0.5) * (MAP_SIZE - 6);
    const z = (rand() - 0.5) * (MAP_SIZE - 6);
    if (Math.abs(x) < 5 && Math.abs(z) < 5) continue; // 出生點空地
    const isBarrel = rand() > 0.5;
    if (isBarrel) {
      const tex = makeMetalTexture('#7a3520');
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.4 });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 16), mat);
      m.position.set(x, 0.6, z);
      m.castShadow = true; m.receiveShadow = true;
      obstacleGroup.add(m);
      colliders.push({ min: new THREE.Vector3(x-0.55, 0, z-0.55), max: new THREE.Vector3(x+0.55, 1.2, z+0.55) });
      obstacles.push(m);
    } else {
      const w = 0.9 + rand() * 0.3;
      placeBox(x, z, w, w, w, '#4a3525', { rotY: rand() * Math.PI });
    }
  }

  // 3. 牆 / 矮掩體（Z 字型走道）
  const lowWalls = [
    { x: -4, z: -3, w: 6, d: 0.4 },
    { x:  6, z:  2, w: 0.4, d: 6 },
    { x: -2, z:  9, w: 5, d: 0.4 },
    { x:  9, z: -7, w: 0.4, d: 5 },
  ];
  for (const s of lowWalls) {
    placeBox(s.x, s.z, s.w, 1.3, s.d, '#42403c');
  }

  // 4. 中央起重機塔（高聳結構，視覺地標）
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.7, metalness: 0.5 });
  const towerLegs = [
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  for (const [dx, dz] of towerLegs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 0.4), towerMat);
    m.position.set(dx * 1.3, 4, dz * 1.3);
    m.castShadow = true; m.receiveShadow = true;
    obstacleGroup.add(m);
    colliders.push({
      min: new THREE.Vector3(dx*1.3 - 0.2, 0, dz*1.3 - 0.2),
      max: new THREE.Vector3(dx*1.3 + 0.2, 8, dz*1.3 + 0.2),
    });
    obstacles.push(m);
  }
  // 起重機橫樑（無碰撞，純視覺）
  const beam1 = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 0.3), towerMat);
  beam1.position.set(0, 8, 0);
  beam1.castShadow = true;
  obstacleGroup.add(beam1);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 4), towerMat);
  beam2.position.set(0, 8, 0);
  beam2.castShadow = true;
  obstacleGroup.add(beam2);
  // 懸吊燈
  const hangLight = new THREE.PointLight(0xffd5a0, 1.2, 18, 1.5);
  hangLight.position.set(0, 6.5, 0);
  scene.add(hangLight);
  const lampMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 0.5, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe6b0, side: THREE.DoubleSide })
  );
  lampMesh.position.copy(hangLight.position);
  scene.add(lampMesh);

  // === 撤離區（地圖角落）===
  const extraction = new ExtractionZone(scene, new THREE.Vector3(-22, 0, 22), 3.2);

  // === 玩家出生點 ===
  const spawn = new THREE.Vector3(24, 0, -25);

  // === 敵人出生點（5 個分散）===
  const enemySpawns = [
    new THREE.Vector3(-8, 0, -8),
    new THREE.Vector3( 12, 0,  12),
    new THREE.Vector3( -18, 0, 0),
    new THREE.Vector3( 0, 0,  20),
    new THREE.Vector3( 22, 0, -2),
  ];

  return {
    floor, obstacles, colliders,
    extraction,
    spawn,
    enemySpawns,
    bounds: { half, MAP_SIZE },
  };
}
