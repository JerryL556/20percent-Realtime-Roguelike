export class HeatBar {
  constructor(scene, x, y, width = 120, height = 8) {
    this.scene = scene;
    this.x = x; this.y = y; this.w = width; this.h = height;
    this.g = scene.add.graphics();
    try { this.g.setDepth(1000); } catch (_) {}
    this.visible = true;
  }
  setVisible(v) { this.visible = !!v; if (this.g) this.g.setVisible(!!v); }
  draw(heat = 0, overheated = false) {
    if (!this.visible) return;
    const v = Math.max(0, Math.min(1, heat || 0));
    this.g.clear();
    // Border
    this.g.lineStyle(1, 0xffffff, 0.9);
    this.g.strokeRect(this.x, this.y, this.w, this.h);
    // Fill: gradient-ish via two layers (blue under, red on top scaled by heat)
    const innerW = this.w - 4; const innerH = this.h - 4;
    const fillW = Math.floor(innerW * v);
    if (fillW > 0) {
      // Blue base
      this.g.fillStyle(0x55aaff, 0.9);
      this.g.fillRect(this.x + 2, this.y + 2, fillW, innerH);
      // Red overlay for higher heat
      const redW = Math.floor(fillW * 0.65);
      if (redW > 0) {
        this.g.fillStyle(0xff3333, 0.9);
        this.g.fillRect(this.x + 2, this.y + 2, redW, innerH);
      }
    }
    if (overheated) {
      // Cross diag to indicate overheated
      this.g.lineStyle(1, 0xff6666, 1);
      this.g.beginPath();
      this.g.moveTo(this.x + 2, this.y + 2);
      this.g.lineTo(this.x + this.w - 2, this.y + this.h - 2);
      this.g.strokePath();
    }
  }
  destroy() { try { this.g.destroy(); } catch (_) {} }
}

