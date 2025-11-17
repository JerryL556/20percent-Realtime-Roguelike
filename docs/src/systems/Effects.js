// Lightweight hit/explosion effect utility
// Usage: impactBurst(scene, x, y, { color, size })
// size: 'small' | 'large'

export function impactBurst(scene, x, y, opts = {}) {
  const color = opts.color ?? 0xffffff;
  const size = opts.size ?? 'small';
  const radius = typeof opts.radius === 'number' ? Math.max(1, opts.radius) : null;
  // Make non-explosive hits (no radius, small size) visually smaller
  const isTinyHit = (!radius && size !== 'large');
  const baseR = radius || (size === 'large' ? 10 : (isTinyHit ? 4 : 5));
  const scaleTarget = radius ? 1.1 : (size === 'large' ? 1.8 : 1.5);

  const g = scene.add.graphics({ x, y });
  try {
    g.setDepth?.(9999);
    g.alpha = 1;
    g.scale = 1;
    // Draw layered fills and outer ring; if radius provided, use it for ring, scale layers inside
    const innerR = radius ? Math.max(6, Math.floor(baseR * 0.35)) : Math.max(1, Math.floor(baseR * 0.5));
    const midR   = Math.max(innerR + 1, Math.floor(baseR * 0.70));
    const glowR  = Math.max(midR + 1, Math.floor(baseR * 0.95));
    // Build a simple palette around the base color
    const blend = (c1, c2, t) => {
      const r = ((c1 >> 16) & 0xff) * (1 - t) + ((c2 >> 16) & 0xff) * t;
      const g2 = ((c1 >> 8) & 0xff) * (1 - t) + ((c2 >> 8) & 0xff) * t;
      const b = (c1 & 0xff) * (1 - t) + (c2 & 0xff) * t;
      return ((r & 0xff) << 16) | ((g2 & 0xff) << 8) | (b & 0xff);
    };
    const hotCore = blend(color, 0xffffff, 0.80);
    const midCol  = blend(color, 0xffff66, 0.35);
    const glowCol = blend(color, 0x000000, 0.15);
    // Layered fill: hot core -> mid -> glow
    g.fillStyle(hotCore, 0.95).fillCircle(0, 0, innerR);
    g.fillStyle(midCol, 0.55).fillCircle(0, 0, midR);
    g.fillStyle(glowCol, 0.25).fillCircle(0, 0, glowR);
    const lineW = radius ? 3 : (isTinyHit ? 1 : 2);
    g.lineStyle(lineW, color, 0.9).strokeCircle(0, 0, baseR);
    // Add a fast outer shock ring for explosives
    if (radius || size === 'large') {
      try {
        const shock = scene.add.graphics({ x, y });
        shock.setDepth?.(9999);
        shock.setBlendMode?.(Phaser.BlendModes.ADD);
        shock.lineStyle(2, color, 0.8).strokeCircle(0, 0, Math.max(innerR + 2, Math.floor(baseR * 0.8)));
        scene.tweens.add({ targets: shock, alpha: 0, scale: 1.25, duration: 160, ease: 'Cubic.Out', onComplete: () => { try { shock.destroy(); } catch (_) {} } });
      } catch (_) {}
    }
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

  // Radial pixel particle burst that flies outward from the center, matching color
  try {
    // Scale by radius and vary per explosion; shrink non-explosive bullet/laser impacts
    const n = radius ? Math.max(14, Math.min(46, Math.floor(radius * 0.7))) : (size === 'large' ? 22 : (isTinyHit ? 6 : 12));
    const spMin = radius ? Math.max(80, Math.floor(radius * 1.5)) : (isTinyHit ? 50 : 90);
    const spMax = radius ? Math.max(spMin + 60, Math.floor(radius * 3.2)) : (isTinyHit ? 120 : 180);
    const life = radius ? Math.min(420, Math.max(200, Math.floor(radius * 3.2))) : (isTinyHit ? 160 : 220);
    // Build palette variations for particles
    const blend = (c1, c2, t) => {
      const r = ((c1 >> 16) & 0xff) * (1 - t) + ((c2 >> 16) & 0xff) * t;
      const g2 = ((c1 >> 8) & 0xff) * (1 - t) + ((c2 >> 8) & 0xff) * t;
      const b = (c1 & 0xff) * (1 - t) + (c2 & 0xff) * t;
      return ((r & 0xff) << 16) | ((g2 & 0xff) << 8) | (b & 0xff);
    };
    const palette = [
      color,
      blend(color, 0xffffff, 0.5),
      blend(color, 0xffffaa, 0.3),
      blend(color, 0x000000, 0.25),
    ];
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.05, 0.05);
      // small angular spread per ray for a thicker look
      const spread = Phaser.Math.Between(isTinyHit ? 6 : 8, isTinyHit ? 12 : 16);
      const col = palette[Phaser.Math.Between(0, palette.length - 1)];
      const sz = Phaser.Math.Between(1, isTinyHit ? 1 : 2);
      pixelSparks(scene, x, y, { angleRad: a, count: 1, spreadDeg: spread, speedMin: spMin, speedMax: spMax, lifeMs: life, color: col, size: sz, alpha: 0.95 });
    }
    // A few heavier chunks for visual weight (also color-varied); minimal for tiny hits
    const heavyCount = radius ? Math.max(4, Math.min(10, Math.floor(radius / 9))) : (size === 'large' ? 6 : (isTinyHit ? 1 : 3));
    for (let i = 0; i < heavyCount; i += 1) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const col = palette[Phaser.Math.Between(0, palette.length - 1)];
      pixelSparks(scene, x, y, { angleRad: a, count: 1, spreadDeg: 6, speedMin: spMin - 20, speedMax: spMax + 20, lifeMs: life + (isTinyHit ? 20 : 60), color: col, size: (isTinyHit ? 2 : 3), alpha: 0.95 });
    }
  } catch (_) {}
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

