// Global visual scale for enemy textures (keeps physics bodies unchanged)
const ENEMY_SPRITE_VISUAL_MULT = 2.0; // 200% of body height visually

// Known enemy texture paths for lazy loading if scene enters directly (skips BootScene)
const ENEMY_TEXTURE_PATHS = {
  enemy_shredder: 'assets/Shredder.png',
  enemy_charger: 'assets/Charger.png',
  enemy_gunner: 'assets/Gunner.png',
  enemy_machine_gunner: 'assets/MachineGunner.png',
  enemy_rocketeer: 'assets/Rocketeer.png',
  enemy_sniper: 'assets/Sniper.png',
  enemy_prism: 'assets/Prism.png',
  enemy_commander: 'assets/Commander.png',
  enemy_rook: 'assets/Rook.png',
  enemy_bombardier: 'assets/Bombardier.png',
  enemy_bombardier_special: 'assets/BombardierSpecial.png',
};

function _ensureEnemyTexture(scene, key, onLoaded) {
  try {
    if (!key || !scene) return;
    if (scene.textures?.exists?.(key)) { if (onLoaded) onLoaded(); return; }
    const path = ENEMY_TEXTURE_PATHS[key];
    if (!path) return; // no known path
    // Avoid duplicate queueing
    if (!scene._enemyTexLoading) scene._enemyTexLoading = new Set();
    if (scene._enemyTexLoading.has(key)) return;
    scene._enemyTexLoading.add(key);
    scene.load.image(key, path);
    if (typeof onLoaded === 'function') {
      const handler = () => { try { onLoaded(); } catch (_) {} try { scene.load.off('complete', handler); } catch (_) {} };
      scene.load.on('complete', handler);
    }
    scene.load.start();
  } catch (_) {}
}

function _fitSpriteToBody(sprite, desiredPx) {
  try {
    const bodyH = (sprite.body && sprite.body.height) ? sprite.body.height : desiredPx || sprite.displayHeight || 12;
    const key = sprite.texture?.key; if (!key) return;
    const tex = sprite.scene.textures.get(key);
    const src = tex?.getSourceImage?.();
    const h = (src && (src.naturalHeight || src.height)) || tex?.frames?.['__BASE']?.height || sprite.height || 1;
    if (h > 0) {
      const scale = (bodyH / h) * ENEMY_SPRITE_VISUAL_MULT;
      sprite.setScale(scale);
    }
  } catch (_) {}
}

