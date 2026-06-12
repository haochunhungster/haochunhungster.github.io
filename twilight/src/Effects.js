import * as THREE from 'three';

// ---------- CPU 粒子池 ----------
class ParticlePool {
  constructor(scene, count = 600) {
    this.count = count;
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.14, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push({ life: 0, max: 1, vel: new THREE.Vector3(), pos: new THREE.Vector3(), col: new THREE.Color(), grav: 0 });
      this.positions[i * 3 + 1] = -999;
    }
    this.cursor = 0;
  }

  emit(pos, color, n, speed, life = 0.8, grav = -4) {
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.cursor];
      this.cursor = (this.cursor + 1) % this.count;
      p.life = p.max = life * (0.6 + Math.random() * 0.6);
      p.pos.copy(pos);
      p.vel.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      p.col.set(color);
      p.grav = grav;
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      if (p.life <= 0) { this.positions[i * 3 + 1] = -999; continue; }
      p.life -= dt;
      p.vel.y += p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      this.positions[i * 3] = p.pos.x;
      this.positions[i * 3 + 1] = p.pos.y;
      this.positions[i * 3 + 2] = p.pos.z;
      const k = Math.max(0, p.life / p.max);
      this.colors[i * 3] = p.col.r * k;
      this.colors[i * 3 + 1] = p.col.g * k;
      this.colors[i * 3 + 2] = p.col.b * k;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------- 暮輝法球 ----------
const ORB_SPEED = 26;
const ORB_LIFE = 1.6;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pool = new ParticlePool(scene);
    this.orbs = [];
    this.orbGeo = new THREE.SphereGeometry(0.16, 12, 12);
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0xffd890 });
  }

  shootOrb(origin, dir) {
    const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
    mesh.position.copy(origin);
    const light = new THREE.PointLight(0xffc060, 2.5, 5, 2);
    mesh.add(light);
    this.scene.add(mesh);
    this.orbs.push({ mesh, vel: dir.clone().multiplyScalar(ORB_SPEED), life: ORB_LIFE });
  }

  burst(pos, color, n = 24, speed = 7) {
    this.pool.emit(pos, color, n, speed, 0.9, -5);
  }

  softBurst(pos, color, n = 16, speed = 3) {
    this.pool.emit(pos, color, n, speed, 1.3, 1.5);
  }

  // enemies: Enemy[]；回傳本幀被命中的敵人列表
  update(dt, enemies, terrainHeightFn) {
    this.pool.update(dt);
    const hits = [];
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      o.mesh.position.addScaledVector(o.vel, dt);
      // 拖尾
      this.pool.emit(o.mesh.position, 0xffc878, 1, 0.5, 0.4, 0);
      let dead = o.life <= 0;
      // 撞地形
      if (!dead && o.mesh.position.y < terrainHeightFn(o.mesh.position.x, o.mesh.position.z)) {
        this.burst(o.mesh.position, 0xffb060, 14, 4);
        dead = true;
      }
      // 撞敵人
      if (!dead) {
        for (const e of enemies) {
          if (!e.alive) continue;
          if (o.mesh.position.distanceTo(e.pos) < 0.85) {
            hits.push({ enemy: e, dir: o.vel.clone().normalize(), pos: o.mesh.position.clone() });
            this.burst(o.mesh.position, 0xffd890, 22, 8);
            dead = true;
            break;
          }
        }
      }
      if (dead) {
        this.scene.remove(o.mesh);
        this.orbs.splice(i, 1);
      }
    }
    return hits;
  }
}
