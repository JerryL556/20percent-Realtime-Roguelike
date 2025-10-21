// Lightweight hit/explosion effect utility
// Usage: impactBurst(scene, x, y, { color, size })
// size: 'small' | 'large'

export function impactBurst(scene, x, y, opts = {}) {
  const color = opts.color ?? 0xffffff;
  const size = opts.size ?? 'small';
  const radius = typeof opts.radius === 'number' ? Math.max(1, opts.radius) : null;
  const baseR = radius || (size === 'large' ? 10 : 5);
  const scaleTarget = radius ? 1.1 : (size === 'large' ? 1.8 : 1.5);

  const g = scene.add.graphics({ x, y });
  try {
    g.setDepth?.(9999);
    g.alpha = 1;
    g.scale = 1;
    // Draw inner fill and outer ring; if radius provided, match that ring to the damage radius
    const innerR = radius ? Math.max(6, Math.floor(baseR * 0.35)) : Math.max(1, baseR - 1);
    g.fillStyle(color, 0.6);
    g.fillCircle(0, 0, innerR);
    g.lineStyle(radius ? 3 : 2, color, 0.9).strokeCircle(0, 0, baseR);
    scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: scaleTarget,
      duration: radius ? 220 : 160,
      ease: 'Cubic.Out',
      onComplete: () => { try { g.destroy(); } catch (e) {} },
    });
  } catch (e) {
    try { g.destroy(); } catch (_) {}
  }
}

