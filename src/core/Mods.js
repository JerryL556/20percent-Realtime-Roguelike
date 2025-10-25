// Simple, customizable mod/core system. Extend these lists as you add content.

// Weapon normal mods (3 slots)
export const weaponMods = [
  { id: null, name: 'Empty', desc: 'No changes', apply: (w) => w },
  { id: 'w_dmg_up', name: 'FMJ Rounds', desc: '+10% damage', apply: (w) => ({ ...w, damage: Math.floor(w.damage * 1.1) }) },
  { id: 'w_firerate_up', name: 'Custom Trigger', desc: '+12% fire rate', apply: (w) => ({ ...w, fireRateMs: Math.max(60, Math.floor(w.fireRateMs * 0.88)) }) },
  {
    id: 'w_spread_down',
    name: 'Muzzle Brake',
    desc: '-20% spread angle & bloom cap',
    apply: (w) => {
      const newBase = Math.max(0, Math.floor((w.spreadDeg || 0) * 0.8));
      const hasMax = typeof w.maxSpreadDeg === 'number';
      const newMax = hasMax ? Math.max(0, Math.floor(w.maxSpreadDeg * 0.8)) : undefined;
      return hasMax ? { ...w, spreadDeg: newBase, maxSpreadDeg: newMax } : { ...w, spreadDeg: newBase };
    },
  },
  { id: 'w_speed_up', name: 'Advanced Propellant', desc: '+15% bullet speed', apply: (w) => ({ ...w, bulletSpeed: Math.floor(w.bulletSpeed * 1.15) }) },
];

// Weapon cores (1 slot)
export const weaponCores = [
  { id: null, name: 'No Core', desc: 'No special effect', apply: (w) => w },
  { id: 'core_pierce', name: 'Piercing Core', desc: '+Bullets pierce one target', apply: (w) => ({ ...w, _core: 'pierce' }) },
  {
    id: 'core_blast',
    name: 'Explosive Core',
    desc: '+Small explosion on hit',
    // Do not apply to explosive weapons (rocket-like projectiles)
    apply: (w) => {
      if (!w) return w;
      if (w.projectile === 'rocket') return w; // disallow on explosive weapons (e.g., rocket, mgl)
      return { ...w, _core: 'blast' };
    },
  },
  {
    id: 'core_burst_rifle',
    name: 'Burst Fire',
    onlyFor: 'rifle',
    desc: [
      'Assault Rifle only',
      '+ Fires 3 rounds per click',
      '+ Short gap between bursts',
      '+ Greatly increased bullet speed',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'rifle') return w;
      return {
        ...w,
        singleFire: true,
        _burstN: 3,
        _burstGapMs: 70,
        // Gap between bursts is governed by fireRateMs from initial shot
        fireRateMs: 360,
        // Substantially increase muzzle velocity
        bulletSpeed: 800,
      };
    },
  },
  {
    id: 'core_2tap_pistol',
    name: '2Tap Trigger',
    onlyFor: 'pistol',
    desc: [
      'Pistol only',
      '+ Fires two quick, accurate rounds per click',
      '+ Slightly increases time between clicks',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'pistol') return w;
      const slower = Math.floor((w.fireRateMs || 220) * 1.2); // +20% interval between pulls
      return { ...w, _twoTap: true, fireRateMs: slower };
    },
  },
  {
    id: 'core_smart_explosives',
    name: 'Smart Explosives',
    onlyFor: 'rocket',
    desc: [
      'Explosive weapons only',
      '+ Proximity-detonates when enemies are near',
      '+ Detect radius < blast radius',
      '+ If no target at aim point, becomes a mine',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.projectile !== 'rocket') return w;
      return { ...w, _smartExplosives: true, _detectScale: 0.65 };
    },
  },
  {
    id: 'core_smart_explosives_mgl',
    name: 'Smart Explosives',
    onlyFor: 'mgl',
    desc: [
      'Explosive weapons only',
      '+ Proximity-detonates when enemies are near',
      '+ Detect radius < blast radius',
      '+ If no target at aim point, becomes a mine',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.projectile !== 'rocket') return w;
      return { ...w, _smartExplosives: true, _detectScale: 0.65 };
    },
  },
  {
    id: 'core_rail_hold',
    name: 'Rail Stabilizer',
    onlyFor: 'railgun',
    desc: 'Railgun only\nHold max charge without auto-fire',
    apply: (w) => {
      if (!w || w.id !== 'railgun') return w;
      return { ...w, railHold: true };
    },
  },
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
  {
    id: 'core_battle_semi',
    name: 'Semi Auto',
    onlyFor: 'battle_rifle',
    desc: [
      'Battle Rifle only',
      '- Single-fire',
      '- Mag size: 25 -> 18 (-28%)',
      '+ Damage: 16 -> 28 (+75%)',
      '+ Bullet speed: 575 -> 750 (+30%)',
    ].join('\n'),
    apply: (w) => {
      if (!w || w.id !== 'battle_rifle') return w;
      return {
        ...w,
        singleFire: true,
        magSize: 18,
        damage: 28,
        bulletSpeed: 750,
      };
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
