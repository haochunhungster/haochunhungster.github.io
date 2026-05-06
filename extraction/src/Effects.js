import * as THREE from 'three';

// 集合：槍口閃光 / 彈殼 / 命中火星 / 彈孔 decal / tracer
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // 池
    this.tracers = [];
    this.sparks = [];
    this.casings = [];
    this.flashes = [];
    this.bloodSplats = [];
    this.decals = [];

    // 共用幾何 / 材質
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 1, depthWrite: false });

    this.sparkGeo = new THREE.SphereGeometry(0.04, 4, 3);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd070 });

    this.casingGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.1, 6);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xc89a4c, roughness: 0.4, metalness: 0.9 });

    this.flashGeo = new THREE.PlaneGeometry(0.6, 0.6);
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xfff2a0, transparent: true, opacity: 1, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0xc12818 });

    this.decalMat = new THREE.MeshBasicMaterial({
      color: 0x0a0807, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.decalGeo = new THREE.PlaneGeometry(0.18, 0.18);
  }

  clear() {
    for (const arr of [this.tracers, this.sparks, this.casings, this.flashes, this.bloodSplats, this.decals]) {
      for (const e of arr) this.group.remove(e.mesh || e.line);
      arr.length = 0;
    }
  }

  spawnTracer(from, to) {
    const points = [from.clone(), to.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    line.material.opacity = 0.95;
    this.group.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  spawnMuzzleFlash(position, dir) {
    const mesh = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    mesh.position.copy(position);
    mesh.lookAt(position.clone().add(dir));
    mesh.rotation.z = Math.random() * Math.PI;
    this.group.add(mesh);
    this.flashes.push({ mesh, life: 0.06 });

    // 動態點光
    const light = new THREE.PointLight(0xffe2a0, 4, 7, 2);
    light.position.copy(position);
    this.group.add(light);
    this.flashes.push({ mesh: light, life: 0.06, isLight: true });
  }

  spawnHitSparks(position, normal, count = 6) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.position.copy(position);
      const v = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 0.8,
        normal.y + Math.random() * 0.8,
        normal.z + (Math.random() - 0.5) * 0.8
      ).normalize().multiplyScalar(3 + Math.random() * 4);
      this.group.add(m);
      this.sparks.push({ mesh: m, vel: v, life: 0.35 });
    }
  }

  spawnCasing(position, ejectDir) {
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(position);
    m.rotation.set(Math.random(), Math.random(), Math.random());
    this.group.add(m);
    const v = new THREE.Vector3(
      ejectDir.x * (3 + Math.random() * 1.5),
      4 + Math.random() * 1.5,
      ejectDir.z * (3 + Math.random() * 1.5),
    );
    this.casings.push({
      mesh: m,
      vel: v,
      angVel: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
      life: 1.5,
    });
  }

  spawnBloodSplat(position) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 4, 3);
      const m = new THREE.Mesh(geo, this.bloodMat);
      m.position.copy(position);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        Math.random() * 3,
        (Math.random() - 0.5) * 4
      );
      this.group.add(m);
      this.bloodSplats.push({ mesh: m, vel: v, life: 0.6 });
    }
  }

  spawnBulletDecal(position, normal) {
    const m = new THREE.Mesh(this.decalGeo, this.decalMat.clone());
    m.position.copy(position).addScaledVector(normal, 0.012);
    // 對齊法線
    const up = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const target = position.clone().addScaledVector(normal, 1);
    m.lookAt(target);
    m.material.opacity = 0.85 + Math.random() * 0.1;
    m.scale.setScalar(0.7 + Math.random() * 0.6);
    this.group.add(m);
    this.decals.push({ mesh: m, life: 12 }); // 12 秒後淡出
    // 限制總數
    if (this.decals.length > 60) {
      const old = this.decals.shift();
      this.group.remove(old.mesh);
    }
  }

  update(dt) {
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.06);
      if (t.life <= 0) {
        this.group.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    // flashes
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.isLight) {
        f.mesh.intensity = Math.max(0, f.life / 0.06) * 4;
      } else {
        f.mesh.material.opacity = Math.max(0, f.life / 0.06);
        f.mesh.scale.setScalar(1 + (1 - f.life / 0.06) * 0.5);
      }
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        if (!f.isLight) f.mesh.material.dispose();
        this.flashes.splice(i, 1);
      }
    }
    // sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.vel.y -= 12 * dt; // 重力
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.life <= 0) {
        this.group.remove(s.mesh);
        this.sparks.splice(i, 1);
      }
    }
    // casings
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vel.y -= 18 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      if (c.mesh.position.y < 0.05) {
        c.mesh.position.y = 0.05;
        c.vel.y = -c.vel.y * 0.3;
        c.vel.x *= 0.55; c.vel.z *= 0.55;
      }
      c.mesh.rotation.x += c.angVel.x * dt;
      c.mesh.rotation.y += c.angVel.y * dt;
      c.mesh.rotation.z += c.angVel.z * dt;
      if (c.life <= 0) {
        this.group.remove(c.mesh);
        this.casings.splice(i, 1);
      }
    }
    // blood
    for (let i = this.bloodSplats.length - 1; i >= 0; i--) {
      const b = this.bloodSplats[i];
      b.life -= dt;
      b.vel.y -= 9 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bloodSplats.splice(i, 1);
      }
    }
    // decals fade
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life < 2) d.mesh.material.opacity = Math.max(0, d.life / 2) * 0.85;
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        d.mesh.material.dispose();
        this.decals.splice(i, 1);
      }
    }
  }
}
