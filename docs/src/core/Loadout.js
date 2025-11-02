import { getWeaponById } from './Weapons.js';
import { weaponMods, weaponCores, armourMods } from './Mods.js';

// Ensure weapon mod selections are valid per rules:
// - No duplicate mod IDs on the same weapon
// - Only one magazine-type mod (ids starting with 'w_mag_') per weapon
function sanitizeWeaponMods(modIds = []) {
  const seen = new Set();
  let magTaken = false;
  return (modIds || []).map((id) => {
    if (!id) return null;
    if (seen.has(id)) return null;
    const isMag = String(id).startsWith('w_mag_');
    if (isMag) {
      if (magTaken) return null;
      magTaken = true;
    }
    seen.add(id);
    return id;
  });
}

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
  const safeMods = sanitizeWeaponMods(build.mods || []);
  const withMods = applyList(base, weaponMods, safeMods);
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
