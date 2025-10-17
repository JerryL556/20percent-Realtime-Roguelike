import { getWeaponById } from './Weapons.js';
import { weaponMods, weaponCores, armourMods } from './Mods.js';

function applyList(base, list, ids = []) {
  let w = { ...base };
  ids.forEach((id) => {
    const mod = list.find((m) => m.id === id) || list[0];
    w = mod.apply(w);
  });
  return w;
}

export function getEffectiveWeapon(gs, weaponId) {
  const base = getWeaponById(weaponId);
  const build = (gs.weaponBuilds && gs.weaponBuilds[weaponId]) || { mods: [null, null, null], core: null };
  const withMods = applyList(base, weaponMods, build.mods || []);
  const withCore = applyList(withMods, weaponCores, [build.core || null]);
  return withCore;
}

export function getPlayerEffects(gs) {
  const eff0 = { bonusHp: 0, moveSpeedMult: 1, dashRegenMs: gs?.dashRegenMs || 6000 };
  const mods = (gs?.armour?.mods) || [];
  let eff = { ...eff0 };
  mods.forEach((id) => {
    const m = armourMods.find((x) => x.id === id);
    if (m && typeof m.applyEffect === 'function') {
      eff = m.applyEffect(eff);
    }
  });
  return eff;
}
