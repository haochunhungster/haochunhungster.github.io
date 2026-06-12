import * as THREE from 'three';
import { World, terrainHeight } from './World.js';
import { Player } from './Player.js';
import { Enemy } from './Enemy.js';
import { Effects } from './Effects.js';
import { Weapon } from './Weapon.js';
import { createPostfx } from './Postfx.js';
import { GameAudio } from './Audio.js';

const $ = id => document.getElementById(id);

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
$('canvas-wrap').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);

// ---------- GPU 分級：獨顯解鎖 ULTRA ----------
function detectQuality() {
  let gpu = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
  } catch (e) { /* 拿不到就走保守檔 */ }
  const ultra = /NVIDIA|GeForce|RTX|Radeon RX/i.test(gpu);
  return ultra
    ? { grass: 90000, trees: 150, fireflies: 480, shadow: 4096 }
    : { grass: 30000, trees: 110, fireflies: 220, shadow: 2048 };
}

// ---------- 系統 ----------
const world = new World(scene, renderer, detectQuality());
const player = new Player(scene, camera);
const effects = new Effects(scene);
const audio = new GameAudio();
const composer = createPostfx(renderer, scene, camera);

// ---------- 動態解析度：保 60fps，獨顯吃滿、內顯自動降載 ----------
const RES_CAP = Math.min(window.devicePixelRatio, 2);
let resScale = RES_CAP;
function applyRes() {
  renderer.setPixelRatio(resScale);
  composer.setPixelRatio(resScale);
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}
applyRes();

let fpsFrames = 0, fpsTime = 0;
function autoRes(dt) {
  fpsFrames++; fpsTime += dt;
  if (fpsTime < 1.5) return;
  const fps = fpsFrames / fpsTime;
  fpsFrames = 0; fpsTime = 0;
  if (fps < 20 && resScale > 0.6) {
    resScale = Math.max(0.6, resScale * 0.6);
    applyRes();
  } else if (fps < 45 && resScale > 0.6) {
    resScale = Math.max(0.6, resScale - 0.2);
    applyRes();
  } else if (fps > 57 && resScale < RES_CAP) {
    resScale = Math.min(RES_CAP, resScale + 0.25);
    applyRes();
  }
}

// 敵人：每枚非中央聖物 2 隻守衛 + 中央 2 隻
const enemies = [];
function spawnEnemies() {
  for (const e of enemies) if (e.alive) scene.remove(e.group);
  enemies.length = 0;
  for (const r of world.relics) {
    const n = 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 3;
      enemies.push(new Enemy(scene, r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, { x: r.x, z: r.z }));
    }
  }
}

// ---------- 遊戲狀態 ----------
let state = 'title'; // title | playing | win | lose
let relicCount = 0;
let killCount = 0;
let startTime = 0;
let hintTimer = 0;

const slots = document.querySelectorAll('.relic-slot');

function showHint(text, dur = 3) {
  $('hint').textContent = text;
  $('hint').classList.add('show');
  hintTimer = dur;
}

function resetGame() {
  player.pos.set(0, 0, 34);
  player.hp = player.maxHp;
  player.dead = false;
  player.rolling = 0;
  player.invulnerable = 1.5;
  relicCount = 0;
  killCount = 0;
  for (const r of world.relics) {
    r.taken = false;
    r.group.visible = true;
  }
  world.portalActive = false;
  world.portal.plane.material.opacity = 0;
  world.portal.light.intensity = 0;
  slots.forEach(s => s.classList.remove('got'));
  weapon.firing = false;
  player.aiming = false;
  $('hpfill').style.width = '100%';
  spawnEnemies();
  startTime = performance.now();
}

