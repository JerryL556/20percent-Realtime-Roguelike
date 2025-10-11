export function makeTextButton(scene, x, y, label, onClick) {
  const text = scene.add.text(x, y, label, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })
    .setOrigin(0.5)
    .setPadding(6, 4)
    .setInteractive({ useHandCursor: true })
    .on('pointerover', () => { text.setStyle({ color: '#ffff66' }); refreshBorder(); })
    .on('pointerout', () => { text.setStyle({ color: '#ffffff' }); refreshBorder(); })
    .on('pointerdown', () => onClick?.());
  const g = scene.add.graphics();
  g.lineStyle(1, 0xffffff, 1);
  const refreshBorder = () => {
    g.clear();
    g.lineStyle(1, 0xffffff, 1);
    const b = text.getBounds();
    // Snap to pixel and offset by 0.5 for crisp 1px lines
    const x = Math.floor(b.x) - 4 + 0.5;
    const y = Math.floor(b.y) - 4 + 0.5;
    const w = Math.ceil(b.width) + 8;
    const h = Math.ceil(b.height) + 8;
    g.strokeRect(x, y, w, h);
  };
  // Recompute after potential origin/position changes by callers
  // Draw once immediately so the border is present on first frame
  refreshBorder();
  scene.time.delayedCall(0, refreshBorder);
  text.on('destroy', () => g.destroy());
  return text;
}
