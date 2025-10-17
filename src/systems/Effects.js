// Lightweight hit/explosion effect utility
// Usage: impactBurst(scene, x, y, { color, size })
// size: 'small' | 'large'

export function impactBurst(scene, x, y, opts = {}) {
  const color = opts.color ?? 0xffffff;
  const size = opts.size ?? 'small';
  const baseR = size === 'large' ? 10 : 5;
  const scaleTarget = size === 'large' ? 1.8 : 1.5;

  const g = scene.add.graphics({ x, y });
  try {
    g.fillStyle(color, 1);
    g.fillCircle(0, 0, baseR);
    g.lineStyle(2, color, 0.9).strokeCircle(0, 0, Math.max(1, baseR - 1));
    g.setDepth?.(9999);
    g.alpha = 1;
    g.scale = 1;
    scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: scaleTarget,
      duration: 160,
      ease: 'Cubic.Out',
      onComplete: () => { try { g.destroy(); } catch (e) {} },
    });
  } catch (e) {
    try { g.destroy(); } catch (_) {}
  }
}

