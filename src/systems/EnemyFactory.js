export function createEnemy(scene, x, y, hp = 60, damage = 10, speed = 60) {
  const e = scene.physics.add.sprite(x, y, 'enemy_square');
  e.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = damage;
  e.speed = speed;
  e.isEnemy = true;
  e.on('destroy', () => e._g?.destroy());
  return e;
}

// Fast melee "runner" enemy: 2x speed, ~30% less HP
export function createRunnerEnemy(scene, x, y, hp = 42, damage = 10, speed = 120) {
  const r = scene.physics.add.sprite(x, y, 'enemy_square');
  r.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
  r.hp = hp;
  r.maxHp = hp;
  r.damage = damage;
  r.speed = speed;
  r.isEnemy = true;
  r.isRunner = true;
  r.setTint(0xff6666);
  r.on('destroy', () => r._g?.destroy());
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
  s.on('destroy', () => s._g?.destroy());
  return s;
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
  sn.on('destroy', () => {
    try { sn._aimG?.destroy(); } catch (_) {}
    try { sn._g?.destroy(); } catch (_) {}
  });
  return sn;
}
