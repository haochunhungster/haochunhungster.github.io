// 抓所有 DOM 並提供 update 介面
export class UI {
  constructor(game) {
    this.game = game;
    this.menu = document.getElementById('menu');
    this.loading = document.getElementById('loading');
    this.gameover = document.getElementById('gameover');
    this.victory = document.getElementById('victory');
    this.pause = document.getElementById('pause');
    this.hud = document.getElementById('hud');
    this.crosshair = document.getElementById('crosshair');
    this.extraction = document.getElementById('extraction-banner');

    this.hpNum = document.getElementById('hp-num');
    this.hpBar = document.getElementById('hp-bar');
    this.hpRoot = document.getElementById('hp');
    this.ammoMag = document.getElementById('ammo-mag');
    this.ammoReserve = document.getElementById('ammo-reserve');
    this.enemiesLeft = document.getElementById('enemies-left');
    this.timer = document.getElementById('timer');
    this.extractionCD = document.getElementById('extraction-countdown');

    // 滑鼠跟隨 crosshair
    window.addEventListener('mousemove', (e) => {
      this.crosshair.style.left = e.clientX + 'px';
      this.crosshair.style.top = e.clientY + 'px';
    });

    this.showMenu();
  }

  bindMenu(cb) { document.getElementById('btn-start').onclick = cb; }
  bindRetry(cb) { document.getElementById('btn-retry').onclick = cb; }
  bindResume(cb) { document.getElementById('btn-resume').onclick = cb; }
  bindQuit(cb) { document.getElementById('btn-quit').onclick = cb; }
  bindNext(cb) { document.getElementById('btn-next').onclick = cb; }

  showMenu() {
    this.menu.classList.remove('hidden');
    this.gameover.classList.add('hidden');
    this.victory.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.crosshair.classList.add('hidden');
    this.extraction.classList.add('hidden');
  }

  showHUD() {
    this.menu.classList.add('hidden');
    this.gameover.classList.add('hidden');
    this.victory.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.crosshair.classList.remove('hidden');
  }

  showPause() { this.pause.classList.remove('hidden'); }
  hidePause() { this.pause.classList.add('hidden'); }

  showGameOver(stats) {
    this.gameover.classList.remove('hidden');
    document.getElementById('go-kills').textContent = stats.kills;
    document.getElementById('go-time').textContent = stats.elapsed.toFixed(1) + 's';
    const acc = stats.shots ? (stats.hits / stats.shots * 100).toFixed(0) : 0;
    document.getElementById('go-acc').textContent = acc + '%';
  }

  showVictory(stats) {
    this.victory.classList.remove('hidden');
    document.getElementById('vc-kills').textContent = stats.kills;
    document.getElementById('vc-time').textContent = stats.elapsed.toFixed(1) + 's';
    const acc = stats.shots ? (stats.hits / stats.shots * 100).toFixed(0) : 0;
    document.getElementById('vc-acc').textContent = acc + '%';
  }

  updateHUD() {
    const g = this.game;

    // HP
    this.hpNum.textContent = g.player.hp;
    this.hpBar.style.setProperty('--hp', (g.player.hp / g.player.maxHp * 100) + '%');
    if (g.player.hp / g.player.maxHp < 0.35) this.hpRoot.classList.add('low');
    else this.hpRoot.classList.remove('low');

    // Ammo
    this.ammoMag.textContent = g.weapon.mag;
    this.ammoReserve.textContent = g.weapon.reserve;

    // Enemies
    this.enemiesLeft.textContent = g.enemies.aliveCount();

    // Timer
    const t = g.stats.elapsed;
    const m = Math.floor(t / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    this.timer.textContent = `${m}:${s}`;

    // Extraction banner
    const ext = g.mapData.extraction;
    if (ext.armed) {
      this.extraction.classList.remove('hidden');
      this.extractionCD.textContent = Math.ceil(ext.countdown).toString();
    } else {
      this.extraction.classList.add('hidden');
    }
  }
}
