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

// Green particle burst used for BITs spawn: no outer ring, floating particles
export function bitSpawnBurst(scene, x, y, opts = {}) {
  try {
    const count = typeof opts.count === 'number' ? opts.count : 64;
    const texKey = 'bit_particle';
    // Fallback: ensure particle texture exists
    try {
      if (!scene.textures || !scene.textures.exists(texKey)) {
        const g = scene.make.graphics({ x: 0, y: 0, add: false });
        g.clear(); g.fillStyle(0x33ff66, 1); g.fillCircle(4, 4, 4);
        g.generateTexture(texKey, 8, 8); g.destroy();
      }
    } catch (_) {}
    const mgr = scene.add.particles(texKey);
    try { mgr.setDepth?.(9999); } catch (_) {}
    const emitter = mgr.createEmitter({
      x, y,
      speed: { min: 140, max: 300 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 700, max: 1100 },
      alpha: { start: 1.0, end: 0 },
      scale: { start: 1.2, end: 0 },
      gravityY: -20,
      quantity: 0,
      blendMode: Phaser.BlendModes.ADD,
    });
    emitter.explode(count, x, y);
    scene.time.delayedCall(1200, () => { try { mgr.destroy(); } catch (_) {} });
  } catch (_) {}
}

// Simple expanding ring (no fill) for BIT activation
export function bitSpawnRing(scene, x, y, opts = {}) {
  try {
    const color = opts.color ?? 0x33ff66;
    const radius = typeof opts.radius === 'number' ? Math.max(4, opts.radius) : 18;
    const lineWidth = typeof opts.lineWidth === 'number' ? Math.max(1, opts.lineWidth) : 3;
    const duration = typeof opts.duration === 'number' ? Math.max(100, opts.duration) : 400;
    const scaleTarget = opts.scaleTarget ?? 1.8;
    const g = scene.add.graphics({ x, y });
    try { g.setDepth?.(9999); } catch (_) {}
    g.lineStyle(lineWidth, color, 0.95).strokeCircle(0, 0, radius);
    scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: scaleTarget,
      duration,
      ease: 'Cubic.Out',
      onComplete: () => { try { g.destroy(); } catch (_) {} },
    });
  } catch (_) {}
}

