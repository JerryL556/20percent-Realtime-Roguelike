// Edit this file to customize weapons
// Each weapon has: id, name, damage, fireRateMs, bulletSpeed, pelletCount, spreadDeg, color, price
export const weaponDefs = [
  {
    id: 'pistol',
    name: 'Pistol',
    damage: 15,
    fireRateMs: 220,
    bulletSpeed: 360,
    pelletCount: 1,
    spreadDeg: 0,
    color: 0xffff66,
    price: 0,
  },
  {
    id: 'rifle',
    name: 'Rifle',
    damage: 10,
    fireRateMs: 120,
    bulletSpeed: 440,
    pelletCount: 1,
    spreadDeg: 0,
    color: 0x66ccff,
    price: 60,
  },
  {
    id: 'shotgun',
    name: 'Shotgun',
    damage: 6,
    fireRateMs: 450,
    bulletSpeed: 340,
    pelletCount: 5,
    spreadDeg: 18,
    color: 0xffaa66,
    price: 80,
  },
];

export const defaultWeaponId = 'pistol';

export function getWeaponById(id) {
  return weaponDefs.find((w) => w.id === id) || weaponDefs[0];
}

