// 鍵盤 + 滑鼠輸入（不使用 pointer lock，因為俯視角不需要）
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDown = false;
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0 };

    // 一次性事件（用 consume 取出後清空）
    this._oneShot = new Set();

    window.addEventListener('keydown', (e) => {
      const k = e.code;
      if (!this.keys.has(k)) {
        this._oneShot.add('down:' + k);
      }
      this.keys.add(k);
      if (k === 'KeyR') this._oneShot.add('reload');
      if (k === 'Escape') this._oneShot.add('pause');
      // 防止瀏覽器預設行為（空白鍵捲動等）
      if (['Space','KeyW','KeyA','KeyS','KeyD'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this._oneShot.add('fire');
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // 失焦清空
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
  }

  update() { /* 預留 */ }

  isDown(code) { return this.keys.has(code); }
  consume(name) {
    if (this._oneShot.has(name)) {
      this._oneShot.delete(name);
      return true;
    }
    return false;
  }

  // 為了相容（main.js 有呼叫，俯視角實際上不需要 lock）
  lockPointer() {}
  unlockPointer() {}
}
