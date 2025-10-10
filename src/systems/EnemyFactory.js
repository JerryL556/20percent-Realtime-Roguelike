export function createEnemy(scene, x, y, hp = 20, damage = 10, speed = 60) {
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

export function createBoss(scene, x, y, hp = 300, damage = 20, speed = 50) {
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
