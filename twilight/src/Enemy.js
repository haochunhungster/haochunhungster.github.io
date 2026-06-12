import * as THREE from 'three';
import { terrainHeight } from './World.js';

const CHASE_RANGE = 13;
const HIT_RANGE = 1.3;
const SPEED_PATROL = 1.4;
const SPEED_CHASE = 5.2;

let coreGeo = null, shardGeo = null;

export class Enemy {
  constructor(scene, x, z, anchor) {
    this.scene = scene;
    this.anchor = anchor;     // 巡邏中心（聖物位置）
    this.pos = new THREE.Vector3(x, 0, z);
    this.hp = 5;
    this.alive = true;
    this.state = 'patrol';
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.bobPhase = Math.random() * 9;
    this.attackCd = 0;
    this.knock = new THREE.Vector3();

    if (!coreGeo) {
      coreGeo = new THREE.IcosahedronGeometry(0.42, 1);
      shardGeo = new THREE.TetrahedronGeometry(0.16);
    }
    this.group = new THREE.Group();
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x3a1a4a, emissive: 0xb04aff, emissiveIntensity: 1.8,
      roughness: 0.3, metalness: 0.2,
    });
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.core.castShadow = true;
    this.group.add(this.core);

    // 半透明外殼
    this.shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.68, 1),
      new THREE.MeshBasicMaterial({
        color: 0x9a3aff, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.group.add(this.shell);

    // 環繞碎石
    this.shards = [];
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x4a4055, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(shardGeo, shardMat);
      s.userData.a = (i / 5) * Math.PI * 2;
      s.userData.r = 0.85 + Math.random() * 0.25;
      s.userData.ys = Math.random() * 6;
      this.group.add(s);
      this.shards.push(s);
    }
    // 不掛 PointLight——forward renderer 光源數是效能殺手，發光感交給 emissive + bloom
    scene.add(this.group);
  }

  takeHit(force) {
    this.hp--;
    this.knock.copy(force);
    this.coreMat.emissiveIntensity = 6;
    if (this.hp <= 0) {
      this.alive = false;
      this.scene.remove(this.group);
      return true; // 死亡
    }
    return false;
  }

  update(dt, t, playerPos, playerAlive) {
    if (!this.alive) return null;
    let result = null;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.coreMat.emissiveIntensity = THREE.MathUtils.lerp(this.coreMat.emissiveIntensity, 1.8, dt * 5);

    const distToPlayer = this.pos.distanceTo(playerPos);
    if (playerAlive && distToPlayer < CHASE_RANGE) this.state = 'chase';
    else if (this.state === 'chase' && distToPlayer > CHASE_RANGE * 1.5) this.state = 'patrol';

    const move = new THREE.Vector3();
    if (this.state === 'chase' && playerAlive) {
      move.subVectors(playerPos, this.pos).setY(0).normalize().multiplyScalar(SPEED_CHASE);
      if (distToPlayer < HIT_RANGE && this.attackCd <= 0) {
        this.attackCd = 1.1;
        result = 'hit';
        // 攻擊後彈開一點
        this.knock.subVectors(this.pos, playerPos).setY(0).normalize().multiplyScalar(6);
      }
    } else {
      this.patrolAngle += dt * 0.35;
      const tx = this.anchor.x + Math.cos(this.patrolAngle) * 5;
      const tz = this.anchor.z + Math.sin(this.patrolAngle) * 5;
      move.set(tx - this.pos.x, 0, tz - this.pos.z);
      if (move.lengthSq() > 0.2) move.normalize().multiplyScalar(SPEED_PATROL);
    }

    move.add(this.knock);
    this.knock.multiplyScalar(Math.pow(0.02, dt));
    this.pos.addScaledVector(move, dt);

    const groundY = Math.max(terrainHeight(this.pos.x, this.pos.z), 0);
    this.pos.y = groundY + 1.2 + Math.sin(t * 2 + this.bobPhase) * 0.18;
    this.group.position.copy(this.pos);

    // 視覺律動
    this.core.rotation.x = t * 0.9 + this.bobPhase;
    this.core.rotation.y = t * 1.3;
    const agitated = this.state === 'chase' ? 2.2 : 1;
    this.shell.scale.setScalar(1 + Math.sin(t * 5 * agitated) * 0.08);
    for (const s of this.shards) {
      const a = s.userData.a + t * 1.4 * agitated;
      s.position.set(
        Math.cos(a) * s.userData.r,
        Math.sin(t * 1.8 + s.userData.ys) * 0.3,
        Math.sin(a) * s.userData.r
      );
      s.rotation.x = t * 2; s.rotation.y = t * 1.5;
    }
    this.coreMat.emissiveIntensity = Math.max(
      this.coreMat.emissiveIntensity,
      this.state === 'chase' ? 3.2 : 1.8
    );
    return result;
  }
}
