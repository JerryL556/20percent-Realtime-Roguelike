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
    g.strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
  };
  // Recompute after potential origin/position changes by callers
  scene.time.delayedCall(0, refreshBorder);
  text.on('destroy', () => g.destroy());
  return text;
}
