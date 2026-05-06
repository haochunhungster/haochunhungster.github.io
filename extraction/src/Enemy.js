import * as THREE from 'three';

const STATE = {
  IDLE: 'idle',
  ALERT: 'alert',
  CHASE: 'chase',
  DEAD: 'dead',
};

const ENEMY_RADIUS = 0.45;
const VIEW_DIST = 22;
const VIEW_FOV_COS = Math.cos(THREE.MathUtils.degToRad(55)); // 110° 視野
const HEARING_DIST = 16; // 玩家開槍時的聽覺感知範圍

class Enemy {
  constructor(manager, position) {
    this.mgr = manager;
    this.scene = manager.scene;
    this.position = position.clone();
    this.facing = Math.random() * Math.PI * 2;
    this.hp = 100;
    this.state = STATE.IDLE;
    this.speed = 3.0;
    this.fireCooldown = 0;
    this.fireInterval = 0.6;
    this.shotsBurst = 0;       // burst 內已開的槍數
    this.burstCooldown = 0;     // burst 之間的冷卻
    this.lastSeenPlayer = new THREE.Vector3();
    this.alertTimer = 0;
    this.target = position.clone(); // 巡邏目標
    this.patrolTimer = 0;

    // === 視覺 ===
    const group = new THREE.Group();

    // 軀幹（深色衣物）
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.9, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x3a2a25, roughness: 0.9, metalness: 0.05 })
    );
    torso.position.y = 1.0;
    torso.castShadow = true;
    torso.userData.bodyPart = 'body';
    group.add(torso);

    // 戰術背心（深紅色滾邊區別敵我）
    const vest = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x4a1f18, roughness: 0.7, metalness: 0.05 })
    );
    vest.position.y = 0.95;
    vest.position.z = 0.03;
    vest.castShadow = true;
    vest.userData.bodyPart = 'body';
    group.add(vest);

    // 頭
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.5, metalness: 0.4 })
    );
    head.position.y = 1.65;
    head.castShadow = true;
    head.userData.bodyPart = 'head';
    group.add(head);

    // 腿
    const legMat = new THREE.MeshStandardMaterial({ color: 0x222220, roughness: 0.95 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.3), legMat);
    legL.position.set(-0.18, 0.3, 0);
    legL.castShadow = true;
    legL.userData.bodyPart = 'body';
    group.add(legL);
    const legR = legL.clone();
    legR.position.x = 0.18;
    legR.userData.bodyPart = 'body';
    group.add(legR);
    this.legL = legL; this.legR = legR;

    // 武器（簡化的 AK 黑塊）
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.14, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x111110, roughness: 0.4, metalness: 0.5 })
    );
    gun.position.set(0.2, 1.05, -0.25);
    gun.castShadow = true;
    gun.userData.bodyPart = 'body';
    group.add(gun);
    this.gun = gun;

    // 槍口位置
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0.2, 1.05, -0.6);
    group.add(this.muzzle);

    // 警覺指示器（頭頂感嘆號 / 問號）
    this.alertIcon = null;

    group.position.copy(position);
    group.rotation.y = this.facing;
    this.mesh = group;

    // 收集所有命中部位 mesh
    this.hitMeshes = [torso, vest, head, legL, legR, gun];

    this.scene.add(group);
  }

  destroy() {
    this.scene.remove(this.mesh);
  }

  takeDamage(amount, hitPoint, isHead) {
    if (this.state === STATE.DEAD) return;
    this.hp -= amount;
    // 受擊抽搐
    this.mesh.position.x += (Math.random() - 0.5) * 0.05;
    this.mesh.position.z += (Math.random() - 0.5) * 0.05;
    // 觸發警戒（被打到一定知道玩家在哪）
    this.state = STATE.CHASE;
    this.lastSeenPlayer.copy(this.mgr.game.player.position);
    this.alertTimer = 5;

    if (this.hp <= 0) this.die(hitPoint, isHead);
  }

  die(hitPoint, isHead) {
    this.state = STATE.DEAD;
    this.mgr.game.stats.kills++;
    this.mgr.game.audio.playKill();

    // 倒地動畫（簡化）：旋轉 90°
    const fall = isHead ? Math.PI / 2 : Math.PI / 2.2;
    this.mesh.rotation.x = -fall;
    this.mesh.position.y = 0.4;

    // 5 秒後從場景移除
    setTimeout(() => {
      if (this.mesh.parent) this.scene.remove(this.mesh);
    }, 6000);
  }

  // 視野檢查
  canSeePlayer() {
    const player = this.mgr.game.player;
    const toPlayer = player.position.clone().sub(this.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    if (dist > VIEW_DIST) return false;
    toPlayer.normalize();

    // 朝向錐角檢查（mesh local -Z 是正面，所以世界 forward 取負）
    const forward = new THREE.Vector3(-Math.sin(this.facing), 0, -Math.cos(this.facing));
    if (forward.dot(toPlayer) < VIEW_FOV_COS) return false;

    // 遮擋
    const origin = new THREE.Vector3(this.position.x, 1.4, this.position.z);
    const target = new THREE.Vector3(player.position.x, 1.4, player.position.z);
    const dir = target.clone().sub(origin).normalize();
    const ray = this.mgr._ray;
    ray.set(origin, dir);
    ray.far = dist;
    const obstacles = this.mgr.game.mapData.obstacles;
    const hits = ray.intersectObjects(obstacles, false);
    if (hits.length > 0) return false;
    return true;
  }

  fireAt(playerPos) {
    if (this.fireCooldown > 0) return;
    if (this.burstCooldown > 0) return;

    // burst 模式：3 發 / burst, burst 間隔 0.8s
    const dir = new THREE.Vector3(playerPos.x, 1.4, playerPos.z).sub(
      new THREE.Vector3(this.position.x, 1.4, this.position.z)
    ).normalize();

    // 散佈（敵人較不準）
    const spread = 0.06;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread * 0.5;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const origin = new THREE.Vector3(this.position.x, 1.4, this.position.z);

    // 命中判定：raycast 看是否被遮擋 + 玩家圓柱體
    const ray = this.mgr._ray;
    ray.set(origin, dir);
    ray.far = 50;
    const obstacles = this.mgr.game.mapData.obstacles;
    const obsHits = ray.intersectObjects(obstacles, false);
    const obsDist = obsHits.length > 0 ? obsHits[0].distance : 999;

    // 玩家命中：把玩家視為圓柱體（簡化為圓盤投影）
    const player = this.mgr.game.player;
    const playerPosV = new THREE.Vector3(player.position.x, 1.1, player.position.z);
    const t = playerPosV.clone().sub(origin).dot(dir);
    let hitPlayer = false;
    if (t > 0 && t < obsDist) {
      const closest = origin.clone().addScaledVector(dir, t);
      const distToLine = closest.distanceTo(playerPosV);
      if (distToLine < 0.55) hitPlayer = true;
    }

    // 視覺：tracer + muzzle flash
    const muzzleWorld = new THREE.Vector3();
    this.muzzle.getWorldPosition(muzzleWorld);
    let endPoint;
    if (obsHits.length > 0 && (!hitPlayer || obsDist < t)) {
      endPoint = obsHits[0].point.clone();
      const normal = obsHits[0].face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
      normal.transformDirection(obsHits[0].object.matrixWorld);
      this.mgr.game.effects.spawnHitSparks(obsHits[0].point, normal, 3);
    } else {
      endPoint = origin.clone().addScaledVector(dir, 30);
    }
    this.mgr.game.effects.spawnTracer(muzzleWorld, endPoint);
    this.mgr.game.effects.spawnMuzzleFlash(muzzleWorld, dir);
    this.mgr.game.audio.playShot();

    if (hitPlayer) {
      player.damage(8 + Math.random() * 4); // 8-12 傷害
    }

    this.fireCooldown = 0.13; // 連發間隔
    this.shotsBurst++;
    if (this.shotsBurst >= 3) {
      this.shotsBurst = 0;
      this.burstCooldown = 0.7 + Math.random() * 0.4;
    }
  }

  update(dt) {
    if (this.state === STATE.DEAD) return;

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.burstCooldown > 0) this.burstCooldown -= dt;

    const player = this.mgr.game.player;
    const seen = this.canSeePlayer();
    if (seen) {
      this.lastSeenPlayer.copy(player.position);
      this.state = STATE.CHASE;
      this.alertTimer = 5;
    } else if (this.alertTimer > 0) {
      this.alertTimer -= dt;
    } else if (this.state === STATE.CHASE) {
      this.state = STATE.IDLE;
    }

    // 行為
    if (this.state === STATE.CHASE) {
      // 朝最後位置移動，但與玩家保持 8m 距離
      const target = this.lastSeenPlayer;
      const toTarget = target.clone().sub(this.position);
      toTarget.y = 0;
      const dist = toTarget.length();
      toTarget.normalize();

      // 朝向玩家
      this.facing = Math.atan2(toTarget.x, toTarget.z) + Math.PI;
      this.mesh.rotation.y = this.facing;

      // 開槍（看得見且距離合理）
      if (seen && dist < 25 && dist > 1.5) {
        this.fireAt(player.position);
      }

      // 移動：靠近到 7m 就停下射擊；否則接近
      let moveDir = null;
      if (!seen) {
        // 走向最後位置
        if (dist > 0.5) moveDir = toTarget;
      } else if (dist > 9) {
        moveDir = toTarget;
      } else if (dist < 5) {
        // 太近就後退
        moveDir = toTarget.clone().multiplyScalar(-1);
      }

      if (moveDir) this._move(moveDir, dt);
    } else {
      // 巡邏：隨機走動
      this.patrolTimer -= dt;
      if (this.patrolTimer <= 0) {
        this.target.set(
          this.position.x + (Math.random() - 0.5) * 12,
          0,
          this.position.z + (Math.random() - 0.5) * 12
        );
        const half = this.mgr.game.mapData.bounds.half - 1;
        this.target.x = Math.max(-half, Math.min(half, this.target.x));
        this.target.z = Math.max(-half, Math.min(half, this.target.z));
        this.patrolTimer = 3 + Math.random() * 4;
      }
      const toT = this.target.clone().sub(this.position);
      toT.y = 0;
      const d = toT.length();
      if (d > 0.5) {
        toT.normalize();
        this.facing = Math.atan2(toT.x, toT.z) + Math.PI;
        this.mesh.rotation.y = this.facing;
        this._move(toT, dt, 0.5); // 巡邏速度減半
      }
    }

    // 腿擺動
    const moving = this.state === STATE.CHASE || (this.target.distanceTo(this.position) > 0.5);
    if (moving) {
      const t = performance.now() * 0.013;
      this.legL.rotation.x = Math.sin(t) * 0.45;
      this.legR.rotation.x = -Math.sin(t) * 0.45;
    }
  }

  _move(dir, dt, speedMul = 1.0) {
    const sp = this.speed * speedMul;
    const newPos = this.position.clone();
    newPos.x += dir.x * sp * dt;
    if (this._collides(newPos)) newPos.x = this.position.x;
    newPos.z += dir.z * sp * dt;
    if (this._collides(newPos)) newPos.z = this.position.z;
    this.position.copy(newPos);
    this.mesh.position.copy(this.position);
  }

  _collides(pos) {
    const r = ENEMY_RADIUS;
    const colliders = this.mgr.game.mapData.colliders;
    for (const c of colliders) {
      if (c.max.y < 0.05) continue;
      if (pos.x > c.min.x - r && pos.x < c.max.x + r &&
          pos.z > c.min.z - r && pos.z < c.max.z + r) return true;
    }
    return false;
  }
}

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.enemies = [];
    this._ray = new THREE.Raycaster();
  }

  reset(spawns) {
    for (const e of this.enemies) e.destroy();
    this.enemies = [];
    for (const s of spawns) {
      this.enemies.push(new Enemy(this, s));
    }
  }

  update(dt) {
    for (const e of this.enemies) e.update(dt);
  }

  aliveCount() {
    return this.enemies.filter(e => e.state !== STATE.DEAD).length;
  }

  aliveMeshes() {
    const out = [];
    for (const e of this.enemies) {
      if (e.state !== STATE.DEAD) out.push(...e.hitMeshes);
    }
    return out;
  }

  findByMesh(mesh) {
    for (const e of this.enemies) {
      if (e.state === STATE.DEAD) continue;
      if (e.hitMeshes.includes(mesh)) return e;
    }
    return null;
  }
}