// Reusable teleport-style spawn VFX:
// 1) a vertical additive line shoots down from above (same x),
// 2) then the familiar spawn ring appears at the spawn point,
// 3) and an optional onSpawn callback is invoked at the same time as the ring.
export function teleportSpawnVfx(scene, x, y, opts = {}) {
  try {
    const color = opts.color ?? 0xaa66ff;
    const lineDuration = Math.max(80, opts.lineDuration ?? 220);
    const lineLength = Math.max(30, opts.lineLength ?? 80);
    const ringOpts = opts.ringOpts || {};
    const onSpawn = (typeof opts.onSpawn === 'function') ? opts.onSpawn : null;

    const g = scene.add.graphics({ x, y });
    try { g.setDepth?.(9999); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}

    // Animate a line revealing from top -> spawn point
    const state = { t: 0 };
    const drawLine = (t) => {
      try {
        g.clear();
        const len = lineLength * t;
        g.lineStyle(3, color, 0.95);
        g.beginPath();
        g.moveTo(0, -lineLength);
        g.lineTo(0, -lineLength + len);
        g.strokePath();
      } catch (_) {}
    };
    drawLine(0);

    scene.tweens.add({
      targets: state,
      t: 1,
      duration: lineDuration,
      ease: 'Cubic.Out',
      onUpdate: () => { drawLine(state.t || 0); },
      onComplete: () => {
        try { g.destroy(); } catch (_) {}
        // Spawn enemy (or other object) exactly when the ring appears
        if (onSpawn) {
          try { onSpawn(); } catch (_) {}
        }
        try {
          bitSpawnRing(scene, x, y, {
            color,
            radius: (ringOpts.radius ?? 22),
            lineWidth: (ringOpts.lineWidth ?? 3),
            duration: (ringOpts.duration ?? 420),
            scaleTarget: (ringOpts.scaleTarget ?? 2.1),
          });
        } catch (_) {}
      },
    });
  } catch (_) {}
}

// Vertical boss signal beam: a purple line that travels upward off-screen over a fixed duration.
export function bossSignalBeam(scene, x, y, opts = {}) {
  try {
    const color = opts.color ?? 0xaa66ff;
    const duration = Math.max(100, opts.duration ?? 1000);
    const lineLength = Math.max(40, opts.lineLength ?? (scene.scale?.height || 200));
    const g = scene.add.graphics({ x, y });
    try { g.setDepth?.(9999); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    // Draw a vertical line anchored at the boss and extending upward
    g.lineStyle(3, color, 0.95);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -lineLength);
    g.strokePath();
    // Tween the beam upward so it exits the screen
    const travel = (scene.scale?.height || 240) + lineLength;
    scene.tweens.add({
      targets: g,
      y: y - travel,
      alpha: 0.0,
      duration,
      ease: 'Cubic.Out',
      onComplete: () => { try { g.destroy(); } catch (_) {} },
    });
  } catch (_) {}
}

