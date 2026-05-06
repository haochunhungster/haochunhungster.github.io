import * as THREE from 'three';

import { Input } from './Input.js';
import { Audio } from './Audio.js';
import { Effects } from './Effects.js';
import { buildMap } from './Map.js';
import { setupPostfx } from './Postfx.js';
import { Player } from './Player.js';
import { Weapon } from './Weapon.js';
import { EnemyManager } from './Enemy.js';
import { UI } from './UI.js';

class Game {
  constructor() {
    this.state = 'menu';
    this.stats = { kills: 0, shots: 0, hits: 0, startTime: 0, elapsed: 0 };

    // --- Renderer ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(this.renderer.domElement);

    // --- Scene ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x14130f);
    this.scene.fog = new THREE.FogExp2(0x1a1812, 0.012);

    // --- Camera (斜俯 45°) ---
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);
    // 角度與距離在 Player.js 內每幀更新
    this.cameraOffset = new THREE.Vector3(0, 18, 14); // 高 18，後 14 → tilt ≈ 52°
    this.cameraTarget = new THREE.Vector3();
    this.cameraLerp = 0.12;

    // --- Lights ---
    const ambient = new THREE.AmbientLight(0x52606a, 0.85);
    this.scene.add(ambient);

    // 黃昏側光（塔可夫味的關鍵）
    const sun = new THREE.DirectionalLight(0xffd5a0, 2.2);
    sun.position.set(28, 38, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 38;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 100;
    sun.shadow.bias = -0.00045;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2.5;
    this.scene.add(sun);
    this.sun = sun;

    // 補光（淡藍冷色，營造對比）
    const fill = new THREE.DirectionalLight(0x6080a0, 0.35);
    fill.position.set(-18, 14, -10);
    this.scene.add(fill);

    // --- Hemisphere（讓暗部不要全黑） ---
    const hemi = new THREE.HemisphereLight(0x90a0b0, 0x2a2218, 0.55);
    this.scene.add(hemi);

    // --- Postfx ---
    this.postfx = setupPostfx(this.renderer, this.scene, this.camera);

    // --- Subsystems ---
    this.input = new Input(this.renderer.domElement);
    this.audio = new Audio();
    this.effects = new Effects(this.scene);

    // --- Map ---
    this.mapData = buildMap(this.scene);

    // --- Game entities ---
    this.weapon = new Weapon(this);
    this.player = new Player(this);
    this.enemies = new EnemyManager(this);

    // --- UI ---
    this.ui = new UI(this);
    this.ui.bindMenu(() => this.start());
    this.ui.bindRetry(() => this.start());
    this.ui.bindResume(() => this.resume());
    this.ui.bindQuit(() => this.quit());
    this.ui.bindNext(() => this.start());

    // --- Resize ---
    window.addEventListener('resize', () => this.onResize());

    // --- Loop ---
    this.clock = new THREE.Clock();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  start() {
    // 初次互動才能啟動 audio context
    this.audio.unlock();

    this.state = 'playing';
    this.stats = { kills: 0, shots: 0, hits: 0, startTime: performance.now(), elapsed: 0 };
    this.player.reset(this.mapData.spawn);
    this.enemies.reset(this.mapData.enemySpawns);
    this.effects.clear();
    this.mapData.extraction.reset();

    this.ui.showHUD();
    this.audio.startAmbient();
    this.input.lockPointer();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.showPause();
    this.input.unlockPointer();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hidePause();
    this.input.lockPointer();
  }

  quit() {
    this.state = 'menu';
    this.ui.showMenu();
    this.audio.stopAmbient();
    this.input.unlockPointer();
  }

  gameOver() {
    if (this.state !== 'playing') return;
    this.state = 'gameover';
    this.ui.showGameOver(this.stats);
    this.audio.play('death');
    this.audio.stopAmbient();
    this.input.unlockPointer();
  }

  victory() {
    if (this.state !== 'playing') return;
    this.state = 'victory';
    this.ui.showVictory(this.stats);
    this.audio.play('extracted');
    this.audio.stopAmbient();
    this.input.unlockPointer();
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx.composer.setSize(window.innerWidth, window.innerHeight);
  }

  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === 'playing') {
      this.stats.elapsed = (performance.now() - this.stats.startTime) / 1000;

      this.input.update();

      // ESC pause
      if (this.input.consume('pause')) {
        this.pause();
        return;
      }

      this.player.update(dt);
      this.weapon.update(dt);
      this.enemies.update(dt);
      this.effects.update(dt);
      this.postfx.update(dt);
      this.mapData.extraction.update(dt, this.player);

      // 鏡頭跟隨（斜俯，玩家位置 + 滑鼠位置中點微偏移）
      const aimOffset = this.player.aimWorld.clone().sub(this.player.position).multiplyScalar(0.18);
      aimOffset.y = 0;
      this.cameraTarget.copy(this.player.position).add(aimOffset);
      const desired = this.cameraTarget.clone().add(this.cameraOffset);
      this.camera.position.lerp(desired, this.cameraLerp);
      this.camera.lookAt(this.cameraTarget);

      this.ui.updateHUD();

      // 死亡
      if (this.player.hp <= 0) this.gameOver();
    } else if (this.state === 'menu') {
      // menu 時鏡頭緩慢繞行
      const t = performance.now() * 0.00015;
      this.camera.position.set(Math.cos(t) * 22, 14, Math.sin(t) * 22);
      this.camera.lookAt(0, 0, 0);
    }

    this.postfx.composer.render();
  }
}

window.addEventListener('error', (e) => {
  console.error('[Extraction] runtime error:', e.error || e.message);
});

new Game();
