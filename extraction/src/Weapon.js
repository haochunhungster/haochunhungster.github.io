import * as THREE from 'three';

// M4A1 規格
const M4 = {
  rpm: 720,            // 每分鐘 720 發
  damage: 34,          // 身體傷害（35*3 = 105，三槍致命）
  headshotMul: 3.2,    // 爆頭一槍致命
  magSize: 30,
  reserveStart: 90,
  reloadTime: 2.4,
  range: 60,
  recoilKick: 0.045,   // 鏡頭/槍口仰角
  spread: 0.012,       // 基礎散佈
  spreadMoveMul: 2.2,  // 移動時擴散倍率
  spreadSprintMul: 4,  // 衝刺時更慘
};

export class Weapon {
  constructor(game) {
    this.game = game;
    this.mag = M4.magSize;
    this.reserve = M4.reserveStart;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.fireInterval = 60 / M4.rpm;
    this.recoilOffset = 0; // 槍口當前後座（衰減回 0）
    this.recoilCam = 0;    // 鏡頭抖動

    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = M4.range;

    this._tmpDir = new THREE.Vector3();
    this._tmpOrigin = new THREE.Vector3();
  }

  reset() {
    this.mag = M4.magSize;
    this.reserve = M4.reserveStart;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.recoilOffset = 0;
    this.recoilCam = 0;
    document.getElementById('reload-indicator').classList.add('hidden');
  }

  tryFire() {
    if (this.reloading) return;
    if (this.fireCooldown > 0) return;
    if (this.mag <= 0) {
      this.game.audio.playEmpty();
      // 自動換彈
      if (this.reserve > 0) this.startReload();
      return;
    }
    this.fire();
  }

  fire() {
    const game = this.game;
    const player = game.player;

    this.mag--;
    this.fireCooldown = this.fireInterval;
    game.stats.shots++;

    // === 槍口位置（世界座標）===
    const muzzleWorld = new THREE.Vector3();
    player.muzzle.getWorldPosition(muzzleWorld);

    // === 射擊方向（朝瞄準點，加散佈）===
    // 模擬：彈道從槍口指向「玩家頭部高度的瞄準目標」
    const target = new THREE.Vector3(player.aimWorld.x, 1.2, player.aimWorld.z);
    const dir = target.clone().sub(muzzleWorld).normalize();

    // 散佈（基於是否移動）
    const moving = (game.input.isDown('KeyW') || game.input.isDown('KeyA') ||
                    game.input.isDown('KeyS') || game.input.isDown('KeyD'));
    const sprint = (game.input.isDown('ShiftLeft') || game.input.isDown('ShiftRight'));
    let spread = M4.spread;
    if (sprint) spread *= M4.spreadSprintMul;
    else if (moving) spread *= M4.spreadMoveMul;
    // 後座累積也加散佈
    spread += this.recoilOffset * 0.3;

    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    // === Raycast 命中 ===
    this._raycaster.set(muzzleWorld, dir);
    const targets = [...game.mapData.obstacles, ...game.enemies.aliveMeshes()];
    const hits = this._raycaster.intersectObjects(targets, false);

    let endPoint;
    if (hits.length > 0) {
      const h = hits[0];
      endPoint = h.point.clone();

      // 是否打到敵人
      const enemy = game.enemies.findByMesh(h.object);
      if (enemy) {
        const isHead = h.object.userData.bodyPart === 'head';
        const dmg = isHead ? M4.damage * M4.headshotMul : M4.damage;
        enemy.takeDamage(dmg, h.point, isHead);
        game.stats.hits++;
        game.effects.spawnBloodSplat(h.point);
        game.audio.playHit();
      } else {
        // 打到障礙：火星 + 彈孔
        const normal = h.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
        normal.transformDirection(h.object.matrixWorld);
        game.effects.spawnHitSparks(h.point, normal, 5);
        game.effects.spawnBulletDecal(h.point, normal);
      }
    } else {
      endPoint = muzzleWorld.clone().addScaledVector(dir, M4.range);
    }

    // === 視覺特效 ===
    game.effects.spawnTracer(muzzleWorld, endPoint);
    game.effects.spawnMuzzleFlash(muzzleWorld, dir);

    // 彈殼從右方拋出
    const ejectDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.facing);
    const casingPos = muzzleWorld.clone().add(ejectDir.clone().multiplyScalar(0.1)).add(new THREE.Vector3(0, 0.05, 0));
    game.effects.spawnCasing(casingPos, ejectDir);

    // === 後座力 ===
    this.recoilOffset = Math.min(0.18, this.recoilOffset + M4.recoilKick);
    this.recoilCam = Math.min(0.06, this.recoilCam + 0.02);

    // === 音效 ===
    game.audio.playShot();
  }

  startReload() {
    if (this.reloading) return;
    if (this.mag === M4.magSize) return;
    if (this.reserve === 0) return;

    this.reloading = true;
    this.reloadTimer = M4.reloadTime;
    this.game.audio.playReload();
    document.getElementById('reload-indicator').classList.remove('hidden');
  }

  update(dt) {
    if (this.fireCooldown > 0) this.fireCooldown -= dt;

    // 後座衰減
    this.recoilOffset = Math.max(0, this.recoilOffset - dt * 0.6);
    this.recoilCam = Math.max(0, this.recoilCam - dt * 0.4);

    // 把後座套到武器 mesh：仰角 + 後拉
    const wg = this.game.player.weaponGroup;
    wg.rotation.x = -this.recoilOffset;
    wg.position.z = -0.3 + this.recoilOffset * 0.4;

    // 鏡頭微抖（透過 cameraOffset 加偏移）
    if (this.recoilCam > 0) {
      const r = this.recoilCam;
      this.game.cameraOffset.set(
        (Math.random() - 0.5) * r * 0.5,
        18 + (Math.random() - 0.5) * r * 0.3,
        14 + (Math.random() - 0.5) * r * 0.5,
      );
    } else {
      this.game.cameraOffset.set(0, 18, 14);
    }

    // 換彈進度
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const need = M4.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloading = false;
        document.getElementById('reload-indicator').classList.add('hidden');
      }
    }
  }
}