function startGame() {
  audio.init();
  resetGame();
  state = 'playing';
  $('title-screen').classList.add('fade');
  $('end-screen').classList.remove('on');
  $('hud').classList.add('on');
  try { renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch (e) { /* 非手勢觸發時忽略 */ }
  showHint('尋找散落島上的五枚薄暮聖物', 4.5);
}

function endGame(won) {
  state = won ? 'win' : 'lose';
  document.exitPointerLock();
  const secs = ((performance.now() - startTime) / 1000).toFixed(1);
  $('end-title').textContent = won ? '歸　途' : '湮　滅';
  $('end-title').className = won ? 'win' : 'lose';
  $('end-sub').textContent = won ? 'THE WAY HOME' : 'FADED INTO DUSK';
  $('end-stats').innerHTML =
    `聖物 ${relicCount} / 5　·　擊破守衛 ${killCount}　·　歷時 ${secs} 秒`;
  $('end-screen').classList.add('on');
  $('hud').classList.remove('on');
  if (won) audio.win(); else audio.lose();
}

$('start-btn').addEventListener('click', startGame);
$('retry-btn').addEventListener('click', startGame);

// ---------- 武器 ----------
const weapon = new Weapon(scene, camera, effects, audio);
player.bindInput(renderer.domElement, weapon, () => audio.roll());

// ---------- 載入 ----------
player.load().then(() => {
  $('loading').textContent = '— 準備就緒 —';
});

window.__game = { player, weapon, enemies, world }; // debug 鉤子

// ---------- 主迴圈 ----------
const clock = new THREE.Clock();
let elapsed = 0;

function tick() {
  requestAnimationFrame(tick);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  elapsed += dt;
  autoRes(rawDt);

  world.update(dt, player.pos);
  if (player.ready) player.update(dt, world);

  if (state === 'playing') {
    audio.footsteps(dt, player.moving && player.rolling <= 0, player.running);

    // 步槍
    const shot = weapon.update(dt, player, enemies, world);
    if (shot) {
      const died = shot.enemy.takeHit(shot.dir.clone().multiplyScalar(4));
      if (died) {
        killCount++;
        audio.enemyDie();
        effects.burst(shot.enemy.pos, 0xb04aff, 44, 10);
        effects.burst(shot.enemy.pos, 0xffc878, 20, 6);
        effects.softBurst(shot.enemy.pos, 0x7be8d8, 12, 2);
      }
    }

    // 敵人
    for (const e of enemies) {
      const r = e.update(dt, elapsed, player.pos, !player.dead);
      if (r === 'hit') {
        if (player.hurt(18)) {
          audio.hurt();
          effects.burst(player.pos.clone().add(new THREE.Vector3(0, 1, 0)), 0xc84f4f, 16, 5);
          $('hpfill').style.width = (player.hp / player.maxHp * 100) + '%';
          $('vignette-hurt').style.opacity = '1';
          setTimeout(() => $('vignette-hurt').style.opacity = '0', 250);
        }
      }
    }

    effects.update(dt, enemies, terrainHeight);

    // 收集聖物
    for (const r of world.relics) {
      if (r.taken) continue;
      const d = Math.hypot(player.pos.x - r.x, player.pos.z - r.z);
      if (d < 2.1) {
        r.taken = true;
        r.group.visible = false;
        relicCount++;
        slots[relicCount - 1].classList.add('got');
        audio.collect();
        effects.softBurst(r.gem.getWorldPosition(new THREE.Vector3()), 0x7be8d8, 40, 4);
        if (relicCount >= 5) {
          world.activatePortal();
          audio.portalOpen();
          showHint('歸途之門已開啟——回到中央遺跡', 5);
        } else {
          showHint(`已取得聖物 ${relicCount} / 5`, 2.5);
        }
      }
    }

    // 走入傳送門
    if (world.portalActive) {
      const d = Math.hypot(player.pos.x, player.pos.z);
      if (d < 1.6) endGame(true);
    }

    // 死亡
    if (player.dead) {
      setTimeout(() => { if (state === 'playing') endGame(false); }, 900);
    }

    // 翻滾冷卻條
    const cdEl = $('dash-cd');
    if (player.rollCd > 0) {
      cdEl.classList.add('show');
      $('dash-fill').style.width = ((1 - player.rollCd / 0.9) * 100) + '%';
    } else {
      cdEl.classList.remove('show');
    }

    // 提示淡出
    if (hintTimer > 0) {
      hintTimer -= dt;
      if (hintTimer <= 0) $('hint').classList.remove('show');
    }
  } else {
    effects.update(dt, enemies, terrainHeight);
    // 標題畫面：環繞鏡頭
    if (state === 'title') {
      const a = elapsed * 0.08;
      camera.position.set(Math.cos(a) * 55, 22, Math.sin(a) * 55);
      camera.lookAt(0, 8, 0);
      player._camPos.copy(camera.position);
    }
  }

  composer.updateGodRays(world.sunDir);
  composer.render();
}
tick();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyRes();
});
