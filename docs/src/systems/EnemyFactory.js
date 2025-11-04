export function createEnemy(scene, x, y, hp = 100, damage = 10, speed = 60) {
  const e = scene.physics.add.sprite(x, y, 'enemy_square');
  e.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = damage;
  e.speed = speed;
  e.isEnemy = true;
  e.isMelee = true;
  e.on('destroy', () => { try { e._g?.destroy(); } catch (_) {} try { e._igniteIndicator?.destroy(); e._igniteIndicator = null; } catch (_) {} try { e._toxinIndicator?.destroy(); e._toxinIndicator = null; } catch (_) {} });
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
  r.setTint(0xff6666);
  r.on('destroy', () => { try { r._g?.destroy(); } catch (_) {} try { r._igniteIndicator?.destroy(); r._igniteIndicator = null; } catch (_) {} try { r._toxinIndicator?.destroy(); r._toxinIndicator = null; } catch (_) {} });
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
  s.setTint(0x66aaff);
  s.on('destroy', () => { try { s._g?.destroy(); } catch (_) {} try { s._igniteIndicator?.destroy(); s._igniteIndicator = null; } catch (_) {} try { s._toxinIndicator?.destroy(); s._toxinIndicator = null; } catch (_) {} });
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
  // Orange tint to indicate explosive unit
  r.setTint(0xff8844);
  r.on('destroy', () => { try { r._g?.destroy(); } catch (_) {} try { r._igniteIndicator?.destroy(); r._igniteIndicator = null; } catch (_) {} try { r._toxinIndicator?.destroy(); r._toxinIndicator = null; } catch (_) {} });
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
  // Distinct tint (teal-ish)
  m.setTint(0x22ddaa);
  m.on('destroy', () => { try { m._g?.destroy(); } catch (_) {} try { m._igniteIndicator?.destroy(); m._igniteIndicator = null; } catch (_) {} try { m._toxinIndicator?.destroy(); m._toxinIndicator = null; } catch (_) {} });
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
  // Purple tint to distinguish snipers clearly
  sn.setTint(0xaa00ff);
  sn.on('destroy', () => { try { sn._aimG?.destroy(); } catch (_) {} try { sn._g?.destroy(); } catch (_) {} try { sn._igniteIndicator?.destroy(); sn._igniteIndicator = null; } catch (_) {} try { sn._toxinIndicator?.destroy(); sn._toxinIndicator = null; } catch (_) {} });
  return sn;
}

// Prism (elite): laser specialist with sweeping beam and locked beam ability
export function createPrismEnemy(scene, x, y, hp = 180, damage = 16, speed = 46) {
  const p = scene.physics.add.sprite(x, y, 'enemy_square');
  p.setSize(14, 14).setOffset(0, 0).setCollideWorldBounds(true);
  p.hp = hp;
  p.maxHp = hp;
  p.damage = damage;
  p.speed = speed;
  p.isEnemy = true;
  p.isShooter = true; // use shooter-style movement + pathfinding
  p.isPrism = true;
  // Visual distinction
  try { p.setScale(1.15); } catch (_) {}
  p.setTint(0x66ccff);
  p.on('destroy', () => { try { p._aimG?.destroy(); } catch (_) {} try { p._laserG?.destroy(); } catch (_) {} try { p._igniteIndicator?.destroy(); p._igniteIndicator = null; } catch (_) {} try { p._toxinIndicator?.destroy(); p._toxinIndicator = null; } catch (_) {} });
  return p;
}

// Snitch (elite): fast kiter, calls reinforcements, shotgun burst when close
export function createSnitchEnemy(scene, x, y, hp = 100, damage = 6, speed = 60) {
  const s = scene.physics.add.sprite(x, y, 'enemy_square');
  s.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  s.hp = hp; s.maxHp = hp; s.damage = damage; s.speed = speed;
  s.isEnemy = true; s.isShooter = true; s.isSnitch = true;
  // Visual: greenish tint
  s.setTint(0x66ff88);
  s.on('destroy', () => { try { s._g?.destroy(); } catch (_) {} try { s._igniteIndicator?.destroy(); s._igniteIndicator = null; } catch (_) {} try { s._toxinIndicator?.destroy(); s._toxinIndicator = null; } catch (_) {} });
  return s;
}

// Rook (elite melee): slow, tanky melee with frontal shield that blocks bullets
export function createRookEnemy(scene, x, y, hp = 300, damage = 25, speed = 35) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(14, 14).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp; r.maxHp = hp; r.damage = damage; r.speed = speed;
  r.isEnemy = true; r.isMelee = true; r.isRook = true;
  // Visual distinction
  try { r.setTint(0x99aabb); } catch (_) {}
  // Shield state: front arc (90 deg), slow turning
  r._shieldAngle = 0; // radians, facing right initially
  r._shieldG = null;
  r._shieldOffset = 18; // further from Rook
  r._shieldRadius = 28 + r._shieldOffset; // larger radius correlated with offset
  r._shieldHalf = Phaser.Math.DegToRad ? Phaser.Math.DegToRad(45) : (Math.PI/4);
  r.on('destroy', () => { try { r._g?.destroy(); } catch (_) {} try { r._shieldG?.destroy(); r._shieldG = null; } catch (_) {} try { r._igniteIndicator?.destroy(); r._igniteIndicator = null; } catch (_) {} try { r._toxinIndicator?.destroy(); r._toxinIndicator = null; } catch (_) {} });
  // Ensure shield zone is cleaned up if managed by scene
  try { r.on('destroy', () => { try { r._shieldZone?.destroy?.(); r._shieldZone = null; } catch (_) {} }); } catch (_) {}
  return r;
}

// Grenadier (elite): lobs grenades in 3-round volleys, slightly larger body
export function createGrenadierEnemy(scene, x, y, hp = 260, damage = 14, speed = 48, burstCooldownMs = 2000) {
  const g = scene.physics.add.sprite(x, y, 'enemy_square');
  g.setSize(14, 14).setOffset(0, 0).setCollideWorldBounds(true);
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
  // Distinct tint (red-orange) and slight scale to stand out as elite
  try { g.setScale(1.2); } catch (_) {}
  g.setTint(0xdd5533);
  g.on('destroy', () => { try { g._g?.destroy(); } catch (_) {} try { g._igniteIndicator?.destroy(); g._igniteIndicator = null; } catch (_) {} try { g._toxinIndicator?.destroy(); g._toxinIndicator = null; } catch (_) {} });
  return g;
}
