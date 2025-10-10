import { RNG } from './RNG.js';

export const Difficulty = Object.freeze({
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'Hard',
});

export function difficultyModifiers(diff) {
  switch (diff) {
    case Difficulty.Easy:
      return { enemyHp: 0.8, enemyDamage: 0.8 };
    case Difficulty.Hard:
      return { enemyHp: 1.4, enemyDamage: 1.4 };
    case Difficulty.Normal:
    default:
      return { enemyHp: 1.0, enemyDamage: 1.0 };
  }
}

export class GameState {
  constructor() {
    this.gold = 0;
    this.maxHp = 100;
    this.hp = 100;
    // Equipment layout: two weapons, one armour, two special
    this.inventory = {
      weapon1: null,
      weapon2: null,
      armour: null,
      special1: null,
      special2: null,
    };
    this.weaponMods = {}; // weaponId -> mods array
    this.ownedWeapons = ['pistol'];
    this.activeWeapon = 'pistol';
    this.difficulty = Difficulty.Normal;
    this.runSeed = Date.now() >>> 0;
    this.rng = new RNG(this.runSeed);
    this.roomsClearedInCycle = 0; // after 3, spawn boss
    this.currentDepth = 1; // increments per combat
    this.achievements = {};
    this.nextScene = 'Hub';
    // Dash settings
    this.dashMaxCharges = 3;
    this.dashRegenMs = 6000;
  }

  startNewRun(seed, difficulty) {
    this.gold = 0;
    this.maxHp = 100;
    this.hp = 100;
    this.inventory = { weapon1: null, weapon2: null, armour: null, special1: null, special2: null };
    this.weaponMods = {};
    this.ownedWeapons = ['pistol'];
    this.activeWeapon = 'pistol';
    if (seed) this.runSeed = seed >>> 0;
    if (difficulty) this.difficulty = difficulty;
    this.rng = new RNG(this.runSeed);
    this.roomsClearedInCycle = 0;
    this.currentDepth = 1;
    this.nextScene = 'Hub';
    this.dashMaxCharges = 3;
    this.dashRegenMs = 6000;
  }

  getDifficultyMods() {
    return difficultyModifiers(this.difficulty);
  }

  progressAfterCombat() {
    this.roomsClearedInCycle += 1;
    this.currentDepth += 1;
    if (this.roomsClearedInCycle >= 3) {
      this.roomsClearedInCycle = 0;
      this.nextScene = 'Boss';
    } else {
      this.nextScene = 'Combat';
    }
  }

  progressAfterBoss() {
    this.nextScene = 'Hub';
  }

  serialize() {
    return {
      gold: this.gold,
      maxHp: this.maxHp,
      hp: this.hp,
      inventory: this.inventory,
      weaponMods: this.weaponMods,
      ownedWeapons: this.ownedWeapons,
      activeWeapon: this.activeWeapon,
      difficulty: this.difficulty,
      runSeed: this.runSeed,
      roomsClearedInCycle: this.roomsClearedInCycle,
      currentDepth: this.currentDepth,
      achievements: this.achievements,
      nextScene: this.nextScene,
      dashMaxCharges: this.dashMaxCharges,
      dashRegenMs: this.dashRegenMs,
    };
  }

  static deserialize(obj) {
    const gs = new GameState();
    Object.assign(gs, obj);
    gs.rng = new RNG(gs.runSeed);
    if (!gs.ownedWeapons) gs.ownedWeapons = ['pistol'];
    if (!gs.activeWeapon) gs.activeWeapon = gs.ownedWeapons[0] || 'pistol';
    gs.dashMaxCharges = Math.min(gs.dashMaxCharges || 3, 5);
    gs.dashRegenMs = Math.max(gs.dashRegenMs || 6000, 6000);
    return gs;
  }
}
