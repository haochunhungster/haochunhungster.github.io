import * as THREE from 'three';

const PLAYER_RADIUS = 0.45;
const PLAYER_HEIGHT = 1.7;

export class Player {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.maxHp = 100;
    this.hp = 100;
    this.speed = 5.4;
    this.sprintMul = 1.55;

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.aimWorld = new THREE.Vector3();
    this.facing = 0; // y 軸旋轉

    this.stepTimer = 0;
    this.hitFlash = 0;

    // === 視覺：方塊人 ===
    const group = new THREE.Group();

    // 軀幹
    const torsoMat = new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.85, metalness: 0.1 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), torsoMat);
    torso.position.y = 1.0;
    torso.castShadow = true;
    group.add(torso);

    // 頭（戴頭盔）
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.6, metalness: 0.3 });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), helmetMat);
    head.position.y = 1.65;
    head.castShadow = true;
    group.add(head);

    // 戰術背心（疊在軀幹上）
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.5, 0.5), new THREE.MeshStandardMaterial({
      color: 0x2a2823, roughness: 0.7, metalness: 0.05,
    }));
    vest.position.y = 0.95;
    vest.position.z = 0.02;
    vest.castShadow = true;
    group.add(vest);

    // 腿（兩條）
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3830, roughness: 0.9 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.3), legMat);
    legL.position.set(-0.18, 0.3, 0);
    legL.castShadow = true;
    group.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.18;
    group.add(legR);
    this.legL = legL; this.legR = legR;

    // 手臂 + M4
    const armMat = new THREE.MeshStandardMaterial({ color: 0x4a5040, roughness: 0.8 });
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.2), armMat);
    armL.position.set(-0.42, 1.05, 0);
    armL.castShadow = true;
    group.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.2), armMat);
    armR.position.set(0.42, 1.05, 0);
    armR.castShadow = true;
    group.add(armR);

    // 武器 group（本地座標：朝 -Z 方向是槍口）
    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0.25, 1.1, -0.3);

    const m4Body = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.18, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.6 })
    );
    m4Body.position.z = -0.3;
    m4Body.castShadow = true;
    weaponGroup.add(m4Body);

    const m4Mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.22, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1f1d1b, roughness: 0.6, metalness: 0.4 })
    );
    m4Mag.position.set(0, -0.18, -0.15);
    m4Mag.castShadow = true;
    weaponGroup.add(m4Mag);

    const m4Stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.13, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.5, metalness: 0.6 })
    );
    m4Stock.position.set(0, 0, 0.18);
    m4Stock.castShadow = true;
    weaponGroup.add(m4Stock);

    // 槍口位置（用一個空 Object3D 標記）
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.78);
    weaponGroup.add(this.muzzle);

    group.add(weaponGroup);
    this.weaponGroup = weaponGroup;

    this.mesh = group;
    this.scene.add(group);
  }

  reset(spawnPos) {
    this.hp = this.maxHp;
    this.position.copy(spawnPos);
    this.velocity.set(0, 0, 0);
    this.facing = 0;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = 0;
    this.game.weapon.reset();
  }

  damage(amount) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.game.audio.playHurt();
    this.game.postfx.setHurt(1.0);
    this.hitFlash = 0.3;
    // CSS damage vignette
    const v = document.getElementById('damage-vignette');
    if (v) {
      v.classList.add('hit');
      clearTimeout(this._dvTimer);
      this._dvTimer = setTimeout(() => v.classList.remove('hit'), 160);
    }
  }

  update(dt) {
    const input = this.game.input;
    const colliders = this.game.mapData.colliders;

    // 1) 滑鼠射線到 y=0 → aimWorld
    const ndc = new THREE.Vector2(input.mouse.ndcX, input.mouse.ndcY);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.game.camera);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1); // 玩家高度的水平面
    const aimPoint = new THREE.Vector3();
    if (!ray.ray.intersectPlane(groundPlane, aimPoint)) {
      aimPoint.copy(this.position).add(new THREE.Vector3(0, 1.1, -1));
    }
    this.aimWorld.copy(aimPoint);

    // 2) 朝向滑鼠（模型 local -Z 是正面/槍口方向，所以角度要 +π）
    const dx = aimPoint.x - this.position.x;
    const dz = aimPoint.z - this.position.z;
    this.facing = Math.atan2(dx, dz) + Math.PI;
    this.mesh.rotation.y = this.facing;

    // 3) 移動
    let vx = 0, vz = 0;
    if (input.isDown('KeyW')) vz -= 1;
    if (input.isDown('KeyS')) vz += 1;
    if (input.isDown('KeyA')) vx -= 1;
    if (input.isDown('KeyD')) vx += 1;
    const len = Math.hypot(vx, vz);
    if (len > 0) { vx /= len; vz /= len; }

    const sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const sp = this.speed * (sprinting ? this.sprintMul : 1);

    // 套用碰撞分軸解析
    const newPos = this.position.clone();
    newPos.x += vx * sp * dt;
    if (this._collides(newPos, colliders)) newPos.x = this.position.x;
    newPos.z += vz * sp * dt;
    if (this._collides(newPos, colliders)) newPos.z = this.position.z;

    // 邊界限制
    const half = this.game.mapData.bounds.half - 0.5;
    newPos.x = Math.max(-half, Math.min(half, newPos.x));
    newPos.z = Math.max(-half, Math.min(half, newPos.z));

    this.position.copy(newPos);
    this.mesh.position.copy(this.position);

    // 4) 腳步音效
    if (len > 0.1) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.game.audio.playStep(sprinting ? 0.9 : 0.5);
        this.stepTimer = sprinting ? 0.27 : 0.42;
      }
      // 腿擺動動畫
      const t = performance.now() * (sprinting ? 0.018 : 0.012);
      this.legL.rotation.x = Math.sin(t) * 0.45;
      this.legR.rotation.x = -Math.sin(t) * 0.45;
    } else {
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
    }

    // 5) 開槍 / 換彈
    if (input.consume('reload')) this.game.weapon.startReload();
    if (input.mouseDown || input.consume('fire')) {
      this.game.weapon.tryFire();
    }
  }

  _collides(pos, colliders) {
    const r = PLAYER_RADIUS;
    for (const c of colliders) {
      // 玩家是 y∈[0, height] 的立柱，腳座標 = pos.y
      if (c.max.y < 0.05) continue; // 不擋路（保留擴充用）
      const minX = c.min.x - r;
      const maxX = c.max.x + r;
      const minZ = c.min.z - r;
      const maxZ = c.max.z + r;
      if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
        return true;
      }
    }
    return false;
  }
}
