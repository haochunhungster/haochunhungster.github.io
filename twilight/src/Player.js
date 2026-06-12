import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight, WATER_Y, ISLAND_R } from './World.js';

const WALK_SPEED = 3.2;
const RUN_SPEED = 7.2;
const ROLL_SPEED = 13;
const ROLL_TIME = 0.45;
const ROLL_CD = 0.9;

export class Player {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 30);
    this.vel = new THREE.Vector3();
    this.heading = Math.PI;        // 模型面向
    this.yaw = Math.PI;            // 相機水平角
    this.pitch = 0.25;             // 相機俯角
    this.hp = 100;
    this.maxHp = 100;
    this.rolling = 0;
    this.rollCd = 0;
    this.rollDir = new THREE.Vector3();
    this.invulnerable = 0;
    this.dead = false;
    this.moving = false;
    this.running = false;
    this.keys = {};
    this.ready = false;

    // 模型容器：root(位置) > spin(翻滾旋轉) > model
    this.root = new THREE.Group();
    this.spin = new THREE.Group();
    this.root.add(this.spin);
    scene.add(this.root);
    this._camPos = new THREE.Vector3(0, 6, 38);
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('./assets/Soldier.glb');
    this.model = gltf.scene;
    this.model.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.model.rotation.y = Math.PI; // Soldier 原始面向 +Z，轉成面向 -Z 由 heading 控制
    this.spin.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    for (const name of ['Idle', 'Walk', 'Run']) {
      if (this.actions[name]) {
        this.actions[name].enabled = true;
        this.actions[name].setEffectiveWeight(name === 'Idle' ? 1 : 0);
        this.actions[name].play();
      }
    }
    this.current = 'Idle';
    this.ready = true;
  }

  bindInput(dom, weapon, onRoll) {
    this.aiming = false;
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'Space') { e.preventDefault(); this.tryRoll(onRoll); }
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
    dom.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== dom) return;
      const sens = this.aiming ? 0.0014 : 0.0024;
      this.yaw -= e.movementX * sens;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * sens * 0.85, -0.5, 1.1);
    });
    dom.addEventListener('mousedown', e => {
      if (document.pointerLockElement !== dom || this.dead) return;
      if (e.button === 0) weapon.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    dom.addEventListener('mouseup', e => {
      if (e.button === 0) weapon.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
  }

  tryRoll(onRoll) {
    if (this.dead || this.rolling > 0 || this.rollCd > 0) return;
    const dir = this._inputDir();
    if (dir.lengthSq() < 0.01) dir.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.rollDir.copy(dir).normalize();
    this.rolling = ROLL_TIME;
    this.rollCd = ROLL_CD;
    this.invulnerable = ROLL_TIME + 0.1;
    this.heading = Math.atan2(this.rollDir.x, this.rollDir.z);
    if (onRoll) onRoll();
  }

  _inputDir() {
    const f = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const r = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const dir = new THREE.Vector3();
    if (f || r) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      dir.set(sin * f - cos * r, 0, cos * f + sin * r);
      dir.normalize();
    }
    return dir;
  }

  // 準星射線方向（相機前方）
  aimDir() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return d;
  }

  muzzlePos() {
    return this.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
  }

  hurt(dmg) {
    if (this.invulnerable > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.invulnerable = 0.6;
    if (this.hp <= 0) this.dead = true;
    return true;
  }

  update(dt, world) {
    if (!this.ready) return;
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    let speed = 0;
    if (this.rolling > 0) {
      this.rolling -= dt;
      this.vel.copy(this.rollDir).multiplyScalar(ROLL_SPEED);
      // 前滾翻轉
      const k = 1 - Math.max(0, this.rolling) / ROLL_TIME;
      this.spin.rotation.x = -Math.PI * 2 * (k < 1 ? this._ease(k) : 1);
      if (this.rolling <= 0) this.spin.rotation.x = 0;
      speed = ROLL_SPEED;
    } else if (!this.dead) {
      const dir = this._inputDir();
      this.moving = dir.lengthSq() > 0.01;
      this.running = this.moving && !this.aiming && (this.keys['ShiftLeft'] || this.keys['ShiftRight']);
      speed = this.moving ? (this.running ? RUN_SPEED : WALK_SPEED) : 0;
      if (this.aiming) speed *= 0.6;
      this.vel.copy(dir).multiplyScalar(speed);
      // 瞄準時面向準星，移動時面向移動方向
      const target = this.aiming ? this.yaw
        : (this.moving ? Math.atan2(dir.x, dir.z) : this.heading);
      let d = target - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, dt * 12);
    } else {
      this.vel.set(0, 0, 0);
    }

    // 位移 + 碰撞
    this.pos.addScaledVector(this.vel, dt);
    world.collide(this.pos, 0.45);
    // 不准下海
    const h = terrainHeight(this.pos.x, this.pos.z);
    if (h < WATER_Y + 0.25) {
      const d = Math.hypot(this.pos.x, this.pos.z) || 1;
      this.pos.x -= (this.pos.x / d) * (speed + 1) * dt * 1.5;
      this.pos.z -= (this.pos.z / d) * (speed + 1) * dt * 1.5;
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ISLAND_R) {
      this.pos.x *= ISLAND_R / r;
      this.pos.z *= ISLAND_R / r;
    }
    this.pos.y = terrainHeight(this.pos.x, this.pos.z);

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;

    // 動畫狀態機
    let next = 'Idle';
    if (this.rolling > 0) next = 'Run';
    else if (this.moving) next = this.running ? 'Run' : 'Walk';
    if (next !== this.current) this._fadeTo(next, 0.22);
    this.mixer.update(dt);

    // 受傷閃爍
    if (this.model) {
      const flash = this.invulnerable > 0 && this.rolling <= 0 && Math.sin(this.invulnerable * 30) > 0;
      this.model.visible = !flash;
    }

    this._updateCamera(dt);
  }

  _ease(t) { return t * t * (3 - 2 * t); }

  _fadeTo(name, dur) {
    const from = this.actions[this.current], to = this.actions[name];
    if (!to) return;
    to.enabled = true;
    to.setEffectiveTimeScale(1);
    to.setEffectiveWeight(1);
    to.reset();
    if (from) from.crossFadeTo(to, dur, true);
    this.current = name;
  }

  _updateCamera(dt) {
    const aiming = this.aiming && !this.dead;
    const dist = aiming ? 2.3 : 4.4;
    // 肩後偏移（瞄準時偏右肩）
    const shoulder = aiming ? 0.55 : 0.18;
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw); // 相機右方向
    const head = this.pos.clone().add(new THREE.Vector3(rx * shoulder, 1.55, rz * shoulder));
    const off = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).multiplyScalar(dist);
    const target = head.clone().add(off);
    // 防穿地
    const minY = terrainHeight(target.x, target.z) + 0.45;
    if (target.y < minY) target.y = minY;
    this._camPos.lerp(target, 1 - Math.pow(aiming ? 0.000001 : 0.0001, dt));
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(head);
    // FOV 變焦
    const fovTarget = aiming ? 46 : 60;
    if (Math.abs(this.camera.fov - fovTarget) > 0.1) {
      this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }
  }
}
