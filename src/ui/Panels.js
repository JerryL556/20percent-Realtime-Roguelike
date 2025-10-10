export function drawPanel(scene, x, y, w, h, color = 0x222222) {
  const g = scene.add.graphics();
  g.fillStyle(color, 0.9);
  g.fillRect(x, y, w, h);
  g.lineStyle(2, 0xffffff, 1);
  g.strokeRect(x, y, w, h);
  return g;
}

