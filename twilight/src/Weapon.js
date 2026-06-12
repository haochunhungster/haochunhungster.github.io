import * as THREE from 'three';
import { terrainHeight } from './World.js';

const FIRE_INTERVAL = 0.11;   // ~9 發/秒
const RANGE = 130;
const TRACER_LIFE = 0.07;

export class Weapon {
  constructor(scene, camera, effects, audio) {
    this.scene = scene;
    this.camera = camera;
    this.effects = effects;
    this.audio = audio;
    this.firing = false;
    this.cd = 0;
    this.recoil = 0;

    // 曳光池
    this.tracers = [];
    const geo = new THREE.BoxGeometry(0.07, 0.07, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd890, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    // 槍口閃光燈（共用一盞，閃完即滅）
    this.muzzleLight = new THREE.PointLight(0xffc060, 0, 9, 2);
    scene.add(this.muzzleLight);
    this.muzzleTimer = 0;
  }

  // 每幀：回傳本幀命中的敵人（或 null）
  update(dt, player, enemies, world) {
    this.cd = Math.max(0, this.cd - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.muzzleTimer -= dt;
    if (this.muzzleTimer <= 0) this.muzzleLight.intensity *= 0.6;

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / TRACER_LIFE);
      if (t.life <= 0) t.mesh.visible = false;
    }

    if (!this.firing || this.cd > 0 || player.dead || player.rolling > 0) return null;
    this.cd = FIRE_INTERVAL;
    return this._fire(player, enemies);
  }

  _fire(player, enemies) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    // 散佈（移動中略增）
    const spread = 0.006 + (player.moving ? 0.012 : 0) + this.recoil * 0.012;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    // 1) 敵人：射線-球體最近命中
    let hitEnemy = null, hitDist = RANGE;
    const toE = new THREE.Vector3();
    for (const e of enemies) {
      if (!e.alive) continue;
      toE.subVectors(e.pos, origin);
      const along = toE.dot(dir);
      if (along < 0 || along > hitDist) continue;
      const perp2 = toE.lengthSq() - along * along;
      if (perp2 < 0.75 * 0.75) { hitEnemy = e; hitDist = along; }
    }

    // 2) 地形：步進檢測（只找比敵人更近的遮擋）
    const p = origin.clone();
    const step = dir.clone().multiplyScalar(0.9);
    let terrDist = -1;
    for (let d = 0.9; d < hitDist; d += 0.9) {
      p.add(step);
      if (p.y < terrainHeight(p.x, p.z)) { terrDist = d; break; }
    }
    let endDist = hitDist, hitPoint;
    if (terrDist > 0 && terrDist < hitDist) {
      hitEnemy = null;
      endDist = terrDist;
    }
    if (!hitEnemy && terrDist < 0) endDist = Math.min(endDist, 60); // 射空時曳光別拖到天邊
    hitPoint = origin.clone().addScaledVector(dir, endDist);

    // 槍口（角色胸前偏前方）
    const muzzle = player.muzzlePos().addScaledVector(dir, 0.7);

    // 曳光
    const t = this.tracers.find(t => t.life <= 0) || this.tracers[0];
    const len = muzzle.distanceTo(hitPoint);
    t.mesh.visible = true;
    t.mesh.scale.set(1, 1, len);
    t.mesh.position.lerpVectors(muzzle, hitPoint, 0.5);
    t.mesh.lookAt(hitPoint);
    t.mesh.material.opacity = 1;
    t.life = TRACER_LIFE;

    // 槍口閃光
    this.muzzleLight.position.copy(muzzle);
    this.muzzleLight.intensity = 8;
    this.muzzleTimer = 0.05;
    this.effects.pool.emit(muzzle, 0xffc878, 3, 2.5, 0.15, 0);

    // 命中反饋
    if (hitEnemy) {
      this.effects.burst(hitPoint, 0xd890ff, 10, 5);
      this.audio.hitEnemy();
    } else if (endDist < RANGE) {
      this.effects.pool.emit(hitPoint, 0xc8a878, 8, 3.5, 0.5, -6);
    }

    this.recoil = Math.min(1.6, this.recoil + 0.45);
    player.pitch -= 0.0042; // 後座力上踢
    this.audio.shoot();
    player.heading = player.yaw; // 開火時角色面向準星
    return hitEnemy ? { enemy: hitEnemy, dir, pos: hitPoint } : null;
  }
}