// Glowing bombardment marker: small purple block with an animated antenna-like line on top.
// Returns an object with a destroy() method so callers can clean it up.
export function spawnBombardmentMarker(scene, x, y, opts = {}) {
  const color = opts.color ?? 0xaa66ff;
  const baseW = opts.baseWidth ?? 10;
  const baseH = opts.baseHeight ?? 6;
  const glowAlpha = opts.glowAlpha ?? 0.35;
  const lineHeight = opts.lineHeight ?? 12;
  const pulseDuration = Math.max(220, opts.pulseDuration ?? 420);
  const objs = [];
  try {
    // Base block
    const base = scene.add.rectangle(x, y, baseW, baseH, color, 1);
    try { base.setDepth?.(9600); } catch (_) {}
    objs.push(base);
    // Soft glow around base
    const glow = scene.add.rectangle(x, y, baseW + 6, baseH + 4, color, glowAlpha);
    try {
      glow.setDepth?.(9595);
      glow.setBlendMode?.(Phaser.BlendModes.ADD);
    } catch (_) {}
    scene.tweens.add({
      targets: glow,
      alpha: { from: glowAlpha, to: glowAlpha * 0.15 },
      duration: pulseDuration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    objs.push(glow);
    // Antenna line on top of the block
    const lineG = scene.add.graphics({ x, y: y - baseH / 2 });
    try {
      lineG.setDepth?.(9610);
      lineG.setBlendMode?.(Phaser.BlendModes.ADD);
    } catch (_) {}
    const drawLine = (scale = 1) => {
      try {
        lineG.clear();
        lineG.lineStyle(2, color, 0.95);
        lineG.beginPath();
        lineG.moveTo(0, 0);
        lineG.lineTo(0, -lineHeight * scale);
        lineG.strokePath();
      } catch (_) {}
    };
    drawLine(1);
    scene.tweens.add({
      targets: { t: 1 },
      t: 0.6,
      duration: pulseDuration,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      onUpdate(tw, target) { drawLine(target.t || 1); },
    });
    objs.push(lineG);
  } catch (_) {}

  return {
    x,
    y,
    destroy() {
      objs.forEach((o) => { try { o.destroy(); } catch (_) {} });
    },
  };
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

// Pick a scrap tint based on enemy type flags
export function getScrapTintForEnemy(e) {
    // Boss-specific mapping by type (Bigwig/Dandelion/Hazel)
    if (e?.isBoss) {
      const t = String(e.bossType || '').toLowerCase();
      if (t === 'bigwig') return 0x4a6b3a;
      if (t === 'dandelion') return 0x9a6c3a;
      if (t === 'hazel') return 0x55585d;
      // fall through for unknown boss types
    }
  try {
    // Dark tan group: Prism, Shredder (base melee), Charger (runner), Rook
    if (e?.isPrism || (e?.isMelee && !e?.isRunner && !e?.isRook) || e?.isRunner || e?.isRook) return 0x9a6c3a;
    // Military green group: Bombardier (Grenadier), Shooter (generic), MachineGunner, Rocketeer
    if (e?.isGrenadier || e?.isMachineGunner || e?.isRocketeer || e?.isShooter) return 0x4a6b3a;
    // Dark grey group: Commander (Snitch), Sniper
    if (e?.isSnitch || e?.isSniper) return 0x55585d;
  } catch (_) {}
  return 0x888888; // fallback neutral
}

// Small, purely visual death effect: a tiny pop and colored scrap sparks
export function spawnDeathVfxForEnemy(scene, e, scale = 1) {
  try {
    const x = e?.x ?? 0;
    const y = e?.y ?? 0;
    const isBoss = !!e?.isBoss || !!e?.bossType;

    if (!isBoss) {
      // Normal enemy death (unchanged)
      const tint = getScrapTintForEnemy(e);
      const r = Math.max(10, Math.floor(14 * scale));
      impactBurst(scene, x, y, { color: 0xff3333, size: 'small', radius: Math.floor(r * 0.8) });
      const scraps = Math.max(8, Math.floor(12 * scale));
      spawnScrapDebris(scene, x, y, { tint, count: scraps, power: 1 });
      try {
        const key = ensureCircleParticle(scene, 'death_smoke_particle', 0x999999, 3);
        for (let i = 0; i < 2; i += 1) {
          const img = scene.add.image(x, y, key).setDepth(8500).setAlpha(0.18);
          const dx = Phaser.Math.Between(-6, 6), dy = Phaser.Math.Between(-10, 0);
          const sc = Phaser.Math.FloatBetween(0.8, 1.1) * (1 + 0.2 * scale);
          scene.tweens.add({
            targets: img,
            x: x + dx,
            y: y + dy,
            alpha: 0,
            scale: sc,
            duration: 260,
            ease: 'Cubic.Out',
            onComplete: () => { try { img.destroy(); } catch (_) {} },
          });
        }
      } catch (_) {}
      return;
    }

    // Boss death: more intense explosions and boss-tinted scrap
    const bossType = e?.bossType || e?._bossId || '';
    let bossColor = 0xff3333;
    if (bossType === 'Bigwig') bossColor = 0xffdd33;      // yellow/orange
    else if (bossType === 'Dandelion') bossColor = 0xff4444; // red
    else if (bossType === 'Hazel') bossColor = 0xaa66ff;     // purple

    const baseTint = getScrapTintForEnemy(e);
    const r = Math.max(18, Math.floor(20 * scale));

    // Initial large explosion
    impactBurst(scene, x, y, { color: bossColor, size: 'large', radius: Math.floor(r * 1.2) });

    // Secondary explosions in a loose ring around the boss
    try {
      const ringCount = 4;
      for (let i = 0; i < ringCount; i += 1) {
        const ang = (i / ringCount) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
        const dist = Phaser.Math.Between(20, 40);
        const ex = x + Math.cos(ang) * dist;
        const ey = y + Math.sin(ang) * dist;
        const delay = Phaser.Math.Between(80, 200);
        scene.time.delayedCall(delay, () => {
          try {
            impactBurst(scene, ex, ey, { color: bossColor, size: 'small', radius: Math.floor(r * 0.7) });
          } catch (_) {}
        });
      }
    } catch (_) {}

    // Boss scrap debris: more pieces, stronger power
    const bossScraps = Math.max(18, Math.floor(28 * scale));
    // Scrap metal keeps the same tint as normal enemies but lives longer for bosses
    spawnScrapDebris(scene, x, y, { tint: baseTint, count: bossScraps, power: 1.4, lifeScale: 1.6 });

    // Extra boss-specific pixel sparks in a short burst
    try {
      const sparkCount = 24;
      for (let i = 0; i < sparkCount; i += 1) {
        const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const sp = Phaser.Math.Between(140, 240);
        pixelSparks(scene, x, y, {
          angleRad: a,
          count: 1,
          spreadDeg: 10,
          speedMin: sp,
          speedMax: sp + 40,
          lifeMs: Phaser.Math.Between(220, 320),
          color: bossColor,
          size: 2,
          alpha: 0.95,
        });
      }
    } catch (_) {}

    // Soft smoke + a bit more for boss deaths
    try {
      const key = ensureCircleParticle(scene, 'death_smoke_particle', 0x999999, 3);
      for (let i = 0; i < 4; i += 1) {
        const img = scene.add.image(x, y, key).setDepth(8500).setAlpha(0.22);
        const dx = Phaser.Math.Between(-12, 12);
        const dy = Phaser.Math.Between(-18, -4);
        const sc = Phaser.Math.FloatBetween(1.0, 1.4) * (1 + 0.25 * scale);
        scene.tweens.add({
          targets: img,
          x: x + dx,
          y: y + dy,
          alpha: 0,
          scale: sc,
          duration: 320,
          ease: 'Cubic.Out',
          onComplete: () => { try { img.destroy(); } catch (_) {} },
        });
      }
    } catch (_) {}

    // Short camera shake for boss kills
    try {
      const cam = scene.cameras?.main;
      cam?.shake?.(220, 0.007);
    } catch (_) {}
  } catch (_) {}
}

// Ensure a small pool of irregular scrap polygon textures exists
function ensureScrapTextures(scene) {
  try {
    if (scene.textures?.exists?.('scrap_shape_0')) return true;
    const shapes = [
      [ {x:0,y:1},{x:3,y:0},{x:6,y:2},{x:2,y:4} ],
      [ {x:0,y:0},{x:4,y:1},{x:5,y:4},{x:1,y:5} ],
      [ {x:1,y:0},{x:6,y:0},{x:4,y:3},{x:0,y:2} ],
      [ {x:0,y:1},{x:2,y:0},{x:5,y:2},{x:3,y:5},{x:0,y:3} ],
      [ {x:0,y:0},{x:5,y:0},{x:6,y:2},{x:1,y:3} ],
      [ {x:1,y:0},{x:4,y:1},{x:6,y:3},{x:2,y:4},{x:0,y:2} ],
    ];
    for (let i = 0; i < shapes.length; i += 1) {
      const key = `scrap_shape_${i}`;
      const g = scene.make.graphics({ x: 0, y: 0, add: false });
      g.clear(); g.fillStyle(0xffffff, 1);
      const pts = shapes[i];
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      for (let j = 1; j < pts.length; j += 1) g.lineTo(pts[j].x, pts[j].y);
      g.closePath(); g.fillPath();
      const w = 7, h = 6;
      g.generateTexture(key, w, h);
      g.destroy();
    }
    return true;
  } catch (_) { return false; }
}

// Spawn irregular scrap pieces flying in simple parabolas and disappearing on 'landing'
export function spawnScrapDebris(scene, x, y, opts = {}) {
  try {
    ensureScrapTextures(scene);
    const count = Math.max(1, opts.count || 10);
    const tint = opts.tint ?? 0x888888;
    const power = opts.power ?? 1;
    const lifeScale = typeof opts.lifeScale === 'number' && opts.lifeScale > 0 ? opts.lifeScale : 1;
    for (let i = 0; i < count; i += 1) {
      const key = `scrap_shape_${Phaser.Math.Between(0, 5)}`;
      const img = scene.add.image(x, y, key);
      img.setDepth(8600);
      try { img.setTint(tint); } catch (_) {}
      // Horizontal drift (slow) — parabola controlled by vertical z only
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      // Emphasize horizontal motion; keep vertical (height) subtle
      const sp = Phaser.Math.FloatBetween(28, 56) * power; // slightly more horizontal spread
      let vx = Math.cos(a) * sp;
      let vy = Phaser.Math.FloatBetween(-3, 3) * power; // minimal screen-space vertical drift
      // Vertical arc (height) with gentle launch and gravity
      let z = Phaser.Math.FloatBetween(10, 16) * power;      // slightly lower initial height
      let vz = Phaser.Math.FloatBetween(110, 160) * power;   // slightly lower upward velocity
      const g = 240; // still strong gravity but less extreme
      const zScale = 0.42; // less vertical projection for a flatter look
      const dragPerSecond = 0.65; // a bit lighter drag for wider spread
      let sx = x, sy = y; // ground-projected positions
      const maxLife = 1250 * lifeScale; // lifespan scaled by caller
      let lived = 0;
      const rotSpd = Phaser.Math.FloatBetween(-6, 6);
      const x0 = x, y0 = y;
      const onUpdate = () => {
        try {
          const dt = ((scene.game?.loop?.delta) || 16) / 1000;
          // planar motion with drag
          const decay = Math.pow(dragPerSecond, dt);
          vx *= decay; vy *= decay;
          sx += vx * dt; sy += vy * dt;
          // vertical motion
          z += vz * dt; vz -= g * dt;
          // display: raise by z
          img.x = sx; img.y = sy - z * zScale;
          img.rotation += rotSpd * dt;
          // landed
          lived += dt * 1000;
          if (z <= 0 || lived >= maxLife) {
            z = 0;
            scene.events.off('update', onUpdate);
            scene.tweens.add({ targets: img, alpha: 0, duration: 140, onComplete: () => { try { img.destroy(); } catch (_) {} } });
          }
          // offscreen safety
          const view = scene.cameras?.main?.worldView; if (view && !view.contains(img.x, img.y)) { scene.events.off('update', onUpdate); try { img.destroy(); } catch (_) {} }
        } catch (_) { try { scene.events.off('update', onUpdate); img.destroy(); } catch (e) {} }
      };
      scene.events.on('update', onUpdate);
      // ensure cleanup on scene shutdown
      try { scene.events.once('shutdown', () => { try { scene.events.off('update', onUpdate); } catch (_) {} try { img.destroy(); } catch (_) {} }); } catch (_) {}
    }
  } catch (_) {}
}


