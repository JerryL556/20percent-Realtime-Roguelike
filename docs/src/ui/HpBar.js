export class HpBar {
  constructor(scene, x, y, width, height) {
    this.scene = scene;
    this.x = x; this.y = y; this.w = width; this.h = height;
    this.g = scene.add.graphics();
  }
  draw(current, max) {
    this.g.clear();
    // Border
    this.g.lineStyle(2, 0xffffff, 1);
    this.g.strokeRect(this.x, this.y, this.w, this.h);
    // Fill
    const pct = Math.max(0, Math.min(1, current / max));
    const fillW = Math.floor((this.w - 4) * pct);
    const color = pct > 0.5 ? 0x33ff66 : pct > 0.25 ? 0xffcc33 : 0xff3366;
    this.g.fillStyle(color, 1);
    this.g.fillRect(this.x + 2, this.y + 2, fillW, this.h - 4);
  }
  destroy() { this.g.destroy(); }
}

