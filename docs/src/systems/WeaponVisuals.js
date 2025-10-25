// Minimal helper for showing weapon sprites for the player

// Map in-repo weapon ids -> texture keys and asset paths
export const WEAPON_TEXTURES = {
  // height = desired on-screen pixel height (auto-scaled)
  // mult = per-weapon multiplier applied on top of global WEAPON_SCALE_MULT
  pistol: { key: 'weapon_pistol', path: 'assets/PS.png', height: 8, mult: 0.8 }, // slightly smaller
  rifle: { key: 'weapon_rifle', path: 'assets/AR.png', height: 8, mult: 1.45 }, // slightly larger
  battle_rifle: { key: 'weapon_battle_rifle', path: 'assets/BR.png', height: 8, mult: 1.45 },
  shotgun: { key: 'weapon_shotgun', path: 'assets/SG.png', height: 8, mult: 1.1 }, // slightly larger
  smg: { key: 'weapon_smg', path: 'assets/SMG.png', height: 8, mult: 1.2 }, // slightly larger
  railgun: { key: 'weapon_railgun', path: 'assets/RG.png', height: 8, mult: 1.3 }, // increased
  rocket: { key: 'weapon_rocket', path: 'assets/RKT.png', height: 9, mult: 1.35 }, // larger
  mgl: { key: 'weapon_mgl', path: 'assets/MGL.png', height: 9, mult: 1.35 }, // dedicated MGL art
};

// Global multiplier to tweak all weapon sprite sizes uniformly
export const WEAPON_SCALE_MULT = 3;

// Optionally present in assets but not used as a weapon sprite here
const OPTIONAL_ASSETS = [
  { key: 'ability_ads', path: 'assets/ADS.png' },
  { key: 'ability_bit', path: 'assets/BIT.png' },
];

export function preloadWeaponAssets(scene) {
  try {
    Object.values(WEAPON_TEXTURES).forEach(({ key, path }) => {
      if (!scene.textures.exists(key)) scene.load.image(key, path);
    });
    OPTIONAL_ASSETS.forEach(({ key, path }) => {
      if (!scene.textures.exists(key)) scene.load.image(key, path);
    });
  } catch (_) { /* ignore */ }
}

export function textureKeyForWeaponId(weaponId) {
  const entry = WEAPON_TEXTURES[weaponId];
  return entry ? entry.key : null;
}

function desiredHeightForWeaponId(weaponId, fallback = 8) {
  const entry = WEAPON_TEXTURES[weaponId];
  return entry && typeof entry.height === 'number' ? entry.height : fallback;
}

function perWeaponMult(weaponId) {
  const entry = WEAPON_TEXTURES[weaponId];
  return entry && typeof entry.mult === 'number' ? entry.mult : 1;
}

function applyWeaponScale(scene, sprite, weaponId) {
  try {
    const key = sprite?.texture?.key;
    if (!key || !scene?.textures?.exists(key)) return;
    const desiredH = desiredHeightForWeaponId(weaponId);
    const tex = scene.textures.get(key);
    const src = tex.getSourceImage();
    const h = (src && (src.naturalHeight || src.height)) || tex.frames['__BASE']?.height || sprite.height;
    if (h && h > 0) {
      const scale = (desiredH / h) * WEAPON_SCALE_MULT * perWeaponMult(weaponId);
      sprite.setScale(scale);
    }
  } catch (_) { /* ignore */ }
}

export function createPlayerWeaponSprite(scene) {
  const gs = scene.registry.get('gameState') || {};
  const desired = textureKeyForWeaponId(gs.activeWeapon) || textureKeyForWeaponId('pistol');
  const hasDesired = desired && scene.textures && scene.textures.exists(desired);
  const s = scene.add.image(scene.player.x, scene.player.y, hasDesired ? desired : 'player_square');
  // Set origin near the grip so rotation looks natural
  s.setOrigin(0.15, 0.5);
  // Place above player square
  try { s.setDepth((scene.player.depth || 0) + 1); } catch (_) { s.setDepth(10); }
  // Auto scale to a small on-screen height so it fits the 12x12 player
  applyWeaponScale(scene, s, gs.activeWeapon);
  scene.weaponSprite = s;
  return s;
}

export function syncWeaponTexture(scene, weaponId) {
  if (!scene.weaponSprite) return;
  const key = textureKeyForWeaponId(weaponId);
  if (key && scene.textures && scene.textures.exists(key) && scene.weaponSprite.texture && scene.weaponSprite.texture.key !== key) {
    try {
      scene.weaponSprite.setTexture(key);
      applyWeaponScale(scene, scene.weaponSprite, weaponId);
    } catch (_) {}
  }
}

export function updateWeaponSprite(scene) {
  if (!scene.weaponSprite || !scene.player) return;
  const ptr = scene.input?.activePointer;
  const px = scene.player.x, py = scene.player.y;
  let angle = scene.playerFacing || 0;
  try {
    if (ptr) angle = Phaser.Math.Angle.Between(px, py, ptr.worldX, ptr.worldY);
  } catch (_) {}
  scene.playerFacing = angle;

  // Offset in front of the player
  const dist = 10;
  const x = px + Math.cos(angle) * dist;
  const y = py + Math.sin(angle) * dist;
  scene.weaponSprite.setPosition(x, y);
  scene.weaponSprite.setRotation(angle);

  // Optional flipping if needed for your art; generally not required for top-down
  // Flip vertically when pointing left to keep sprite upright if drawn horizontally
  const deg = Phaser.Math.RadToDeg(angle);
  const pointingLeft = (deg > 90 || deg < -90);
  try { scene.weaponSprite.setFlipY(pointingLeft); } catch (_) {}
}

// Generic helpers for sizing arbitrary images by desired pixel height
export function fitImageHeight(scene, sprite, desiredPx = 12) {
  try {
    const key = sprite?.texture?.key;
    if (!key || !scene?.textures?.exists(key)) return sprite;
    const tex = scene.textures.get(key);
    const src = tex.getSourceImage();
    const h = (src && (src.naturalHeight || src.height)) || tex.frames['__BASE']?.height || sprite.height;
    if (h && h > 0) {
      const scale = desiredPx / h;
      sprite.setScale(scale);
    }
  } catch (_) { /* ignore */ }
  return sprite;
}

export function createFittedImage(scene, x, y, key, desiredPx = 12) {
  const img = scene.add.image(x, y, key);
  fitImageHeight(scene, img, desiredPx);
  return img;
}
