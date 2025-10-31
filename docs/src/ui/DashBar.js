export class DashBar {
  constructor(scene, x, y, size = 14, gap = 4) {
    this.scene = scene;
    this.x = x; this.y = y;
    this.size = size; this.gap = gap;
    this.g = scene.add.graphics();
  }
  draw(current, max, progress = 0) {
    this.g.clear();
    const s = this.size; const g = this.gap;
    for (let i = 0; i < max; i += 1) {
      const sx = this.x + i * (s + g);
      // Border
      this.g.lineStyle(2, 0xffffff, 1);
      this.g.strokeRect(sx, this.y, s, s);
      // Fill
      if (i < current) {
        // Fully available charge
        this.g.fillStyle(0x44aaff, 1);
        this.g.fillRect(sx + 2, this.y + 2, s - 4, s - 4);
      } else if (i === current && current < max) {
        // Partially regenerating next charge: grow from bottom up
        const h = Math.max(0, Math.min(1, progress)) * (s - 4);
        if (h > 0) {
          this.g.fillStyle(0x44aaff, 1);
          const y0 = this.y + 2 + (s - 4 - h);
          this.g.fillRect(sx + 2, y0, s - 4, h);
        }
      } else {
        // Empty future slot
        // draw nothing (transparent)
      }
    }
  }
  destroy() { this.g.destroy(); }
}