function _applyTextureAndScale(e, key, bodyW, bodyH) {
  // New approach: keep physics sprite as-is; render a separate visual image following the body
  try {
    if (!e || !e.scene || !key) return;
    const sc = e.scene;
    const buildImage = () => {
      try {
        if (e._vis && e._vis.texture?.key === key) return; // already set
        if (e._vis) { try { e._vis.destroy(); } catch (_) {} e._vis = null; }
        const img = sc.add.image(e.x, e.y, key);
        try { img.setOrigin(0.5, 0.5); img.setDepth(8000); } catch (_) {}
        // Scale image to body height with visual multiplier
        try {
          const tex = sc.textures.get(key);
          const src = tex?.getSourceImage?.();
          const h = (src && (src.naturalHeight || src.height)) || tex?.frames?.['__BASE']?.height || img.height || 1;
          const bodyHNow = (e.body && e.body.height) ? e.body.height : (bodyH || 12);
          if (h > 0) img.setScale((bodyHNow / h) * ENEMY_SPRITE_VISUAL_MULT);
        } catch (_) {}
        e._vis = img;
        // Ensure the underlying physics sprite is invisible
        try { e.setVisible(false); } catch (_) {}
        // Create/update separate physics hitbox that matches the visual size for bullet overlap
        try {
          if (!e._hitbox) {
            const hb = sc.physics.add.image(e.x, e.y, 'bullet');
            hb.setVisible(false);
            hb.setImmovable(true);
            hb.body.allowGravity = false;
            hb._owner = e;
            e._hitbox = hb;
            if (sc.enemyHitboxes && sc.enemyHitboxes.add) sc.enemyHitboxes.add(hb);
            // Lazily bind bullet overlap against this hitbox if bullets group exists
            try {
              if (sc.bullets && !e._hbOverlapBound) {
                sc.physics.add.overlap(sc.bullets, hb, (b, hitb) => {
                  try {
                    if (!b?.active || !hitb?.active) return;
                    const owner = hitb._owner; if (!owner?.active) return;
                    // Rook shield block (simplified)
                    if (owner.isRook && !b._rail) {
                      try {
                        const r = (owner._shieldRadius || 60);
                        const gap = 35; const off = (gap - r);
                        const cx = owner.x + Math.cos(owner._shieldAngle || 0) * off;
                        const cy = owner.y + Math.sin(owner._shieldAngle || 0) * off;
                        const angToBullet = Math.atan2(b.y - cy, b.x - cx);
                        const shieldAng = owner._shieldAngle || 0;
                        const diff = Math.abs(Phaser.Math.Angle.Wrap(angToBullet - shieldAng));
                        const half = Phaser.Math.DegToRad(45);
                        const dxr = b.x - cx, dyr = b.y - cy; const d2 = dxr * dxr + dyr * dyr;
                        if (diff <= half && d2 >= (r * r * 0.9)) {
                          try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
                          try { b.setActive(false).setVisible(false); } catch (_) {}
                          sc.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
                          return;
                        }
                      } catch (_) {}
                    }
                    // Damage
                    const baseDmg = b.damage || 10;
                    if (owner.isDummy) {
                      const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
                      sc._dummyDamage = (sc._dummyDamage || 0) + primaryDmg;
                    } else {
                      if (typeof owner.hp !== 'number') owner.hp = owner.maxHp || 20;
                      owner.hp -= baseDmg;
                    }
                    const nowT = sc.time.now;
                    if (!owner.isDummy && b._igniteOnHit > 0) { owner._igniteValue = Math.min(10, (owner._igniteValue || 0) + b._igniteOnHit); if ((owner._igniteValue || 0) >= 10) { owner._ignitedUntil = nowT + 2000; owner._igniteValue = 0; } }
                    if (!owner.isDummy && b._toxinOnHit > 0) { owner._toxinValue = Math.min(10, (owner._toxinValue || 0) + b._toxinOnHit); if ((owner._toxinValue || 0) >= 10) { owner._toxinedUntil = nowT + 2000; owner._toxinValue = 0; } }
                    if (!owner.isDummy && b._stunOnHit > 0) { owner._stunValue = Math.min(10, (owner._stunValue || 0) + b._stunOnHit); if ((owner._stunValue || 0) >= 10) { owner._stunnedUntil = nowT + 200; owner._stunValue = 0; } }
                    if (b._core === 'blast') {
                      const radius = b._blastRadius || 20; const r2 = radius * radius;
                      const arr = sc.enemies?.getChildren?.() || [];
                      for (let i = 0; i < arr.length; i += 1) {
                        const other = arr[i]; if (!other?.active) continue; const dx = other.x - b.x; const dy = other.y - b.y; if (dx * dx + dy * dy <= r2) { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= b._rocket ? (b._aoeDamage || b.damage || 10) : Math.ceil((b.damage || 10) * 0.5); if (other.hp <= 0) sc.killEnemy?.(other); }
                      }
                      sc.damageSoftBarricadesInRadius?.(b.x, b.y, radius, (b.damage || 10));
                    }
                    if (b._core === 'pierce' && (b._pierceLeft || 0) > 0) { b._pierceLeft -= 1; }
                    else { try { if (b.body) b.body.checkCollision.none = true; } catch (_) {} try { b.setActive(false).setVisible(false); } catch (_) {} sc.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} }); }
                    if (owner.hp <= 0 && !owner.isDummy) sc.killEnemy?.(owner);
                  } catch (_) {}
                }, null, sc);
                e._hbOverlapBound = true;
              }
            } catch (_) {}
          }
          if (e._hitbox && e._vis) {
            const w = Math.max(1, Math.round(e._vis.displayWidth || 12));
            const h = Math.max(1, Math.round(e._vis.displayHeight || 12));
            try { e._hitbox.body.setSize(w, h, true); } catch (_) {}
            try { e._hitbox.setPosition(e.x, e.y); } catch (_) {}
          }
        } catch (_) {}
      } catch (_) {}
    };
    if (sc.textures?.exists?.(key)) buildImage(); else _ensureEnemyTexture(sc, key, buildImage);
  } catch (_) {}
}

