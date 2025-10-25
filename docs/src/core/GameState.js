import { RNG } from './RNG.js';

export const Difficulty = Object.freeze({
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'Hard',
});

export function difficultyModifiers(diff) {
  switch (diff) {
    case Difficulty.Easy:
      return { enemyHp: 0.8, enemyDamage: 0.5 };
    case Difficulty.Hard:
      return { enemyHp: 1.4, enemyDamage: 2.0 };
    case Difficulty.Normal:
    default:
      return { enemyHp: 1.0, enemyDamage: 1.0 };
  }
}

export class GameState {
  constructor() {
    this.gold = 99999; // testing default
    this.xp = 0;
    this.maxHp = 100;
    this.hp = 100;
    // Equipment & loadout
    // Two weapon slots; active is the one currently used for shooting
    this.ownedWeapons = ['pistol'];
    this.equippedWeapons = ['pistol', null]; // ids or null
    this.activeWeapon = 'pistol'; // mirrors currently active equipped weapon
    // Armour slot
    this.armour = { id: null, mods: [null, null] };
    // Per-weapon build: mods (3) + core (1); keyed by weaponId
    this.weaponBuilds = {}; // weaponId -> { mods: [m1,m2,m3], core: coreId }
    this.difficulty = Difficulty.Normal;
    this.runSeed = Date.now() >>> 0;
    this.rng = new RNG(this.runSeed);
    this.roomsClearedInCycle = 0; // after 3, spawn boss
    this.currentDepth = 1; // increments per combat
    this.achievements = {};
    this.nextScene = 'Hub';
    // Game mode: 'Normal' or 'BossRush'
    this.gameMode = 'Normal';
    // Boss Rush sequence queue (array of boss type strings)
    this.bossRushQueue = [];
    // Track last spawned boss type in Normal mode to alternate
    this.lastBossType = null; // 'Shotgunner' | 'Charger' | null
    // Ability equipped (gadget)
    this.abilityId = 'ads';
    // Dash settings
    this.dashMaxCharges = 3;
    this.dashRegenMs = 6000;
  }

  startNewRun(seed, difficulty) {
    this.gold = 99999; // testing default
    this.xp = 0;
    this.maxHp = 100;
    this.hp = 100;
    this.ownedWeapons = ['pistol'];
    this.equippedWeapons = ['pistol', null];
    this.activeWeapon = 'pistol';
    this.armour = { id: null, mods: [null, null] };
    this.weaponBuilds = {};
    if (seed) this.runSeed = seed >>> 0;
    if (difficulty) this.difficulty = difficulty;
    this.rng = new RNG(this.runSeed);
    this.roomsClearedInCycle = 0;
    this.currentDepth = 1;
    this.nextScene = 'Hub';
    this.gameMode = 'Normal';
    this.bossRushQueue = [];
    this.lastBossType = null;
    this.abilityId = 'ads';
    this.dashMaxCharges = 3;
    this.dashRegenMs = 6000;
  }

  getDifficultyMods() {
    return difficultyModifiers(this.difficulty);
  }

  progressAfterCombat() {
    // In Normal mode: 3 rooms then a boss
    if (this.gameMode === 'BossRush') {
      // Not used in BossRush; keep safe default to Boss
      this.nextScene = 'Boss';
      return;
    }
    this.roomsClearedInCycle += 1;
    this.currentDepth += 1;
    if (this.roomsClearedInCycle >= 3) { this.roomsClearedInCycle = 0; this.nextScene = 'Boss'; }
    else { this.nextScene = 'Combat'; }
  }

  progressAfterBoss() {
    if (this.gameMode === 'BossRush') {
      // Remove the defeated boss and decide next
      if (Array.isArray(this.bossRushQueue) && this.bossRushQueue.length > 0) {
        this.bossRushQueue = this.bossRushQueue.slice(1);
      }
      if (this.bossRushQueue && this.bossRushQueue.length > 0) {
        this.nextScene = 'Boss';
      } else {
        // Finished all bosses
        this.nextScene = 'Hub';
      }
      return;
    }
    this.nextScene = 'Hub';
  }

