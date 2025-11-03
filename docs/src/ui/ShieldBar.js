export class ShieldBar {
  constructor(scene, x, y, width, height) {
    this.scene = scene;
    this.x = x; this.y = y; this.w = width; this.h = height;
    this.g = scene.add.graphics();
  }
  draw(current, max) {
    this.g.clear();
    // Border (thin)
    this.g.lineStyle(1, 0x99ddff, 1);
    this.g.strokeRect(this.x, this.y, this.w, this.h);
    // Fill (cyan/blue)
    const pct = Math.max(0, Math.min(1, (max > 0 ? current / max : 0)));
    const fillW = Math.floor((this.w - 2) * pct);
    const color = 0x66ccff;
    this.g.fillStyle(color, 1);
    this.g.fillRect(this.x + 1, this.y + 1, fillW, this.h - 2);
  }
  destroy() { this.g.destroy(); }
}