// Tiny additive spark used along Repulsion Pulse ring
export function pulseSpark(scene, x, y, opts = {}) {
  try {
    const color = opts.color ?? 0xffaa66;
    const size = opts.size ?? 3;
    const life = opts.life ?? 160;
    const g = scene.add.graphics({ x, y });
    try { g.setDepth?.(9500); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    g.fillStyle(color, 0.9).fillCircle(0, 0, size);
    scene.tweens.add({
      targets: g,
      alpha: 0,
      scale: 1.4,
      duration: life,
      ease: 'Cubic.Out',
      onComplete: () => { try { g.destroy(); } catch (_) {} },
    });
  } catch (_) {}
}

// Quick yellow muzzle flash at the barrel tip
// angle: facing in radians; draws a short additive streak and fades fast
export function muzzleFlash(scene, x, y, opts = {}) {
  try {
    const color = opts.color ?? 0xffee66;
    const len = Math.max(4, opts.length ?? 10);
    const thickness = Math.max(2, opts.thickness ?? 3);
    const angle = opts.angle ?? 0;
    const life = Math.max(30, opts.life ?? 70);
    const g = scene.add.graphics({ x, y });
    try { g.setDepth?.(9500); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    // Core streak
    const hx = Math.cos(angle) * len;
    const hy = Math.sin(angle) * len;
    g.lineStyle(thickness, color, 0.95);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(hx, hy); g.strokePath();
    // Inner hot core
    g.lineStyle(Math.max(1, thickness - 1), 0xffffaa, 0.95);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(hx * 0.75, hy * 0.75); g.strokePath();
    // Small bloom at muzzle
    g.fillStyle(color, 0.8).fillCircle(0, 0, Math.max(1, Math.floor(thickness)));
    scene.tweens.add({ targets: g, alpha: 0, scale: 1.2, duration: life, ease: 'Cubic.Out', onComplete: () => { try { g.destroy(); } catch (_) {} } });
  } catch (_) {}
}

// Split muzzle flash: multiple short streaks fanning out from the muzzle
export function muzzleFlashSplit(scene, x, y, opts = {}) {
  try {
    const color = opts.color ?? 0xffee66;
    const angle = opts.angle ?? 0;
    const life = Math.max(40, opts.life ?? 80);
    const count = Math.max(2, opts.count ?? 3);
    const spreadDeg = Math.max(4, opts.spreadDeg ?? 22);
    const length = Math.max(6, opts.length ?? 16);
    const thickness = Math.max(2, opts.thickness ?? 4);
    const g = scene.add.graphics({ x, y });
    try { g.setDepth?.(9500); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    const toRad = Phaser.Math.DegToRad;
    // Build a symmetric set of angles around the main angle
    const angles = [];
    if (count % 2 === 1) angles.push(angle); // center ray
    const pairs = Math.floor(count / 2);
    for (let i = 1; i <= pairs; i += 1) {
      const off = toRad((spreadDeg / pairs) * i);
      angles.push(angle - off, angle + off);
    }
    // Draw each ray
    for (let i = 0; i < angles.length; i += 1) {
      const a = angles[i];
      const len = length * (i === 0 ? 1.0 : 0.9); // slight variation
      const thick = Math.max(1, Math.round(thickness * (i === 0 ? 1.0 : 0.9)));
      const hx = Math.cos(a) * len;
      const hy = Math.sin(a) * len;
      g.lineStyle(thick, color, 0.95);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(hx, hy); g.strokePath();
      g.lineStyle(Math.max(1, thick - 1), 0xffffaa, 0.95);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(hx * 0.7, hy * 0.7); g.strokePath();
    }
    // Small bloom at muzzle
    g.fillStyle(color, 0.85).fillCircle(0, 0, Math.max(2, Math.floor(thickness)));
    scene.tweens.add({ targets: g, alpha: 0, scale: 1.22, duration: life, ease: 'Cubic.Out', onComplete: () => { try { g.destroy(); } catch (_) {} } });
  } catch (_) {}
}

// Ensure a tiny solid-circle texture exists for particle emitters
export function ensureCircleParticle(scene, key = 'circle_particle', color = 0x66aaff, radius = 3) {
  try {
    if (scene.textures?.exists?.(key)) return key;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.clear(); g.fillStyle(color, 1).fillCircle(radius, radius, radius);
    g.generateTexture(key, radius * 2, radius * 2);
    g.destroy();
    return key;
  } catch (_) { return null; }
}

// Tiny pixel texture for retro-looking particles (e.g., railgun charge)
export function ensurePixelParticle(scene, key = 'pixel_particle', color = 0x66aaff, size = 1) {
  try {
    if (scene.textures?.exists?.(key)) return key;
    const s = Math.max(1, Math.floor(size));
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.clear(); g.fillStyle(color, 1).fillRect(0, 0, s, s);
    g.generateTexture(key, s, s);
    g.destroy();
    return key;
  } catch (_) { return null; }
}

// Spawn a small burst of additive pixel sparks that travel in given directions and fade out
export function pixelSparks(scene, x, y, opts = {}) {
  try {
    const base = opts.angleRad ?? 0; // direction in radians
    const count = Math.max(1, opts.count ?? 2);
    const spread = Phaser.Math.DegToRad(Math.max(0, opts.spreadDeg ?? 10));
    const speedMin = Math.max(0, opts.speedMin ?? 60);
    const speedMax = Math.max(speedMin, opts.speedMax ?? 140);
    const life = Math.max(60, opts.lifeMs ?? 260);
    const size = Math.max(1, opts.size ?? 2);
    const color = opts.color ?? 0x66aaff;
    const upDownJitter = Phaser.Math.DegToRad(Phaser.Math.Between(-6, 6));
    const alpha = Math.max(0, Math.min(1, opts.alpha ?? 0.8));
    for (let i = 0; i < count; i += 1) {
      const a = base + Phaser.Math.FloatBetween(-spread / 2, spread / 2) + upDownJitter;
      const spd = Phaser.Math.Between(speedMin, speedMax);
      const dx = Math.cos(a) * spd;
      const dy = Math.sin(a) * spd;
      const dist = spd * (life / 1000);
      const tx = x + (dx / spd) * dist;
      const ty = y + (dy / spd) * dist;
      const r = scene.add.rectangle(x, y, size, size, color, alpha);
      try { r.setDepth?.(9600); } catch (_) {}
      try { r.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      scene.tweens.add({ targets: r, x: tx, y: ty, alpha: 0, duration: life, ease: 'Cubic.Out', onComplete: () => { try { r.destroy(); } catch (_) {} } });
    }
  } catch (_) {}
}
