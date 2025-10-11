export function createEnemy(scene, x, y, hp = 60, damage = 10, speed = 60) {
  const e = scene.physics.add.sprite(x, y, 'enemy_square');
  e.setSize(12, 12).setOffset(0, 0);
  e.hp = hp;
  e.maxHp = hp;
  e.damage = damage;
  e.speed = speed;
  e.isEnemy = true;
  e.on('destroy', () => e._g?.destroy());
  return e;
}

export function createBoss(scene, x, y, hp = 600, damage = 20, speed = 50) {
  const b = scene.physics.add.sprite(x, y, 'enemy_square');
  b.setSize(24, 24).setOffset(0, 0);
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
  s.setSize(12, 12).setOffset(0, 0);
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