function _resetBodySize(e) {
  try {
    if (e && e.body && e._bodyW && e._bodyH) {
      // Center body on the sprite using the origin by passing center=true
      e.body.setSize(e._bodyW, e._bodyH, true);
    }
  } catch (_) {}
}

function _attachEnemyVisuals(e, keyNormal, keyCharge = null, bodyW = null, bodyH = null) {
  // Remember intended physics body size to keep collisions stable regardless of display scale
  if (bodyW && bodyH) { e._bodyW = bodyW; e._bodyH = bodyH; }
  try {
    if (keyNormal) {
      const applyNormal = () => { try { _applyTextureAndScale(e, keyNormal, bodyW, bodyH); _resetBodySize(e); } catch (_) {} };
      if (e.scene?.textures?.exists?.(keyNormal)) applyNormal();
      else _ensureEnemyTexture(e.scene, keyNormal, applyNormal);
      // Proactively load charge texture if provided to avoid swap gaps
      if (keyCharge) _ensureEnemyTexture(e.scene, keyCharge);
    }
  } catch (_) {}
  // Orientation + optional charge swap per-frame
  const onUpdate = () => {
    try {
      const p = e.scene?.player; if (!p || !e.active) return;
      const faceLeft = (p.x < e.x);
      try { e._vis?.setFlipX?.(faceLeft); } catch (_) {}
      try { if (e._vis) e._vis.setPosition(e.x, e.y); } catch (_) {}
      try {
        if (e._hitbox && e._vis) {
          const w = Math.max(1, Math.round(e._vis.displayWidth || 12));
          const h = Math.max(1, Math.round(e._vis.displayHeight || 12));
          e._hitbox.body.setSize(w, h, true);
          e._hitbox.setPosition(e.x, e.y);
        }
      } catch (_) {}
      if (keyCharge && e.isGrenadier) {
        const wantKey = e._charging ? keyCharge : keyNormal;
        if (e._vis && e._vis.texture && e._vis.texture.key !== wantKey) {
          const applySwap = () => { try { _applyTextureAndScale(e, wantKey, bodyW, bodyH); } catch (_) {} };
          if (e.scene.textures.exists(wantKey)) applySwap();
          else _ensureEnemyTexture(e.scene, wantKey, applySwap);
        }
      }
    } catch (_) {}
  };
  try { e.scene?.events?.on?.('update', onUpdate); } catch (_) {}
  try {
    e.on('destroy', () => {
      try { e.scene?.events?.off?.('update', onUpdate); } catch (_) {}
      try { e._vis?.destroy?.(); e._vis = null; } catch (_) {}
      try { e._hitbox?.destroy?.(); e._hitbox = null; } catch (_) {}
      // Common VFX cleanups used by snipers/prisms/melee
      try { e._aimG?.clear?.(); e._aimG?.destroy?.(); e._aimG = null; } catch (_) {}
      try { e._laserG?.clear?.(); e._laserG?.destroy?.(); e._laserG = null; } catch (_) {}
      try { if (e._meleeLine?.cleanup) e._meleeLine.cleanup(); else e._meleeLine?.g?.destroy?.(); e._meleeLine = null; } catch (_) {}
      // Indicators
      try { e._g?.destroy(); } catch (_) {}
      try { e._igniteIndicator?.destroy(); e._igniteIndicator = null; } catch (_) {}
      try { e._toxinIndicator?.destroy(); e._toxinIndicator = null; } catch (_) {}
      // If running in BossScene, also clear any dash hint graphics stored on the scene
      try { const sc = e.scene; if (sc && sc._dashSeq) { sc._dashSeq._hintG?.destroy?.(); sc._dashSeq = null; } } catch (_) {}
    });
  } catch (_) {}
}

