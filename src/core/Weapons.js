// Edit this file to customize weapons
// Each weapon has: id, name, damage, fireRateMs, bulletSpeed, pelletCount, spreadDeg, color, price, magSize
export const weaponDefs = [
  {
    id: 'pistol',
    name: 'Pistol',
    damage: 18,
    fireRateMs: 220,
    bulletSpeed: 450,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 12,
    color: 0xffff66,
    price: 0,
    magSize: 15,
    singleFire: true,
  },
  {
    id: 'laser',
    name: 'Laser Beam',
    // Continuous beam weapon: no magazine, uses heat/overheat
    damage: 40, // DPS applied continuously in code
    fireRateMs: 0, // handled continuously
    bulletSpeed: 0,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 0,
    color: 0xff3344,
    price: 220,
    magSize: 1, // unused for laser; UI uses heat bar
    isLaser: true,
    reloadMs: 2000, // cooldown duration after overheat
  },
  {
    id: 'mgl',
    name: 'MGL',
    // 6-round mag grenade launcher; explosive rounds
    damage: 20, // direct hit
    aoeDamage: 35, // AoE splash
    fireRateMs: 333, // ~3/s
    bulletSpeed: 380, // faster than rocket (300)
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 6,
    color: 0xffaa33,
    price: 150,
    singleFire: true,
    projectile: 'rocket', // reuse explosive projectile behavior
    blastRadius: 52, // smaller than rocket (70)
    magSize: 6,
    reloadMs: 2600, // long reload
  },
  {
    id: 'railgun',
    name: 'Railgun',
    damage: 24,
    fireRateMs: 350,
    bulletSpeed: 1560,
    pelletCount: 1,
    spreadDeg: 15, // uncharged spread (deg)
    maxSpreadDeg: 0,
    color: 0x66aaff,
    price: 200,
    singleFire: true,
    magSize: 3,
    isRailgun: true,
  },
  {
    id: 'rifle',
    name: 'Assult Rifle',
    damage: 10,
    fireRateMs: 111,
    bulletSpeed: 500,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 8,
    color: 0x66ccff,
    price: 60,
    magSize: 30,
  },
  {
    id: 'battle_rifle',
    name: 'Battle Rifle',
    // Higher damage than rifle, slower fire rate, more accurate, 25-round mag
    damage: 16,
    fireRateMs: 160,
    bulletSpeed: 575,
    pelletCount: 1,
    spreadDeg: 0,
    maxSpreadDeg: 4,
    color: 0x88bbff,
    price: 120,
    magSize: 25,
  },
  {
    id: 'shotgun',
    name: 'Shotgun',
    damage: 10,
    fireRateMs: 450,
    bulletSpeed: 340,
    pelletCount: 5,
    spreadDeg: 12,
    maxSpreadDeg: 6,
    color: 0xffaa66,
    price: 80,
    magSize: 8,
  },
  {
    id: 'smg',
    name: 'SMG',
    damage: 6,
    fireRateMs: 65,
    bulletSpeed: 420,
    pelletCount: 1,
    spreadDeg: 1,
    maxSpreadDeg: 24,
    color: 0x99ff99,
    price: 90,
    magSize: 45,
  },
  {
    id: 'rocket',
    name: 'Rocket Launcher',
    damage: 30, // direct hit
    aoeDamage: 50, // AoE splash
    fireRateMs: 700,
    bulletSpeed: 300,
    pelletCount: 1,
    spreadDeg: 0,
    color: 0xff5533,
    price: 120,
    singleFire: true,
    projectile: 'rocket',
    blastRadius: 80,
    magSize: 1,
  },
];

export const defaultWeaponId = 'pistol';

export function getWeaponById(id) {
  return weaponDefs.find((w) => w.id === id) || weaponDefs[0];
}
