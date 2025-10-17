// Simple, customizable mod/core system. Extend these lists as you add content.

// Weapon normal mods (3 slots)
export const weaponMods = [
  { id: null, name: 'Empty', desc: 'No changes', apply: (w) => w },
  { id: 'w_dmg_up', name: 'FMJ Rounds', desc: '+10% damage', apply: (w) => ({ ...w, damage: Math.floor(w.damage * 1.1) }) },
  { id: 'w_firerate_up', name: 'Custom Trigger', desc: '+12% fire rate', apply: (w) => ({ ...w, fireRateMs: Math.max(60, Math.floor(w.fireRateMs * 0.88)) }) },
  { id: 'w_spread_down', name: 'Muzzle Brake', desc: '-20% spread angle', apply: (w) => ({ ...w, spreadDeg: Math.max(0, Math.floor(w.spreadDeg * 0.8)) }) },
  { id: 'w_speed_up', name: 'Advanced Propellant', desc: '+15% bullet speed', apply: (w) => ({ ...w, bulletSpeed: Math.floor(w.bulletSpeed * 1.15) }) },
];

// Weapon cores (1 slot)
export const weaponCores = [
  { id: null, name: 'No Core', desc: 'No special effect', apply: (w) => w },
  { id: 'core_pierce', name: 'Piercing Core', desc: '+Bullets pierce one target', apply: (w) => ({ ...w, _core: 'pierce' }) },
  { id: 'core_blast', name: 'Explosive Core', desc: '+Small explosion on hit', apply: (w) => ({ ...w, _core: 'blast' }) },
  {
    id: 'core_lead_storm',
    name: 'Lead Storm',
    onlyFor: 'shotgun',
    desc: 'Shotgun only\n+200% fire rate\nPellets: 10\n-50% damage\n+75% spread',
    apply: (w) => {
      // Apply only when the weapon matches the required id
      if (!w || w.id !== 'shotgun') return w;
      const faster = Math.max(60, Math.floor((w.fireRateMs || 300) / 3));
      const newDmg = Math.max(1, Math.floor((w.damage || 1) * 0.5));
      const newSpread = Math.max(0, Math.floor((w.spreadDeg || 0) * 1.75));
      return { ...w, fireRateMs: faster, pelletCount: 10, damage: newDmg, spreadDeg: newSpread };
    },
  },
];

// Armour mods (2 slots)
export const armourMods = [
  { id: null, name: 'Empty', desc: 'No changes', apply: (a) => a, applyEffect: (e) => e },
  {
    id: 'a_hp_up',
    name: 'Extra Padding',
    desc: '+40 max HP\n-10% movement speed',
    apply: (a) => ({ ...a, bonusHp: (a.bonusHp || 0) + 40, moveSpeedMult: (a.moveSpeedMult || 1) * 0.9 }),
    applyEffect: (e) => ({ ...e, bonusHp: (e.bonusHp || 0) + 40, moveSpeedMult: (e.moveSpeedMult || 1) * 0.9 }),
  },
  {
    id: 'a_dr_small',
    name: 'Kevlar Padding',
    desc: 'Dash recharge 4s per charge',
    apply: (a) => ({ ...a, dashRegenMs: Math.min(4000, a.dashRegenMs || 4000) }),
    applyEffect: (e) => ({ ...e, dashRegenMs: Math.min(4000, e.dashRegenMs || 999999) }),
  },
];

// Armour list is intentionally minimal; you can extend later.
export const armourDefs = [
  { id: null, name: 'No Armour' },
  { id: 'leather', name: 'Leather Vest' },
  { id: 'kevlar', name: 'Kevlar Suit' },
];