export function createEnemy(scene, x, y, hp = 100, damage = 10, speed = 60) {
  const e = scene.physics.add.sprite(x, y, 'enemy_square');
  e.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = damage;
  e.speed = speed;
  e.isEnemy = true;
  e.isMelee = true;
  _attachEnemyVisuals(e, 'enemy_shredder', null, 12, 12);
  return e;
}

// Fast melee "runner" enemy: 2x speed, ~30% less HP
export function createRunnerEnemy(scene, x, y, hp = 60, damage = 10, speed = 120) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp;
  r.maxHp = hp;
  r.damage = damage;
  r.speed = speed;
  r.isEnemy = true;
  r.isMelee = true;
  r.isRunner = true;
  _attachEnemyVisuals(r, 'enemy_charger', null, 12, 12);
  return r;
}

export function createBoss(scene, x, y, hp = 600, damage = 20, speed = 50) {
  const b = scene.physics.add.sprite(x, y, 'enemy_square');
  b.setSize(24, 24).setOffset(0, 0).setCollideWorldBounds(true);
  b.hp = hp;
  b.maxHp = hp;
  b.damage = damage;
  b.speed = speed;
  b.isBoss = true;
  b.setTint(0xaa00ff);
  b.on('destroy', () => b._g?.destroy());
  return b;
}

// Ranged shooter enemy: fires single bullets at intervals
export function createShooterEnemy(scene, x, y, hp = 90, damage = 10, speed = 45, fireRateMs = 900) {
  const s = scene.physics.add.sprite(x, y, 'enemy_square');
  s.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  s.hp = hp;
  s.maxHp = hp;
  s.damage = damage;
  s.speed = speed;
  s.isEnemy = true;
  s.isShooter = true;
  s.fireRateMs = fireRateMs;
  s.lastShotAt = 0;
  _attachEnemyVisuals(s, 'enemy_gunner', null, 12, 12);
  return s;
}

// Rocketeer: fires explosive rockets at 0.5/s, moderate HP, slow speed
export function createRocketeerEnemy(scene, x, y, hp = 80, damage = 12, speed = 40, fireRateMs = 2000) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp;
  r.maxHp = hp;
  r.damage = damage;
  r.speed = speed;
  r.isEnemy = true;
  r.isShooter = true;
  r.isRocketeer = true;
  r.fireRateMs = fireRateMs;
  r.lastShotAt = 0;
  _attachEnemyVisuals(r, 'enemy_rocketeer', null, 12, 12);
  return r;
}

// MachineGunner: tougher than shooter, slower movement, fires 12-bullet volleys
export function createMachineGunnerEnemy(
  scene,
  x,
  y,
  hp = 140,
  damage = 7,
  speed = 35,
  fireRateMs = 1100,
  burstCount = 15,
  spreadDeg = 14,
) {
  const m = scene.physics.add.sprite(x, y, 'enemy_square');
  m.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  m.hp = hp;
  m.maxHp = hp;
  m.damage = damage;
  m.speed = speed;
  m.isEnemy = true;
  m.isShooter = true;
  m.isMachineGunner = true;
  m.fireRateMs = fireRateMs;
  m.burstCount = burstCount; // bullets per burst
  m.burstGapMs = 70; // time between shots in a burst
  m.spreadDeg = spreadDeg; // small cone while spraying
  m.lastShotAt = 0;
  _attachEnemyVisuals(m, 'enemy_machine_gunner', null, 12, 12);
  return m;
}

// Sniper enemy: aims with a red laser for 1s, then fires a high-speed, high-damage shot.
export function createSniperEnemy(scene, x, y, hp = 80, damage = 24, speed = 40) {
  const sn = scene.physics.add.sprite(x, y, 'enemy_square');
  sn.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  sn.hp = hp;
  sn.maxHp = hp;
  sn.damage = damage;
  sn.speed = speed;
  sn.isEnemy = true;
  sn.isSniper = true;
  sn.aiming = false;
  sn.aimStartedAt = 0;
  sn.lastShotAt = 0;
  sn.aimDurationMs = 1000;
  sn.cooldownMs = 2000; // after shot
  sn._wanderChangeAt = 0;
  sn._wanderVX = 0;
  sn._wanderVY = 0;
  _attachEnemyVisuals(sn, 'enemy_sniper', null, 12, 12);
  return sn;
}