  // Decide the next boss type for spawning (does not mutate queues except to init BossRush)
  chooseBossType() {
    if (this.gameMode === 'BossRush') {
      if (!Array.isArray(this.bossRushQueue) || this.bossRushQueue.length === 0) {
        this.setGameMode('BossRush');
      }
      return (this.bossRushQueue && this.bossRushQueue[0]) ? this.bossRushQueue[0] : 'Charger';
    }
    // Normal mode: alternate to ensure both appear over time
    if (this.lastBossType === 'Charger') return 'Shotgunner';
    return 'Charger';
  }

  // Change game mode and initialize any mode-specific state
  setGameMode(mode) {
    this.gameMode = (mode === 'BossRush') ? 'BossRush' : 'Normal';
    if (this.gameMode === 'BossRush') {
      // Initialize a shuffled list of bosses for this run
      const bosses = ['Shotgunner', 'Charger'];
      // Fisher–Yates using run RNG
      for (let i = bosses.length - 1; i > 0; i -= 1) {
        const j = this.rng.int(0, i);
        const tmp = bosses[i]; bosses[i] = bosses[j]; bosses[j] = tmp;
      }
      this.bossRushQueue = bosses;
      this.roomsClearedInCycle = 0;
      this.currentDepth = 1;
      this.nextScene = 'Boss';
    } else {
      this.bossRushQueue = [];
      this.roomsClearedInCycle = 0;
      this.currentDepth = 1;
      this.nextScene = 'Hub';
    }
  }

  serialize() {
    return {
      gold: this.gold,
      xp: this.xp,
      maxHp: this.maxHp,
      hp: this.hp,
      ownedWeapons: this.ownedWeapons,
      equippedWeapons: this.equippedWeapons,
      activeWeapon: this.activeWeapon,
      armour: this.armour,
      weaponBuilds: this.weaponBuilds,
      ownedWeapons: this.ownedWeapons,
      difficulty: this.difficulty,
      runSeed: this.runSeed,
      roomsClearedInCycle: this.roomsClearedInCycle,
      currentDepth: this.currentDepth,
      achievements: this.achievements,
      nextScene: this.nextScene,
      gameMode: this.gameMode,
      bossRushQueue: this.bossRushQueue,
      lastBossType: this.lastBossType,
      abilityId: this.abilityId,
      dashMaxCharges: this.dashMaxCharges,
      dashRegenMs: this.dashRegenMs,
    };
  }

  static deserialize(obj) {
    const gs = new GameState();
    Object.assign(gs, obj);
    if (typeof gs.xp !== 'number') gs.xp = 0;
    gs.rng = new RNG(gs.runSeed);
    if (!gs.ownedWeapons) gs.ownedWeapons = ['pistol'];
    if (!gs.equippedWeapons || !Array.isArray(gs.equippedWeapons)) gs.equippedWeapons = [gs.ownedWeapons[0] || 'pistol', null];
    if (!gs.activeWeapon) gs.activeWeapon = gs.equippedWeapons[0] || gs.ownedWeapons[0] || 'pistol';
    if (!gs.armour) gs.armour = { id: null, mods: [null, null] };
    if (!gs.weaponBuilds) gs.weaponBuilds = {};
    gs.dashMaxCharges = Math.min(gs.dashMaxCharges || 3, 5);
    gs.dashRegenMs = Math.max(gs.dashRegenMs || 6000, 6000);
    if (!gs.gameMode) gs.gameMode = 'Normal';
    if (!Array.isArray(gs.bossRushQueue)) gs.bossRushQueue = [];
    if (!('lastBossType' in gs)) gs.lastBossType = null;
    if (!gs.abilityId) gs.abilityId = 'ads';
    return gs;
  }
}