// Prism (elite): laser specialist with sweeping beam and locked beam ability
export function createPrismEnemy(scene, x, y, hp = 180, damage = 16, speed = 46) {
  const p = scene.physics.add.sprite(x, y, 'enemy_square');
  p.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  p.hp = hp;
  p.maxHp = hp;
  p.damage = damage;
  p.speed = speed;
  p.isEnemy = true;
  p.isShooter = true; // use shooter-style movement + pathfinding
  p.isPrism = true;
  // Visual distinction
  try { p.setScale(1.15); } catch (_) {}
  _attachEnemyVisuals(p, 'enemy_prism', null, 12, 12);
  return p;
}

// Snitch (elite): fast kiter, calls reinforcements, shotgun burst when close
export function createSnitchEnemy(scene, x, y, hp = 100, damage = 6, speed = 60) {
  const s = scene.physics.add.sprite(x, y, 'enemy_square');
  s.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  s.hp = hp; s.maxHp = hp; s.damage = damage; s.speed = speed;
  s.isEnemy = true; s.isShooter = true; s.isSnitch = true;
  _attachEnemyVisuals(s, 'enemy_commander', null, 12, 12);
  return s;
}

// Rook (elite melee): slow, tanky melee with frontal shield that blocks bullets
export function createRookEnemy(scene, x, y, hp = 300, damage = 25, speed = 35) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp; r.maxHp = hp; r.damage = damage; r.speed = speed;
  r.isEnemy = true; r.isMelee = true; r.isRook = true;
  _attachEnemyVisuals(r, 'enemy_rook', null, 12, 12);
  // Shield state: front arc (90 deg), slow turning
  r._shieldAngle = 0; // radians, facing right initially
  r._shieldG = null;
  // Bring shield closer to Rook, keep size constant
  r._shieldOffset = 2;
  r._shieldRadius = 60; // increased visual radius; offset unchanged
  r._shieldHalf = Phaser.Math.DegToRad ? Phaser.Math.DegToRad(45) : (Math.PI/4);
  r.on('destroy', () => { try { r._g?.destroy(); } catch (_) {} try { r._shieldG?.destroy(); r._shieldG = null; } catch (_) {} try { r._shieldFillG?.destroy(); r._shieldFillG = null; } catch (_) {} try { r._igniteIndicator?.destroy(); r._igniteIndicator = null; } catch (_) {} try { r._toxinIndicator?.destroy(); r._toxinIndicator = null; } catch (_) {} });
  // Ensure shield zone is cleaned up if managed by scene
  try { r.on('destroy', () => { try { r._shieldZone?.destroy?.(); r._shieldZone = null; } catch (_) {} }); } catch (_) {}
  return r;
}

// Grenadier (elite): lobs grenades in 3-round volleys, slightly larger body
export function createGrenadierEnemy(scene, x, y, hp = 260, damage = 14, speed = 48, burstCooldownMs = 2000) {
  const g = scene.physics.add.sprite(x, y, 'enemy_square');
  g.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  g.hp = hp;
  g.maxHp = hp;
  g.damage = damage;
  g.speed = speed;
  g.isEnemy = true;
  g.isGrenadier = true;
  // Mark as shooter for movement heuristics, but custom fire logic will handle attacks
  g.isShooter = true;
  g.burstCooldownMs = burstCooldownMs;
  g.lastShotAt = 0;
  // Proximity detonation trigger radius (must be < explosion radius)
  g.detonateTriggerRadius = 55;
  // Explosion radius used for damage and VFX (keep in sync)
  g.explosionRadius = 70;
  _attachEnemyVisuals(g, 'enemy_bombardier', 'enemy_bombardier_special', 12, 12);
  return g;
}
