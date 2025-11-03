import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { createBoss } from '../systems/EnemyFactory.js';
import { HpBar } from '../ui/HpBar.js';
import { getWeaponById } from '../core/Weapons.js';
import { impactBurst, bitSpawnRing, pulseSpark, muzzleFlash, muzzleFlashSplit, ensureCircleParticle, ensurePixelParticle, pixelSparks } from '../systems/Effects.js';
import { preloadWeaponAssets, createPlayerWeaponSprite, syncWeaponTexture, updateWeaponSprite, createFittedImage, getWeaponMuzzleWorld, getWeaponBarrelPoint } from '../systems/WeaponVisuals.js';
import { getEffectiveWeapon, getPlayerEffects } from '../core/Loadout.js';

const DISABLE_WALLS = true; // Temporary: remove concrete walls
const TEMP_BOSS_BOUND_GUARD = false; // Try: keep boss on-screen (reversible)

export default class BossScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Boss); }

  create() {
    const { width, height } = this.scale;
    // Ensure UI overlay is active during boss fight
    this.scene.launch(SceneKeys.UI);
    this.gs = this.registry.get('gameState');
    // Initialize shield defaults if missing
    try { if (typeof this.gs.shieldMax !== 'number') this.gs.shieldMax = 20; if (typeof this.gs.shield !== 'number') this.gs.shield = this.gs.shieldMax; if (typeof this.gs.shieldRegenPerSec !== 'number') this.gs.shieldRegenPerSec = 6; if (typeof this.gs.shieldRegenDelayMs !== 'number') this.gs.shieldRegenDelayMs = 1500; if (typeof this.gs.lastDamagedAt !== 'number') this.gs.lastDamagedAt = 0; if (typeof this.gs.allowOverrun !== 'boolean') this.gs.allowOverrun = true; } catch (_) {}
    this.inputMgr = new InputManager(this);

    // Player
    this.player = this.physics.add.sprite(width / 2, height - 60, 'player_square').setCollideWorldBounds(true);
    this.player.setSize(12, 12);
    this.player.iframesUntil = 0;
    this.playerFacing = 0;
    this.dash = { active: false, until: 0, cooldownUntil: 0, vx: 0, vy: 0, charges: 0, regen: [] };
    this.dash.charges = this.gs.dashMaxCharges;
    this.registry.set('dashCharges', this.dash.charges);
    this.registry.set('dashRegenProgress', 1);
    // Weapon visuals (match CombatScene)
    try { createPlayerWeaponSprite(this); } catch (_) {}
    // Keep weapon sprite updated every frame (follows player even if boss is stunned)
    try {
      this.events.on('update', () => {
        updateWeaponSprite(this);
        if (this.gs) syncWeaponTexture(this, this.gs.activeWeapon);
                try { const gs = this.gs; if (gs) { const now = this.time.now; const since = now - (gs.lastDamagedAt || 0); if (since >= (gs.shieldRegenDelayMs || 1500) && (gs.shield || 0) < (gs.shieldMax || 0)) { const inc = (gs.shieldRegenPerSec || 0) / 60; gs.shield = Math.min(gs.shield + inc, gs.shieldMax || gs.shield); } } } catch (_) {}
        // Player melee parity with Combat: check input each frame
        try { if (this.inputMgr?.pressedMelee) this.performPlayerMelee?.(); } catch (_) {}
      });
    } catch (_) {}

    // Ammo tracking per-weapon for this scene
    this._lastActiveWeapon = this.gs.activeWeapon;
    this.ammoByWeapon = {};
    this.reload = { active: false, until: 0, duration: 0 };
    const cap0 = this.getActiveMagCapacity();
    this.ensureAmmoFor(this._lastActiveWeapon, cap0);
    this.registry.set('ammoInMag', this.ammoByWeapon[this._lastActiveWeapon] ?? cap0);
    this.registry.set('magSize', cap0);
    this.registry.set('reloadActive', false);
    this.registry.set('reloadProgress', 0);
    // Laser state for boss scene (heat/overheat and beam graphic)
    this.laser = { heat: 0, firing: false, overheat: false, startedAt: 0, coolDelayUntil: 0, g: null, lastTickAt: 0 };
    this._firefields = [];

    // Ability system (match normal rooms)
    this._gadgets = [];
    this._bits = [];
    this._wasps = [];
    this.ability = { onCooldownUntil: 0 };

    // Boss (modernized: pick variant and tune stats)
    const mods = this.gs.getDifficultyMods();
    const pistol = getWeaponById('pistol');
    let bossType = 'Charger';
    try {
      if (typeof this.gs.chooseBossType === 'function') bossType = this.gs.chooseBossType();
      else if (this.gs.gameMode === 'BossRush' && Array.isArray(this.gs.bossRushQueue) && this.gs.bossRushQueue.length) bossType = this.gs.bossRushQueue[0];
    } catch (_) {}
    const baseBossHp = Math.floor((pistol?.damage || 15) * 20) * 3;
    this.boss = createBoss(this, width / 2, 100, Math.floor(baseBossHp * (mods.enemyHp || 1)), Math.floor(20 * (mods.enemyDamage || 1)), 50);
    try { this.boss.setScale(1.5); } catch (_) {}
    try {
      const bw = Math.max(1, Math.round(this.boss.displayWidth));
      const bh = Math.max(1, Math.round(this.boss.displayHeight));
      this.boss.setSize(bw, bh).setOffset(0, 0);
    } catch (_) {}
    if (bossType === 'Charger') {
      this.boss.bossType = 'Charger';
      this.boss.maxHp = Math.floor(750 * (mods.enemyHp || 1));
      this.boss.hp = this.boss.maxHp;
      this.boss.speed = 80;
      this.boss.dashDamage = Math.floor(20 * (mods.enemyDamage || 1));
      try { this.boss.setTint(0xff4444); } catch (_) {}
    } else {
      this.boss.bossType = 'Shotgunner';
      this.boss.maxHp = Math.floor(650 * (mods.enemyHp || 1));
      this.boss.hp = this.boss.maxHp;
      this.boss.speed = 50;
      this.boss.dashDamage = Math.floor(16 * (mods.enemyDamage || 1));
      try { this.boss.setTint(0xffff66); } catch (_) {}
    }
    try { this.gs.lastBossType = this.boss.bossType; SaveManager.saveToLocal(this.gs); } catch (_) {}
    this._dashSeq = null;
    this._dashNextAt = this.time.now + 3000;
    // Reset transient boss ability state to avoid leaking across BossRush rounds
    this._castingGrenades = false; // Shotgunner grenade volley gate
    this._bossBurstLeft = 0; // Charger burst/shooting timers
    this._bossNextBurstAt = 0;
    this.lastBossShot = 0;
    // Group the boss into a physics group for consistent overlap handling
    this.bossGroup = this.physics.add.group();
    this.bossGroup.add(this.boss);
    this._won = false;

    if (TEMP_BOSS_BOUND_GUARD) {
      this.physics.world.setBounds(0, 0, width, height);
      this.boss.setCollideWorldBounds(true);
      // Track off-screen to warp back if needed
      this._bossOffscreenSince = 0;
    }

    // Arena walls
    if (!DISABLE_WALLS) {
      this.createArenaWalls();
    } else {
      // No walls: arena spans full screen
      const { width, height } = this.scale;
      this.arenaRect = new Phaser.Geom.Rectangle(0, 0, width, height);
      this.walls = null;
    }
    if (this.walls) {
      this.physics.add.collider(this.player, this.walls);
      this.physics.add.collider(this.boss, this.walls);
    }

    // Barricades (destructible soft cover)
    this.barricadesSoft = this.physics.add.staticGroup();
    try { this.generateBossBarricades(); } catch (_) {}
    this.physics.add.collider(this.player, this.barricadesSoft);
    // Boss vs barricades: allow melee chip when not dashing; no separation during Charger dash
    this.physics.add.collider(
      this.boss,
      this.barricadesSoft,
      (e, s) => this.onEnemyHitBarricade(e, s),
      (e, s) => {
        return !(this._dashSeq && this._dashSeq.phase === 'dash');
      },
      this,
    );

    // Basic overlap damage
    this.physics.add.overlap(this.player, this.boss, () => {
      if (this.time.now < this.player.iframesUntil) return;
      this.applyPlayerDamage(this.boss.damage);
      this.player.iframesUntil = this.time.now + 700;
      // Universal hit VFX when boss overlaps (melee) player
      try { impactBurst(this, this.player.x, this.player.y, { color: 0xff3333, size: 'small' }); } catch (_) {}
      if (this.gs.hp <= 0) {
        const eff = getPlayerEffects(this.gs);
        this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
        this.gs.nextScene = SceneKeys.Hub;
        SaveManager.saveToLocal(this.gs);
        this.scene.start(SceneKeys.Hub);
      }
    });

    // Player bullets (Arcade.Image pool)
    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 256,
      runChildUpdate: true,
    });
    this.physics.add.overlap(this.bullets, this.bossGroup, (b, e) => {
      if (this._won || !b.active || !e.active) return;
      // Only track per-target hits for piercing bullets to allow shotgun pellets to stack normally
      if (b._core === 'pierce') {
        if (!b._hitSet) b._hitSet = new Set();
        if (b._hitSet.has(e)) return;
        b._hitSet.add(e);
      }
      if (typeof e.hp !== 'number') e.hp = e.maxHp || 300;
      e.hp -= b.damage || 12;
      // Ignite buildup from special cores (e.g., SMG Incendiary)
      if (b._igniteOnHit && b._igniteOnHit > 0) {
        const add = b._igniteOnHit;
        e._igniteValue = Math.min(10, (e._igniteValue || 0) + add);
        if ((e._igniteValue || 0) >= 10) {
          const nowT = this.time.now;
          e._ignitedUntil = nowT + 2000;
          e._igniteValue = 0; // reset on trigger
          if (!e._igniteIndicator) {
            e._igniteIndicator = this.add.graphics();
            try { e._igniteIndicator.setDepth(9000); } catch (_) {}
            e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
          }
          try { e._igniteIndicator.setPosition(e.x, e.y - 20); } catch (_) {}
        }
      }
      // Toxin buildup from special cores (e.g., SMG Toxic Rounds)
      if (b._toxinOnHit && b._toxinOnHit > 0) {
        const addT = b._toxinOnHit;
        e._toxinValue = Math.min(10, (e._toxinValue || 0) + addT);
        if ((e._toxinValue || 0) >= 10) {
          const nowT = this.time.now;
          e._toxinedUntil = nowT + 2000; // Boss is not disoriented by design
          e._toxinValue = 0; // reset on trigger
          if (!e._toxinIndicator) {
            e._toxinIndicator = this.add.graphics();
            try { e._toxinIndicator.setDepth(9000); } catch (_) {}
            e._toxinIndicator.fillStyle(0x33ff33, 1).fillCircle(0, 0, 2);
          }
          try { e._toxinIndicator.setPosition(e.x, e.y - 20); } catch (_) {}
        }
      }
      // Stun buildup from stun ammunition
      if (b._stunOnHit && b._stunOnHit > 0) {
        const nowS = this.time.now;
        e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
        if ((e._stunValue || 0) >= 10) {
          e._stunnedUntil = nowS + 200;
          e._stunValue = 0;
          if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
          try { e._stunIndicator.setPosition(e.x, e.y - 24); } catch (_) {}
        }
      }
      // Visual impact effect by core type
      try {
        const core = b._core || null;
        if (core === 'blast') {
          const radius = b._blastRadius || 40;
          impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius });
          // Also drop fire field if this explosive has firefield mod
          try { if (b._firefield) this.spawnFireField(b.x, b.y, (b._blastRadius || radius)); } catch (_) {}
        }
        else if (core === 'pierce') impactBurst(this, b.x, b.y, { color: 0x66aaff, size: 'small' });
        else impactBurst(this, b.x, b.y, { color: 0xffffff, size: 'small' });
      } catch (_) {}
      // Handle pierce core: allow one extra target without removing the bullet
      if (b._core === 'pierce' && (b._pierceLeft || 0) > 0) {
        b._pierceLeft -= 1;
      } else {
        // Defer removal to end of tick to avoid skipping other overlaps this frame
        try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
        try { b.setActive(false).setVisible(false); } catch (_) {}
        this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
      }
      // Boss death check
      if (e.hp <= 0) this.killBoss(e);
    });
    // Player bullets collide with barricades (block and damage them)
    this.physics.add.collider(
      this.bullets,
      this.barricadesSoft,
      (b, s) => this.onBulletHitBarricade(b, s),
      (b, s) => !(b && b._rail),
      this,
    );

    // Boss bullets (Arcade.Image pool)
    this.bossBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 64,
      runChildUpdate: true,
    });
    this.physics.add.overlap(this.player, this.bossBullets, (p, b) => {
      const inIframes = this.time.now < this.player.iframesUntil;
      if (!inIframes) {
        this.applyPlayerDamage(10); // boss bullet damage
        this.player.iframesUntil = this.time.now + 600;
        if (this.gs.hp <= 0) {
          const eff = getPlayerEffects(this.gs);
          this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
      // Always destroy boss bullet on contact, even during i-frames
      try { b.destroy(); } catch (_) {}
    });
  // Boss bullets also collide with destructible barricades
  this.physics.add.collider(this.bossBullets, this.barricadesSoft, (b, s) => this.onBossBulletHitBarricade(b, s));

    // Boss HP bar at top (shorter to avoid UI overlap)
    const barW = Math.min(420, Math.max(200, width - 220));
    const barX = Math.floor((width - barW) / 2);
    // Place near top area
    this.bossHpBar = new HpBar(this, barX, 60, barW, 10);
    // Boss name above the HP bar (dynamic)
    this.bossName = (this.boss?.bossType === 'Charger') ? 'Charger' : 'Shotgunner';
    this.bossNameText = this.add.text(width / 2, 48, this.bossName, { fontFamily: 'monospace', fontSize: 16, color: '#ff6666' }).setOrigin(0.5);
    this.exitRect = null;
    this.exitG = this.add.graphics();

    // Ability: Shotgunner grenade volley
    this.grenades = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image, maxSize: 20, runChildUpdate: true });
    this._grenadeNextAvailableAt = this.time.now + 2000; // small initial delay
    this._lastAbilityRollAt = 0;
  }

  // Player melee (same as Combat): 150闂? 48px, 10 dmg
    performPlayerMelee() {
    const caster = this.player; if (!caster) return;
    const ptr = this.inputMgr.pointer; const ang = Math.atan2(ptr.worldY - caster.y, ptr.worldX - caster.x);
    const totalDeg = 150; const half = Phaser.Math.DegToRad(totalDeg / 2); const range = 48; this._meleeAlt = !this._meleeAlt;
    // Simple transparent fan to indicate affected area (white)
    try { this.spawnMeleeVfx(caster, ang, totalDeg, 120, 0xffffff, range, this._meleeAlt); } catch (_) {}
    // Damage boss mid-swing (~60ms), mirroring enemy timing
    this.time.delayedCall(60, () => {
      const e = this.boss;
      if (e && e.active && caster?.active) {
        const dx = e.x - caster.x; const dy = e.y - caster.y; const d = Math.hypot(dx, dy) || 1;
        const pad = (e.body?.halfWidth || 12);
        if (d <= (range + pad)) {
          const dir = Math.atan2(dy, dx); const diff = Math.abs(Phaser.Math.Angle.Wrap(dir - ang));
          if (diff <= half) {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 300;
            e.hp -= 10; if (e.hp <= 0) this.killBoss(e);
            try { impactBurst(this, e.x, e.y, { color: 0xffffff, size: 'small' }); } catch (_) {}
          }
        }
      }
    });
  }
  spawnMeleeVfx(caster, baseAngle, totalDeg, durationMs, color, range, altStart) {
    try { if (caster._meleeFan?.g) { caster._meleeFan.g.destroy(); } } catch (_) {}
    const g = this.add.graphics({ x: caster.x, y: caster.y });
    try { g.setDepth(9000); } catch (_) {}
    const half = Phaser.Math.DegToRad(totalDeg / 2);
    const a1 = baseAngle - half;
    const a2 = baseAngle + half;
    const r = Math.max(1, Math.floor(range));
    const col = (typeof color === 'number') ? color : 0xffffff;
    const alpha = 0.22;
    try {
      g.fillStyle(col, alpha);
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, a1, a2, false);
      g.closePath();
      g.fillPath();
    } catch (_) {}
    const onUpdate = () => { try { g.x = caster.x; g.y = caster.y; } catch (_) {} };
    this.events.on('update', onUpdate, this);
    const cleanupFan = () => { try { this.events.off('update', onUpdate, this); } catch (_) {} try { g.destroy(); } catch (_) {} caster._meleeFan = null; };
    const dur = Math.max(1, (durationMs | 0) || 100);
    const guardFan = this.time.delayedCall(dur, cleanupFan);
    caster._meleeFan = { g, guard: guardFan, cleanup: cleanupFan };
    // Remove any prior swinging line overlay if present (ensure listener removal)
    try {
      if (caster._meleeLine?.cleanup) { caster._meleeLine.cleanup(); }
      else if (caster._meleeLine?.g) { caster._meleeLine.g.destroy(); }
      caster._meleeLine = null;
    } catch (_) {}

    // Add a bright additive "beam" line that sweeps across the melee fan during the swing (parity with CombatScene)
    try {
      const beam = this.add.graphics({ x: caster.x, y: caster.y });
      try { beam.setDepth?.(9500); } catch (_) {}
      try { beam.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      const start = altStart ? (baseAngle + half) : (baseAngle - half);
      const end = altStart ? (baseAngle - half) : (baseAngle + half);
      const startAt = this.time.now;
      const endAt = startAt + dur;
      const thick = Math.max(2, Math.floor(r * 0.08));
      let lastSparkAt = 0;
      let lastBurstAt = 0;
      let lastAng = start;
      const updateBeam = () => {
        try {
          if (!caster?.active) { cleanupBeam(); return; }
          // Follow caster
          beam.x = caster.x; beam.y = caster.y;
          const now = this.time.now;
          const t = Phaser.Math.Clamp((now - startAt) / Math.max(1, dur), 0, 1);
          const cur = start + (end - start) * t;
          const tipX = Math.cos(cur) * r;
          const tipY = Math.sin(cur) * r;
          beam.clear();
          beam.lineStyle(thick, col, 0.95);
          
          // White base segment for clarity near origin (about one-third of length)
          const baseFrac = 0.35;
          beam.lineStyle(Math.max(1, thick - 1), 0xffffee, 0.98);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX * baseFrac, tipY * baseFrac); beam.strokePath();
          beam.lineStyle(Math.max(1, thick - 1), col, 0.95);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX * 0.85, tipY * 0.85); beam.strokePath();
          beam.fillStyle(col, 0.85).fillCircle(tipX, tipY, Math.max(2, Math.floor(thick * 0.6)));
          // Particle trail: follow beam tip and spray opposite to sweep movement direction
          if (!lastSparkAt || (now - lastSparkAt > 14)) {
            lastSparkAt = now;
            const dAng = Phaser.Math.Angle.Wrap(cur - lastAng);
            const sprayDir = cur + (dAng >= 0 ? -Math.PI / 2 : Math.PI / 2);
            lastAng = cur;
            try {
              pixelSparks(this, caster.x + tipX, caster.y + tipY, {
                angleRad: sprayDir,
                count: 4,
                spreadDeg: 28,
                speedMin: 200,
                speedMax: 360,
                lifeMs: 230,
                color: col,
                size: 2,
                alpha: 0.95,
              });
            } catch (_) {}
          }
          // Periodic mini-burst for extra intensity
          if (!lastBurstAt || (now - lastBurstAt > 60)) {
            lastBurstAt = now;
            const dAng = Phaser.Math.Angle.Wrap(cur - lastAng);
            const sprayDir = cur + (dAng >= 0 ? -Math.PI / 2 : Math.PI / 2);
            try {
              pixelSparks(this, caster.x + tipX, caster.y + tipY, {
                angleRad: sprayDir,
                count: 6,
                spreadDeg: 36,
                speedMin: 220,
                speedMax: 380,
                lifeMs: 260,
                color: col,
                size: 2,
                alpha: 0.95,
              });
            } catch (_) {}
          }
          if (now >= endAt) {
            cleanupBeam();
            return;
          }
        } catch (_) {}
      };
      this.events.on('update', updateBeam, this);
      const cleanupBeam = () => { try { this.events.off('update', updateBeam, this); } catch (_) {} try { this.tweens.killTweensOf(beam); } catch (_) {} try { beam.clear(); beam.visible = false; } catch (_) {} try { beam.destroy(); } catch (_) {} try { if (caster && caster._meleeLine && caster._meleeLine.g === beam) caster._meleeLine = null; } catch (_) {} };
      caster._meleeLine = { g: beam, cleanup: cleanupBeam };
      this.time.delayedCall(dur + 120, cleanupBeam);
    } catch (_) {}
  }

  win() {
    // Reward and spawn portal; require E to confirm exit
    if (this.gs) { this.gs.gold += 50; this.gs.xp = (this.gs.xp || 0) + 150; }
    const px = this.scale.width - 50 + 20; // near previous exit area
    const py = this.scale.height / 2;
    this.exitG.clear();
    this.portal = this.physics.add.staticImage(px, py, 'portal');
    this.portal.setSize(24, 24).setOffset(0, 0);
    this.exitActive = true;
    try {
      if (!this.prompt) {
        this.prompt = this.add.text(this.scale.width / 2, 40, 'Boss defeated! Press E to exit', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
      } else {
        this.prompt.setText('Boss defeated! Press E to exit');
      }
    } catch (_) {}
  }

  // Centralized boss death to keep behavior tied to HP
  killBoss(e) {
    if (!e || !e.active) return;
    try { if (typeof e.hp === 'number' && e.hp > 0) e.hp = 0; } catch (_) {}
    if (!this._won) {
      this._won = true;
      try { this.win(); } catch (_) {}
    }
    try { if (e._igniteIndicator) { e._igniteIndicator.destroy(); e._igniteIndicator = null; } } catch (_) {}
    try { if (e._toxinIndicator) { e._toxinIndicator.destroy(); e._toxinIndicator = null; } } catch (_) {}
    try { e.destroy(); } catch (_) {}
  }

  applyNapalmIgniteToBoss(ex, ey, radius) {
    try {
      const boss = this.boss; if (!boss?.active) return;
      const dx = boss.x - ex; const dy = boss.y - ey; const r2 = radius * radius;
      if ((dx * dx + dy * dy) <= r2) {
        const nowI = this.time.now;
        boss._igniteValue = Math.min(10, (boss._igniteValue || 0) + 5);
        if ((boss._igniteValue || 0) >= 10) {
          boss._ignitedUntil = nowI + 2000; boss._igniteValue = 0;
          if (!boss._igniteIndicator) { boss._igniteIndicator = this.add.graphics(); try { boss._igniteIndicator.setDepth(9000); } catch (_) {} boss._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
          try { boss._igniteIndicator.setPosition(boss.x, boss.y - 20); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  shoot() {
    const gs = this.gs;
    const weapon = getEffectiveWeapon(gs, gs.activeWeapon);
    // Recoil kick per weapon (no recoil for laser)
    try {
      const wid = gs.activeWeapon;
      const least = new Set(['smg', 'rifle']);
      const medium = new Set(['pistol', 'mgl', 'battle_rifle', 'guided_missiles', 'smart_hmg']);
      const high = new Set(['railgun', 'shotgun', 'rocket']);
      let kick = 0;
      if (least.has(wid)) kick = 2.0;      // least tier
      else if (medium.has(wid)) kick = 3.5; // medium tier
      else if (high.has(wid)) kick = 5.5;   // highest tier
      this._weaponRecoil = Math.max(this._weaponRecoil || 0, kick);
    } catch (_) {}
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.inputMgr.pointer.worldX, this.inputMgr.pointer.worldY);
    this.playerFacing = baseAngle;
    const muzzle = getWeaponMuzzleWorld(this, 3);
    const startX = muzzle.x;
    const startY = muzzle.y;
    try {
      const wid = gs.activeWeapon;
      const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','rocket']);
      if (allowed.has(wid)) {
        const heavy = new Set(['smart_hmg','guided_missiles','rocket','shotgun','mgl']);
        if (heavy.has(wid)) muzzleFlashSplit(this, muzzle.x, muzzle.y, { angle: baseAngle, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
        else if (wid === 'battle_rifle') muzzleFlash(this, muzzle.x, muzzle.y, { angle: baseAngle, color: 0xffee66, length: 14, thickness: 4 });
        else muzzleFlash(this, muzzle.x, muzzle.y, { angle: baseAngle, color: 0xffee66, length: 10, thickness: 3 });
        const base = baseAngle;
        if (heavy.has(wid)) {
          const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 190, color: 0xffee66, size: 2, alpha: 0.75 };
          pixelSparks(this, muzzle.x, muzzle.y, { angleRad: base, count: 14, ...burst });
        } else if (wid === 'battle_rifle') {
          const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
          pixelSparks(this, muzzle.x, muzzle.y, { angleRad: base, count: 11, ...burst });
        } else {
          const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
          pixelSparks(this, muzzle.x, muzzle.y, { angleRad: base, count: 9, ...burst });
        }
      }
    } catch (_) {}
    const pellets = weapon.pelletCount || 1;
    // Dynamic spread similar to Combat
    const heat = this._spreadHeat || 0;
    const maxExtra = (typeof weapon.maxSpreadDeg === 'number') ? weapon.maxSpreadDeg : 20;
    const extraDeg = weapon.singleFire ? 0 : (maxExtra * heat);
    const totalSpreadRad = Phaser.Math.DegToRad((weapon.spreadDeg || 0) + extraDeg);
    // Smart HMG bullets: limited enemy-seeking (non-explosive)
    if (weapon.projectile === 'smart') {
      const angle0 = baseAngle;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        b.setCircle(2).setOffset(-2, -2);
        b.setTint(weapon.color || 0xffaa33);
        b.damage = weapon.damage;
        b._core = null;
        b._stunOnHit = weapon._stunOnHit || 0;

        b._angle = angle0;
        b._speed = Math.max(40, weapon.bulletSpeed | 0);
        b._maxTurn = Phaser.Math.DegToRad(2) * 0.1; // ~0.2闂?frame
        b._fov = Phaser.Math.DegToRad(60);
        b._noTurnUntil = this.time.now + 120;
        b.setVelocity(Math.cos(b._angle) * b._speed, Math.sin(b._angle) * b._speed);

        const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
        b.update = () => {
          const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
          try {
            let desired = b._angle; const nowG = this.time.now;
            if (nowG >= (b._noTurnUntil || 0)) {
              const enemies = [this.boss].filter((e) => e && e.active);
              const half = (b._fov || Math.PI / 2) / 2; const norm = (a) => Phaser.Math.Angle.Wrap(a); const ang = norm(b._angle);
              const valid = (t) => { if (!t?.active) return false; const a2 = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y); return Math.abs(norm(a2 - ang)) <= half; };
              if (!valid(b._target)) { b._target = enemies.find((e) => valid(e)) || null; }
              if (b._target && b._target.active) desired = Phaser.Math.Angle.Between(b.x, b.y, b._target.x, b._target.y);
            }
            b._angle = Phaser.Math.Angle.RotateTo(b._angle, desired, b._maxTurn);
            const vx = Math.cos(b._angle) * b._speed; const vy = Math.sin(b._angle) * b._speed; b.setVelocity(vx, vy);
          } catch (_) {}
          try {
            g.clear();
            const headX = b.x + Math.cos(b._angle) * 1.5; const headY = b.y + Math.sin(b._angle) * 1.5;
            const tailX = b.x - Math.cos(b._angle) * 6; const tailY = b.y - Math.sin(b._angle) * 6;
            g.lineStyle(2, 0xff8800, 0.95).beginPath().moveTo(tailX + Math.cos(b._angle) * 3, tailY + Math.sin(b._angle) * 3).lineTo(headX, headY).strokePath();
            g.lineStyle(1, 0xffddaa, 0.9).beginPath().moveTo(tailX, tailY).lineTo(b.x, b.y).strokePath();
          } catch (_) {}
        };
        b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
      }
      return;
    }

    // Guided micro-missiles: cursor or smart lock depending on core
    if (weapon.projectile === 'guided') {
      const angle0 = baseAngle;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        // Match normal room micro-rocket size
        b.setCircle(2).setOffset(-2, -2);
        b.setTint(weapon.color || 0xffaa33);
        b.damage = weapon.damage;
        b._aoeDamage = (typeof weapon.aoeDamage === 'number') ? weapon.aoeDamage : weapon.damage;
        b._core = 'blast'; b._blastRadius = weapon.blastRadius || 40; b._rocket = true; b._stunOnHit = weapon._stunOnHit || 0;
        b._angle = angle0; b._speed = Math.max(40, weapon.bulletSpeed | 0);
        // Turn rate (time-based): ~120闂?s equals 2闂?frame at 60 FPS
        b._turnRate = Phaser.Math.DegToRad(120);
        // Smart core support
        b._smart = !!weapon._smartMissiles;
        if (b._smart) { const mult = (typeof weapon._smartTurnMult === 'number') ? Math.max(0.1, weapon._smartTurnMult) : 0.5; b._turnRate *= mult; b._fov = Phaser.Math.DegToRad(90); }
        b._noTurnUntil = this.time.now + 200;
        b.setVelocity(Math.cos(b._angle) * b._speed, Math.sin(b._angle) * b._speed);
        const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
        b.update = () => {
          const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
          try {
            let desired = b._angle; const nowG = this.time.now;
            if (nowG >= (b._noTurnUntil || 0)) {
              if (b._smart) {
                const enemies = [this.boss].filter((e) => e && e.active);
                const half = (b._fov || Math.PI / 2) / 2; const norm = (a) => Phaser.Math.Angle.Wrap(a); const ang = norm(b._angle);
                const valid = (t) => { if (!t?.active) return false; const a2 = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y); return Math.abs(norm(a2 - ang)) <= half; };
                if (!valid(b._target)) { b._target = enemies.find((e) => valid(e)) || null; }
                if (b._target && b._target.active) desired = Phaser.Math.Angle.Between(b.x, b.y, b._target.x, b._target.y);
              } else {
                const ptr = this.inputMgr?.pointer; const tx = ptr?.worldX ?? (this.player.x + Math.cos(this.playerFacing) * 2000); const ty = ptr?.worldY ?? (this.player.y + Math.sin(this.playerFacing) * 2000);
                desired = Phaser.Math.Angle.Between(b.x, b.y, tx, ty);
              }
            }
            const dt = (this.game?.loop?.delta || 16.7) / 1000;
            b._angle = Phaser.Math.Angle.RotateTo(b._angle, desired, (b._turnRate || 0) * dt);
            const vx = Math.cos(b._angle) * b._speed; const vy = Math.sin(b._angle) * b._speed; b.setVelocity(vx, vy);
          } catch (_) {}
          try {
            g.clear();
            const headX = b.x + Math.cos(b._angle) * 2; const headY = b.y + Math.sin(b._angle) * 2; const tailX = b.x - Math.cos(b._angle) * 8; const tailY = b.y - Math.sin(b._angle) * 8;
            g.lineStyle(3, 0xff8800, 0.95).beginPath().moveTo(tailX + Math.cos(b._angle) * 4, tailY + Math.sin(b._angle) * 4).lineTo(headX, headY).strokePath();
            g.lineStyle(1, 0xffddaa, 0.9).beginPath().moveTo(tailX, tailY).lineTo(b.x, b.y).strokePath();
          } catch (_) {}
        };
        b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
      }
      return;
    }
    // Rocket projectile for boss scene too
    if (weapon.projectile === 'rocket') {
      const targetX = this.inputMgr.pointer.worldX;
      const targetY = this.inputMgr.pointer.worldY;
      const angle = baseAngle;
      const vx = Math.cos(angle) * weapon.bulletSpeed;
      const vy = Math.sin(angle) * weapon.bulletSpeed;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        // Larger rocket visual + hitbox
        b.setCircle(6).setOffset(-6, -6);
        try { b.setScale(1.8); } catch (_) {}
        b.setVelocity(vx, vy);
        b.setTint(weapon.color || 0xff5533);
        b.damage = weapon.damage;
        b._core = 'blast';
        b._blastRadius = weapon.blastRadius || 70;
        b._rocket = true;
        b._aoeDamage = (typeof weapon.aoeDamage === 'number') ? weapon.aoeDamage : weapon.damage;
        b._firefield = !!weapon._firefield;
        // Smart Explosives core flags
        b._smartExplosives = !!weapon._smartExplosives;
        if (b._smartExplosives) {
          const scale = (typeof weapon._detectScale === 'number') ? weapon._detectScale : 0.65;
          b._detectR = Math.max(8, Math.floor((b._blastRadius || 70) * scale));
        }
        b._startX = startX; b._startY = startY;
        b._targetX = targetX; b._targetY = targetY;
        const sx = targetX - startX; const sy = targetY - startY;
        b._targetLen2 = sx * sx + sy * sy;
        // Carry stun-on-hit value for direct impacts (from Stun Ammunitions)
        b._stunOnHit = weapon._stunOnHit || 0;
        b.update = () => {
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) {
            if (!b._mine) { try { b.destroy(); } catch (_) {} return; }
          }
          // Napalm (MGL incendiary): add orange tracer particles behind rocket
          try {
            if (b._firefield) {
              const vx0 = b.body?.velocity?.x || 0; const vy0 = b.body?.velocity?.y || 0;
              const spd2 = (vx0*vx0 + vy0*vy0) || 0;
              if (spd2 > 1) {
                const back = Math.atan2(vy0, vx0) + Math.PI;
                const ex = b.x + Math.cos(back) * 6; const ey = b.y + Math.sin(back) * 6;
                pixelSparks(this, ex, ey, { angleRad: back, count: 2, spreadDeg: 8, speedMin: 90, speedMax: 180, lifeMs: 110, color: 0xffaa33, size: 2, alpha: 0.95 });
              }
            }
          } catch (_) {}
          // Smart Explosives: proximity detection and mine behavior (boss as sole target)
          if (b._smartExplosives) {
            const detR = b._detectR || Math.max(8, Math.floor((b._blastRadius || 70) * 0.65));
            const detR2 = detR * detR;
            const now = this.time.now;
            if (b._mine) {
              if (now >= (b._mineExpireAt || 0)) {
                // Detonate on expiry instead of vanishing
                const ex = b.x; const ey = b.y;
                const radius = b._blastRadius || 70; const r2 = radius * radius; try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
                if (this.boss?.active) {
                  const ddx = this.boss.x - ex; const ddy = this.boss.y - ey; if ((ddx * ddx + ddy * ddy) <= r2) { if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300; this.boss.hp -= (b._aoeDamage || b.damage || 12); if (this.boss.hp <= 0) this.killBoss(this.boss); }
                }
                this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 12));
                if (b._firefield) { this.spawnFireField(ex, ey, radius); this.applyNapalmIgniteToBoss(ex, ey, radius); }
                try { b.destroy(); } catch (_) {}
                return;
              }
              const boss = this.boss;
              if (boss && boss.active) {
                const dx = boss.x - b.x; const dy = boss.y - b.y;
                if ((dx * dx + dy * dy) <= detR2) {
                  const ex = b.x; const ey = b.y;
                  const radius = b._blastRadius || 70; const r2 = radius * radius; try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
                  if (this.boss?.active) {
                    const ddx = this.boss.x - ex; const ddy = this.boss.y - ey;
                    if ((ddx * ddx + ddy * ddy) <= r2) { if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300; this.boss.hp -= (b._aoeDamage || b.damage || 12); if (this.boss.hp <= 0) this.killBoss(this.boss); }
                  }
                  this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 12));
                  if (b._firefield) { this.spawnFireField(ex, ey, radius); this.applyNapalmIgniteToBoss(ex, ey, radius); }
                  try { b.destroy(); } catch (_) {}
                  return;
                }
              }
              return;
            }
            // While flying: proximity to boss
            if (this.boss && this.boss.active) {
              const dx = this.boss.x - b.x; const dy = this.boss.y - b.y;
              if ((dx * dx + dy * dy) <= detR2) {
                const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70; const r2 = radius * radius; try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
                const ddx = this.boss.x - ex; const ddy = this.boss.y - ey; if ((ddx * ddx + ddy * ddy) <= r2) { if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300; this.boss.hp -= (b._aoeDamage || b.damage || 12); if (this.boss.hp <= 0) this.killBoss(this.boss); }
                this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 12));
                if (b._firefield) { this.spawnFireField(ex, ey, radius); this.applyNapalmIgniteToBoss(ex, ey, radius); }
                try { b.destroy(); } catch (_) {}
                return;
              }
            }
          }
          const dxs = (b.x - b._startX); const dys = (b.y - b._startY);
          const prog = dxs * (sx) + dys * (sy);
          const dx = b.x - b._targetX; const dy = b.y - b._targetY;
          const nearTarget = (dx * dx + dy * dy) <= 64;
          const passed = prog >= b._targetLen2 - 1;
          if (nearTarget || passed) {
            if (b._smartExplosives) {
              // Become a mine (wait for proximity) instead of auto-exploding
              b._mine = true; b._mineExpireAt = this.time.now + 8000;
              try { b.setVelocity(0, 0); } catch (_) {}
              try { b.body?.setVelocity?.(0, 0); } catch (_) {}
              try { b.setTint(0x55ff77); } catch (_) {}
              return;
            }
            const ex = b.x; const ey = b.y;
            try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large' }); } catch (_) {}
            const radius = b._blastRadius || 70; const r2 = radius * radius;
            // Damage boss if in radius
            if (this.boss && this.boss.active) {
              const ddx = this.boss.x - ex; const ddy = this.boss.y - ey;
              if ((ddx * ddx + ddy * ddy) <= r2) {
                if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300;
                this.boss.hp -= (b._aoeDamage || b.damage || 12);
                if (this.boss.hp <= 0) this.killBoss(this.boss);
              }
            }
            // Also damage nearby destructible barricades
            this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 12));
            if (b._firefield) { this.spawnFireField(ex, ey, radius); this.applyNapalmIgniteToBoss(ex, ey, radius); }
            try { b.destroy(); } catch (_) {}
          }
        };
        b.on('destroy', () => b._g?.destroy());
      }
      return;
    }
    for (let i = 0; i < pellets; i += 1) {
      let angle = baseAngle;
      if (pellets === 1) {
        const off = Phaser.Math.FloatBetween(-0.5, 0.5) * totalSpreadRad;
        angle += off;
      } else {
        const t = (i / (pellets - 1)) - 0.5;
        angle += t * totalSpreadRad;
        if (totalSpreadRad > 0) angle += Phaser.Math.FloatBetween(-0.1, 0.1) * totalSpreadRad;
      }
      const effSpeed = (weapon.projectile === 'rocket') ? weapon.bulletSpeed : Math.floor((weapon.bulletSpeed || 0) * 1.25);
      const vx = Math.cos(angle) * effSpeed;
      const vy = Math.sin(angle) * effSpeed;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      b.setCircle(2).setOffset(-2, -2);
      b.setVelocity(vx, vy);
      b.damage = weapon.damage;
      // Tint: default white; Explosive Core uses orange bullets
      if (weapon._core === 'blast') b.setTint(0xff8800); else b.setTint(0xffffff);
      b._core = weapon._core || null;
      b._igniteOnHit = weapon._igniteOnHit || 0;
      b._toxinOnHit = weapon._toxinOnHit || 0;
      b._stunOnHit = weapon._stunOnHit || 0;
      if (b._core === 'pierce') { b._pierceLeft = 1; }
      // Tracers: particles for ignite/toxin/stun; blue line for pierce; none for explosive-core bullets
      try {
        const tracerColor = (() => {
          if (b._toxinOnHit > 0) return 0x33ff66; // green
          if (b._igniteOnHit > 0) return 0xffaa33; // orange
          if (b._stunOnHit > 0) return 0xffee66; // yellow
          return null;
        })();
        if (b._core === 'pierce') {
          const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          b.update = () => {
            const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
            try {
              g.clear();
              const vx0 = b.body?.velocity?.x || vx; const vy0 = b.body?.velocity?.y || vy;
              const ang = Math.atan2(vy0, vx0);
              const tail = 10;
              const tx = b.x - Math.cos(ang) * tail; const ty = b.y - Math.sin(ang) * tail;
              g.lineStyle(3, 0x2266ff, 0.5).beginPath().moveTo(tx, ty).lineTo(b.x, b.y).strokePath();
              g.lineStyle(1, 0xaaddff, 0.9).beginPath().moveTo(tx + Math.cos(ang) * 2, ty + Math.sin(ang) * 2).lineTo(b.x, b.y).strokePath();
            } catch (_) {}
          };
          b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
        } else if (tracerColor && weapon._core !== 'blast') {
          b.update = () => {
            const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
            try {
              const vx0 = b.body?.velocity?.x || vx; const vy0 = b.body?.velocity?.y || vy;
              const back = Math.atan2(vy0, vx0) + Math.PI;
              const ex = b.x + Math.cos(back) * 5; const ey = b.y + Math.sin(back) * 5;
              const isIgnite = (b._igniteOnHit || 0) > 0;
              const isToxin  = (b._toxinOnHit  || 0) > 0;
              const isStun   = (b._stunOnHit   || 0) > 0;
              let count = 2, size = 2, lifeMs = 100, speedMin = 90, speedMax = 180, alpha = 0.9;
              if (isIgnite) { count = 3; size = 2; lifeMs = 120; speedMin = 100; speedMax = 200; alpha = 0.95; }
              else if (isToxin) { count = 2; size = 2; lifeMs = 110; speedMin = 90; speedMax = 190; alpha = 0.92; }
              else if (isStun) { count = 2; size = 2; lifeMs = 100; speedMin = 90; speedMax = 180; alpha = 0.9; }
              pixelSparks(this, ex, ey, { angleRad: back, count, spreadDeg: 8, speedMin, speedMax, lifeMs, color: tracerColor, size, alpha });
            } catch (_) {}
          };
          b.on('destroy', () => b._g?.destroy());
        } else {
          b.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} } };
          b.on('destroy', () => b._g?.destroy());
        }
      } catch (_) {
        b.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} } };
      }
      b.on('destroy', () => b._g?.destroy());
    }
    // 2Tap Trigger: auto second shot for pistol core
    if (weapon._twoTap) {
      const wid = this.gs.activeWeapon;
      const angle2 = baseAngle;
      this.time.delayedCall(70, () => {
        if (this.gs.activeWeapon !== wid) return;
        const cap = this.getActiveMagCapacity();
        this.ensureAmmoFor(wid, cap);
        const ammo = this.ammoByWeapon[wid] ?? 0;
        if (ammo <= 0 || this.reload.active) return;
        const effSpeed = Math.floor((weapon.bulletSpeed || 0) * 1.25);
        const vx = Math.cos(angle2) * effSpeed;
        const vy = Math.sin(angle2) * effSpeed;
        const m2 = getWeaponMuzzleWorld(this, 3);
        try {
          const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','rocket']);
          const heavy = new Set(['smart_hmg','guided_missiles','rocket','shotgun','mgl']);
          if (allowed.has(wid)) {
            if (heavy.has(wid)) muzzleFlashSplit(this, m2.x, m2.y, { angle: angle2, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
            else if (wid === 'battle_rifle') muzzleFlash(this, m2.x, m2.y, { angle: angle2, color: 0xffee66, length: 14, thickness: 4 });
            else muzzleFlash(this, m2.x, m2.y, { angle: angle2, color: 0xffee66, length: 10, thickness: 3 });
            const base = angle2;
            if (heavy.has(wid)) {
              const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 180, color: 0xffee66, size: 2, alpha: 0.75 };
              pixelSparks(this, m2.x, m2.y, { angleRad: base, count: 12, ...burst });
            } else if (wid === 'battle_rifle') {
              const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
              pixelSparks(this, m2.x, m2.y, { angleRad: base, count: 10, ...burst });
            } else {
              const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
              pixelSparks(this, m2.x, m2.y, { angleRad: base, count: 8, ...burst });
            }
          }
        } catch (_) {}
        const b2 = this.bullets.get(m2.x, m2.y, 'bullet');
        if (!b2) return;
        b2.setActive(true).setVisible(true);
        b2.setCircle(2).setOffset(-2, -2);
        b2.setVelocity(vx, vy);
         // Tint rules match primary
         if (weapon._core === 'blast') b2.setTint(0xff8800); else b2.setTint(0xffffff);
         b2.damage = weapon.damage;
         b2._core = weapon._core || null;
         b2._igniteOnHit = weapon._igniteOnHit || 0;
         b2._toxinOnHit = weapon._toxinOnHit || 0;
         b2._stunOnHit = weapon._stunOnHit || 0;
         if (b2._core === 'pierce') { b2._pierceLeft = 1; }
        try {
          const tracerColor2 = (() => {
            if (b2._toxinOnHit > 0) return 0x33ff66; // green
            if (b2._igniteOnHit > 0) return 0xffaa33; // orange
            if (b2._stunOnHit > 0) return 0xffee66; // yellow
            return null;
          })();
          if (b2._core === 'pierce') {
            const g2 = this.add.graphics(); b2._g = g2; try { g2.setDepth(8000); g2.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
            b2.update = () => {
              const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} return; }
              try {
                g2.clear();
                const vx0 = b2.body?.velocity?.x || vx; const vy0 = b2.body?.velocity?.y || vy;
                const ang = Math.atan2(vy0, vx0);
                const tail = 10; const tx = b2.x - Math.cos(ang) * tail; const ty = b2.y - Math.sin(ang) * tail;
                g2.lineStyle(3, 0x2266ff, 0.5).beginPath().moveTo(tx, ty).lineTo(b2.x, b2.y).strokePath();
                g2.lineStyle(1, 0xaaddff, 0.9).beginPath().moveTo(tx + Math.cos(ang) * 2, ty + Math.sin(ang) * 2).lineTo(b2.x, b2.y).strokePath();
              } catch (_) {}
            };
            b2.on('destroy', () => { try { b2._g?.destroy(); } catch (_) {} });
          } else if (tracerColor2 && weapon._core !== 'blast') {
            b2.update = () => {
              const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} return; }
              try {
                const vx0 = b2.body?.velocity?.x || vx; const vy0 = b2.body?.velocity?.y || vy;
                const back = Math.atan2(vy0, vx0) + Math.PI;
                const ex = b2.x + Math.cos(back) * 5; const ey = b2.y + Math.sin(back) * 5;
                const isIgnite = (b2._igniteOnHit || 0) > 0; const isToxin = (b2._toxinOnHit || 0) > 0; const isStun = (b2._stunOnHit || 0) > 0;
                let count = 2, size = 2, lifeMs = 100, speedMin = 90, speedMax = 180, alpha = 0.9;
                if (isIgnite) { count = 3; size = 2; lifeMs = 120; speedMin = 100; speedMax = 200; alpha = 0.95; }
                else if (isToxin) { count = 2; size = 2; lifeMs = 110; speedMin = 90; speedMax = 190; alpha = 0.92; }
                else if (isStun) { count = 2; size = 2; lifeMs = 100; speedMin = 90; speedMax = 180; alpha = 0.9; }
                pixelSparks(this, ex, ey, { angleRad: back, count, spreadDeg: 8, speedMin, speedMax, lifeMs, color: tracerColor2, size, alpha });
              } catch (_) {}
            };
            b2.on('destroy', () => b2._g?.destroy());
          } else {
            b2.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} } };
            b2.on('destroy', () => b2._g?.destroy());
          }
        } catch (_) {
          b2.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} } };
        }
        b2.on('destroy', () => b2._g?.destroy());
        this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
      });
    }
  }

  update(time) {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);
    const eff = getPlayerEffects(this.gs);
    // Dash regen progress for UI (0..1) for next slot
    let prog = 0;
    if (this.dash.charges < this.gs.dashMaxCharges && this.dash.regen.length) {
      const now = time;
      const nextReady = Math.min(...this.dash.regen);
      const remaining = Math.max(0, nextReady - now);
      const denom = (eff.dashRegenMs || this.gs.dashRegenMs || 1000);
      prog = 1 - Math.min(1, remaining / denom);
    } else {
      prog = 1;
    }
    this.registry.set('dashRegenProgress', prog);

    // Failsafe: only trigger win when HP <= 0 (avoid false positives on inactive)
    if (!this._won && this.boss && (this.boss.hp <= 0)) {
      this._won = true;
      try { this.win(); } catch (e) { /* noop safeguard */ }
    }

    // Draw boss HP bar
    if (this.bossHpBar && this.boss && this.boss.active) {
      this.bossHpBar.draw(Math.max(0, this.boss.hp), Math.max(1, this.boss.maxHp || 1));
    }

    // Movement + dash
    const mv = this.inputMgr.moveVec;
    const now = time;
    if (this.inputMgr.pressedDash && now >= this.dash.cooldownUntil && this.dash.charges > 0) {
      const angle = (mv.x !== 0 || mv.y !== 0) ? Math.atan2(mv.y, mv.x) : this.playerFacing;
      const dashSpeed = 520;
      const dur = 180;
      this.dash.active = true; this.dash.until = now + dur; this.dash.cooldownUntil = now + 600;
      this.dash.vx = Math.cos(angle) * dashSpeed; this.dash.vy = Math.sin(angle) * dashSpeed;
      this.player.iframesUntil = now + dur;
      this.dash.charges -= 1; this.dash.regen.push(now + (eff.dashRegenMs || this.gs.dashRegenMs));
    }
    if (this.dash.active && now < this.dash.until) {
      this.player.setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      const speed = 200 * (eff.moveSpeedMult || 1);
      this.player.setVelocity(mv.x * speed, mv.y * speed);
    }

    // Regen charges
    if (this.dash.regen.length) {
      const ready = this.dash.regen.filter((t) => now >= t);
      if (ready.length) {
        const remaining = this.dash.regen.filter((t) => now < t);
        this.dash.regen = remaining;
        this.dash.charges = Math.min(this.dash.charges + ready.length, this.gs.dashMaxCharges);
      }
    }

    // Shooting with LMB per weapon fireRate
    const weapon = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
    const isRail = !!weapon.isRailgun;
    const isLaser = !!weapon.isLaser;
    // Finish reload if timer elapsed; update reload progress for UI
    if (this.reload?.active) {
      const now = time;
      const remaining = Math.max(0, this.reload.until - now);
      const dur = Math.max(1, this.reload.duration || this.getActiveReloadMs());
      const prog = 1 - Math.min(1, remaining / dur);
      this.registry.set('reloadActive', true);
      this.registry.set('reloadProgress', prog);
      if (now >= this.reload.until) {
        const wid = this.gs.activeWeapon;
        const cap = this.getActiveMagCapacity();
        this.ensureAmmoFor(wid, cap);
        this.ammoByWeapon[wid] = cap;
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
        this.registry.set('magSize', cap);
        this.reload.active = false;
        this.reload.duration = 0;
        this.registry.set('reloadActive', false);
        this.registry.set('reloadProgress', 1);
      }
    } else {
      this.registry.set('reloadActive', false);
    }
    // Track and update ammo registry on weapon change or capacity change
    if (this._lastActiveWeapon !== this.gs.activeWeapon) {
      this._lastActiveWeapon = this.gs.activeWeapon;
      const cap = this.getActiveMagCapacity();
      this.ensureAmmoFor(this._lastActiveWeapon, cap);
      this.registry.set('ammoInMag', this.ammoByWeapon[this._lastActiveWeapon]);
      this.registry.set('magSize', cap);
    } else {
      // Keep registry in sync in case mods/cores change capacity
      const cap = this.getActiveMagCapacity();
      this.ensureAmmoFor(this._lastActiveWeapon, cap, true);
      this.registry.set('magSize', cap);
      this.registry.set('ammoInMag', this.ammoByWeapon[this._lastActiveWeapon]);
    }
    // Update spread heat each frame
    const dt = (this.game?.loop?.delta || 16.7) / 1000;
    if (this._spreadHeat === undefined) this._spreadHeat = 0;
    const rampPerSec = 0.7;
    const coolPerSec = 1.2;
    if (this.inputMgr.isLMBDown && !weapon.singleFire && !isRail && !isLaser) {
      this._spreadHeat = Math.min(1, this._spreadHeat + rampPerSec * dt);
    } else {
      this._spreadHeat = Math.max(0, this._spreadHeat - coolPerSec * dt);
    }
    const ptr = this.inputMgr.pointer;
    if (this._lmbWasDown === undefined) this._lmbWasDown = false;
    const edgeDown = (!this._lmbWasDown) && !!ptr.isDown && ((ptr.buttons & 1) === 1);
    const wantsClick = !!ptr.justDown || edgeDown;
    if (isRail) { this.handleRailgunCharge(time, weapon, ptr); }
    if (isLaser) { this.handleLaser(time, weapon, ptr, dt); }
    const wantsShot = (!isRail && !isLaser) && (weapon.singleFire ? wantsClick : this.inputMgr.isLMBDown);
    if (wantsShot && (!this.lastShot || time - this.lastShot > weapon.fireRateMs)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      const ammo = this.ammoByWeapon[wid] ?? 0;
      if (ammo <= 0 || this.reload.active) {
        if (!this.reload.active) {
          this.reload.active = true;
          this.reload.duration = this.getActiveReloadMs();
          this.reload.until = time + this.reload.duration;
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', 0);
        }
      } else {
        this.shoot();
        this.lastShot = time;
        this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
        // Auto-reload for rocket launcher after shot
        if (wid === 'rocket' && this.ammoByWeapon[wid] <= 0) {
          if (!this.reload.active) {
            this.reload.active = true;
            this.reload.duration = this.getActiveReloadMs();
            this.reload.until = time + this.reload.duration;
            this.registry.set('reloadActive', true);
            this.registry.set('reloadProgress', 0);
          }
        }
      }
    }
    this._lmbWasDown = !!ptr.isDown;

    // Swap weapons with Q (mirror CombatScene behavior)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.q)) {
      const slots = this.gs.equippedWeapons || [];
      const a = this.gs.activeWeapon;
      if (slots[0] && slots[1]) {
        this.gs.activeWeapon = a === slots[0] ? slots[1] : slots[0];
      } else {
        const owned = this.gs.ownedWeapons;
        if (owned && owned.length) {
          const idx = Math.max(0, owned.indexOf(a));
          const next = owned[(idx + 1) % owned.length];
          this.gs.activeWeapon = next;
        }
      }
      // Cancel any in-progress reload on weapon swap
      this.reload.active = false;
      this.reload.duration = 0;
      this.registry.set('reloadActive', false);
      try { if (this.rail?.charging) this.rail.charging = false; } catch (_) {}
      this.endRailAim?.();
      // Clear laser beam if swapping away
      try { this.laser?.g?.clear?.(); } catch (_) {}
    }

    // Manual reload (R)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.r)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      if (!weapon.isLaser && !this.reload.active && (this.ammoByWeapon[wid] ?? 0) < cap) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = time + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    }

    // Ability activation (F) ?? match CombatScene
    if (this.inputMgr.pressedAbility) {
      const nowT = this.time.now;
      if (nowT >= (this.ability.onCooldownUntil || 0)) {
        const abilityId = this.gs?.abilityId || 'ads';
        if (abilityId === 'ads') {
          this.deployADS?.();
          this.ability.cooldownMs = 3000;
          this.ability.onCooldownUntil = nowT + this.ability.cooldownMs;
        } else if (abilityId === 'bits') {
          this.deployBITs();
          this.ability.cooldownMs = 3000;
          this.ability.onCooldownUntil = nowT + this.ability.cooldownMs;
        } else if (abilityId === 'repulse') {
          this.deployRepulsionPulse();
          this.ability.cooldownMs = 5000; // 5s universal for Repulsion Pulse
          this.ability.onCooldownUntil = nowT + this.ability.cooldownMs;
        }
      }
    }

    // Update active gadgets (ADS) ??identical behavior to CombatScene, but scan boss bullets + grenades
    if (this._gadgets && this._gadgets.length) {
      const nowT = this.time.now;
      this._gadgets = this._gadgets.filter((g) => {
        if (nowT >= (g.until || 0)) { try { g.g?.destroy(); } catch (_) {} return false; }
        if (nowT >= (g.nextZapAt || 0)) {
          const radius = g.radius || 120; const r2 = radius * radius;
          let best = null; let bestD2 = Infinity;
          const scan = (grp) => {
            const arr = grp?.getChildren?.() || [];
            for (let i = 0; i < arr.length; i += 1) {
              const b = arr[i]; if (!b?.active) continue;
              const dx = b.x - g.x; const dy = b.y - g.y; const d2 = dx * dx + dy * dy;
              if (d2 <= r2 && d2 < bestD2) { best = b; bestD2 = d2; }
            }
          };
          scan(this.bossBullets); scan(this.grenades);
          if (best) {
            try {
              const lg = this.add.graphics();
              lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              const sx = g.x, sy = g.y - 4;
              lg.beginPath(); lg.moveTo(sx, sy); lg.lineTo(best.x, best.y); lg.strokePath();
              lg.setAlpha(1);
              this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
              try { const ang = Phaser.Math.Angle.Between(sx, sy, best.x, best.y); pixelSparks(this, sx, sy, { angleRad: ang, count: 6, spreadDeg: 60, speedMin: 90, speedMax: 140, lifeMs: 110, color: 0x66aaff, size: 2, alpha: 0.9 }); } catch (_) {}
            } catch (_) { /* ignore */ }
            try { impactBurst(this, best.x, best.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            try { best.destroy(); } catch (_) {}
            g.nextZapAt = nowT + 100; // 10 per second
          }
        }
        return true;
      });
    }

    // Armour: WASP BITS persistent drones (2) targeting boss when close to player
    const hasWaspArmour = (this.gs?.armour?.id === 'wasp_bits');
    if (!hasWaspArmour) {
      if (this._wasps && this._wasps.length) {
        try { this._wasps.forEach((w) => { try { w?.g?.destroy?.(); } catch (_) {} try { w?._thr?.destroy?.(); } catch (_) {} }); } catch (_) {}
        this._wasps = [];
      }
    } else {
      if (!this._wasps) this._wasps = [];
      // Ensure 2 wasps exist
      const need = 2 - this._wasps.length;
      for (let i = 0; i < need; i += 1) {
        const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
        try { g.setDepth(9000); g.setTint(0xffff66); } catch (_) {}
        const w = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g,
          state: 'idle', target: null, lastDashAt: 0, dashUntil: 0, dashHit: false,
          _hoverAngle: Phaser.Math.FloatBetween(0, Math.PI * 2), _hoverR: Phaser.Math.Between(16, 36), _hoverChangeAt: 0 };
        try { w._thr = this.add.graphics(); w._thr.setDepth(8800); w._thr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
        this._wasps.push(w);
      }
      // Update wasps
      if (this._wasps.length) {
        const dtw = (this.game?.loop?.delta || 16.7) / 1000; const noww = this.time.now;
        const detectR = 160; const detectR2 = detectR * detectR;
        const boss = (this.boss && this.boss.active) ? this.boss : null;
        this._wasps = this._wasps.filter((w) => {
          if (!w?.g?.active) { try { w?._thr?.destroy?.(); } catch (_) {} return false; }
          // Acquire/validate
          if (!w.target || !w.target.active) {
            w.target = null;
            if (boss) {
              const dxp = boss.x - this.player.x; const dyp = boss.y - this.player.y;
              if ((dxp * dxp + dyp * dyp) <= detectR2) w.target = boss;
            }
          } else {
            // Drop if boss exits detection
            const dxp = w.target.x - this.player.x; const dyp = w.target.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
            if (d2p > detectR2) w.target = null;
          }
          const t = w.target;
          // Dashing
          if (w.state === 'dashing') {
            const px = w.x; const py = w.y;
            w.x += (w.vx || 0) * dtw; w.y += (w.vy || 0) * dtw; try { w.g.setPosition(w.x, w.y); } catch (_) {}
            try { w.g.setRotation(Math.atan2(w.y - py, w.x - px) + Math.PI); } catch (_) {}
            // Thruster while dashing: particles only (remove static lines)
            try { const g = w._thr; if (g) { g.clear(); } } catch (_) {}
            // Yellow compact thruster particles behind WASP bit while dashing (emit from rear with smoothing)
            try { const sp2 = (w.vx||0)*(w.vx||0) + (w.vy||0)*(w.vy||0); const desired = (sp2 > 1) ? (Math.atan2(w.vy || 0, w.vx || 0) + Math.PI) : ((w._rot || 0) + Math.PI); w._thrBackAng = (typeof w._thrBackAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrBackAng, desired, Phaser.Math.DegToRad(12)) : desired; const ex = w.x + Math.cos(w._thrBackAng) * 6; const ey = w.y + Math.sin(w._thrBackAng) * 6; pixelSparks(this, ex, ey, { angleRad: w._thrBackAng, count: 1, spreadDeg: 4, speedMin: 70, speedMax: 120, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
            if (!w._lastSparkAt || (noww - w._lastSparkAt) >= 20) { try { pulseSpark(this, w.x, w.y, { color: 0x66aaff, size: 2, life: 140 }); } catch (_) {} w._lastSparkAt = noww; }
            try {
              if (!w._lastLineAt || (noww - w._lastLineAt) >= 16) {
                const lg = this.add.graphics(); try { lg.setDepth(9850); lg.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
                lg.lineStyle(2, 0x66aaff, 0.95); lg.beginPath(); lg.moveTo(px, py); lg.lineTo(w.x, w.y); lg.strokePath();
                this.tweens.add({ targets: lg, alpha: 0, duration: 240, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
                w._lastLineAt = noww;
              }
            } catch (_) {}
            // Hit boss
            if (t && t.active && !w.dashHit) {
              const dx = t.x - w.x; const dy = t.y - w.y; const len = Math.hypot(dx, dy) || 1;
              if (len < 16) {
                if (typeof t.hp !== 'number') t.hp = t.maxHp || 300; t.hp -= 3.5; if (t.hp <= 0) this.killBoss(t);
                // Apply stun build-up to boss as well (2.5 per hit; stun 0.2s)
                t._stunValue = Math.min(10, (t._stunValue || 0) + 2.5);
                if ((t._stunValue || 0) >= 10) {
                  t._stunnedUntil = noww + 200;
                  t._stunValue = 0;
                  if (!t._stunIndicator) { t._stunIndicator = this.add.graphics(); try { t._stunIndicator.setDepth(9000); } catch (_) {} t._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                  try { t._stunIndicator.setPosition(t.x, t.y - 24); } catch (_) {}
                  // Interrupt boss abilities
                  try { this._dashSeq = null; } catch (_) {}
                  try { this._bossBurstLeft = 0; } catch (_) {}
                }
                w.dashHit = true;
              }
            }
            if (noww >= (w.dashUntil || 0)) {
              w.state = (t && t.active) ? 'locked' : 'idle'; w.vx = 0; w.vy = 0; w.dashHit = false;
              try { if (w._trailEmitter) w._trailEmitter.on = false; if (w._trailMgr) this.time.delayedCall(260, () => { try { w._trailMgr.destroy(); } catch (_) {} w._trailMgr = null; w._trailEmitter = null; }); } catch (_) {}
              const bx = (t && t.active) ? t.x : this.player.x; const by = (t && t.active) ? t.y : this.player.y;
              const ox = w.x - bx; const oy = w.y - by; const d = Math.hypot(ox, oy) || 1;
              w._hoverR = Phaser.Math.Clamp(d, (t && t.active) ? 28 : 22, (t && t.active) ? 52 : 42);
              w._hoverAngle = Math.atan2(oy, ox); w._hoverChangeAt = noww + Phaser.Math.Between(280, 560);
            }
            return true;
          }
          // Hover
          const baseX = t && t.active ? t.x : this.player.x; const baseY = t && t.active ? t.y : this.player.y;
          if (noww >= (w._hoverChangeAt || 0)) {
            w._hoverChangeAt = noww + Phaser.Math.Between(220, 520);
            const addR = Phaser.Math.Between(-6, 6);
            w._hoverR = Phaser.Math.Clamp((w._hoverR || (t && t.active ? 32 : 26)) + addR, (t && t.active) ? 28 : 22, (t && t.active) ? 52 : 42);
            w._hoverAngle += Phaser.Math.FloatBetween(-0.9, 0.9);
          }
          const baseR = t && t.active ? (w._hoverR || 32) : (w._hoverR || 26);
          const hx = baseX + Math.cos(w._hoverAngle) * baseR; const hy = baseY + Math.sin(w._hoverAngle) * baseR;
          const dxh = hx - w.x; const dyh = hy - w.y; const llen = Math.hypot(dxh, dyh) || 1;
          const hsp = t ? 320 : 280; w.vx = (dxh / llen) * hsp; w.vy = (dyh / llen) * hsp;
          w.x += w.vx * dtw; w.y += w.vy * dtw; try { w.g.setPosition(w.x, w.y); } catch (_) {}
          try { const tAng = Math.atan2(w.vy, w.vx); w._rot = (typeof w._rot === 'number') ? Phaser.Math.Angle.RotateTo(w._rot, tAng, Phaser.Math.DegToRad(12)) : tAng; w.g.setRotation(w._rot); } catch (_) {}
          // Thruster draw (yellowish) with smoothing and speed threshold
          try { const g = w._thr; if (g) { g.clear(); } } catch (_) {}
          // Yellow compact thruster particles during hover (emit from rear with smoothing; fallback to facing when nearly stationary)
          try {
            const sp2 = (w.vx||0)*(w.vx||0) + (w.vy||0)*(w.vy||0);
            const base = (sp2 > 1) ? Math.atan2(w.vy || 0, w.vx || 0) : (w._rot || 0);
            const desired = base + Math.PI;
            w._thrBackAng = (typeof w._thrBackAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrBackAng, desired, Phaser.Math.DegToRad(12)) : desired;
            const ex = w.x + Math.cos(w._thrBackAng) * 6;
            const ey = w.y + Math.sin(w._thrBackAng) * 6;
            pixelSparks(this, ex, ey, { angleRad: w._thrBackAng, count: 1, spreadDeg: 4, speedMin: 70, speedMax: 120, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 });
          } catch (_) {}
          // Plan dash
          if (t && t.active) {
            const dxp2 = t.x - this.player.x; const dyp2 = t.y - this.player.y; const outOfRadius = (dxp2 * dxp2 + dyp2 * dyp2) > detectR2;
            const ready = (!w.lastDashAt || (noww - w.lastDashAt >= 900));
            if (ready && !outOfRadius) {
              const sx = w.x; const sy = w.y; const tx = t.x; const ty = t.y;
              const dx0 = tx - sx; const dy0 = ty - sy; const baseAng = Math.atan2(dy0, dx0);
              if (w._approachSign === undefined) w._approachSign = (Math.random() < 0.5 ? -1 : 1);
              w._approachSign *= -1;
              const angOff = Phaser.Math.FloatBetween(0.4, 0.7) * w._approachSign;
              const rOff = Phaser.Math.Between(10, 24);
              let ex = tx + Math.cos(baseAng + angOff) * rOff; let ey = ty + Math.sin(baseAng + angOff) * rOff;
              let dx = ex - sx; let dy = ey - sy; let len = Math.hypot(dx, dy) || 1;
              const minDashLen = 90; const maxDashLen = 140; const desired = Math.min(len, Phaser.Math.Between(minDashLen, maxDashLen));
              const ux = dx / len; const uy = dy / len; ex = sx + ux * desired; ey = sy + uy * desired; dx = ex - sx; dy = ey - sy; len = Math.hypot(dx, dy) || 1;
              const dur = Phaser.Math.Between(90, 130); const sp = ((len * 1000) / Math.max(1, dur)) * 1.2;
              w.vx = (dx / len) * sp; w.vy = (dy / len) * sp; w.dashUntil = noww + dur; w.lastDashAt = noww; w.state = 'dashing'; w.dashHit = false;
              try {
                const texKey = 'bit_trail_particle_bold';
                if (!this.textures || !this.textures.exists(texKey)) { const tg = this.make.graphics({ x: 0, y: 0, add: false }); tg.clear(); tg.fillStyle(0x66aaff, 1); tg.fillCircle(7, 7, 7); tg.generateTexture(texKey, 14, 14); tg.destroy(); }
                if (w._trailMgr) { try { w._trailMgr.destroy(); } catch (_) {} w._trailMgr = null; }
                w._trailMgr = this.add.particles(texKey); try { w._trailMgr.setDepth?.(9800); } catch (_) {}
                const emitter = w._trailMgr.createEmitter({ speed: { min: 0, max: 20 }, lifespan: { min: 260, max: 420 }, alpha: { start: 1.0, end: 0 }, scale: { start: 1.0, end: 0.1 }, quantity: 9, frequency: 6, tint: 0x66aaff, blendMode: Phaser.BlendModes.ADD });
                try { emitter.startFollow(w.g); } catch (_) {}
                w._trailEmitter = emitter;
              } catch (_) {}
            }
          }
          return true;
        });
      }
    }

    // Ignite burn ticking for boss (smooth 10Hz)
    this._igniteTickAccum = (this._igniteTickAccum || 0) + dt;
    const _burnTick = 0.1;
    if (this._igniteTickAccum >= _burnTick) {
      const stepIgn = this._igniteTickAccum; this._igniteTickAccum = 0;
      const burnDps = 30; const dmg = Math.max(0, Math.round(burnDps * stepIgn));
      const nowT = this.time.now; const e = this.boss;
      if (e?.active && e._ignitedUntil && nowT < e._ignitedUntil) {
        if (typeof e.hp !== 'number') e.hp = e.maxHp || 300;
        e.hp -= dmg; if (e.hp <= 0) this.killBoss(e);
        if (e._igniteIndicator?.setPosition) { try { e._igniteIndicator.setPosition(e.x, e.y - 20); } catch (_) {} }
      } else {
        if (e?._igniteIndicator) { try { e._igniteIndicator.destroy(); } catch (_) {} e._igniteIndicator = null; }
      }
    }

    // Toxin DPS for boss (no disorientation; bosses ignore confusion)
    this._toxinTickAccum = (this._toxinTickAccum || 0) + dt;
    const toxTick = 0.1;
    if (this._toxinTickAccum >= toxTick) {
      const stepT = this._toxinTickAccum; this._toxinTickAccum = 0;
      const toxDps = 3; const td = Math.max(0, Math.round(toxDps * stepT));
      const nowT = this.time.now; const e = this.boss;
      if (e?.active && e._toxinedUntil && nowT < e._toxinedUntil) {
        if (typeof e.hp !== 'number') e.hp = e.maxHp || 300;
        e.hp -= td; if (e.hp <= 0) this.killBoss(e);
        if (e._toxinIndicator?.setPosition) { try { e._toxinIndicator.setPosition(e.x, e.y - 20); } catch (_) {} }
      } else {
        if (e?._toxinIndicator) { try { e._toxinIndicator.destroy(); } catch (_) {} e._toxinIndicator = null; }
      }
    }

    // Stun indicator maintenance for boss
    this._stunTickAccum = (this._stunTickAccum || 0) + dt;
    if (this._stunTickAccum >= 0.1) {
      this._stunTickAccum = 0;
      const nowS = this.time.now;
      const e = this.boss;
      if (e?.active && e._stunnedUntil && nowS < e._stunnedUntil) {
        if (!e._stunIndicator) {
          try { e._stunIndicator = this.add.graphics(); e._stunIndicator.setDepth(9000); e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); } catch (_) {}
        }
        try { e._stunIndicator.setPosition(e.x, e.y - 24); } catch (_) {}
      } else {
        if (e?._stunIndicator) { try { e._stunIndicator.destroy(); } catch (_) {} e._stunIndicator = null; }
      }
    }

    // Update fire fields in BossScene (ignite on boss)
    if (!this._ffTickAccum) this._ffTickAccum = 0;
    this._ffTickAccum += dt;
    const ffTick = 0.1;
    if (this._ffTickAccum >= ffTick) {
      const step = this._ffTickAccum; this._ffTickAccum = 0;
      const ignitePerSec = 10; const igniteAdd = ignitePerSec * step;
      const nowT = this.time.now;
      this._firefields = (this._firefields || []).filter((f) => {
        if (nowT >= f.until) { try { f.g?.destroy(); } catch (_) {} try { f.pm?.destroy(); } catch (_) {} return false; }
        // Visual flicker/pulse
        try {
          f._pulse = (f._pulse || 0) + step;
          const pulse = 0.9 + 0.2 * Math.sin(f._pulse * 6.0);
          const jitter = Phaser.Math.Between(-2, 2);
          const r0 = Math.max(4, Math.floor(f.r * 0.50 * pulse));
          const r1 = Math.max(6, Math.floor(f.r * 0.85 + jitter));
          f.g.clear();
          f.g.fillStyle(0xff6622, 0.22).fillCircle(f.x, f.y, r0);
          f.g.fillStyle(0xffaa33, 0.14).fillCircle(f.x, f.y, r1);
          f.g.lineStyle(2, 0xffaa33, 0.45).strokeCircle(f.x, f.y, f.r + jitter);
        } catch (_) {}
        // Orange pixel sparks rising from the field (railgun/muzzle-style particles)
        try {
          if (!f._sparkAt || nowT >= f._sparkAt) {
            f._sparkAt = nowT + Phaser.Math.Between(40, 80);
            for (let i = 0; i < 2; i += 1) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const rr = Phaser.Math.FloatBetween(0, f.r * 0.7);
              const px = f.x + Math.cos(a) * rr;
              const py = f.y + Math.sin(a) * rr;
              pixelSparks(this, px, py, { angleRad: -Math.PI / 2, count: 1, spreadDeg: 24, speedMin: 50, speedMax: 110, lifeMs: 200, color: 0xffaa66, size: 2, alpha: 0.95 });
            }
          }
        } catch (_) {}

        const e = this.boss; if (e?.active) {
          const dx = e.x - f.x; const dy = e.y - f.y; if ((dx * dx + dy * dy) <= (f.r * f.r)) {
            e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
            if ((e._igniteValue || 0) >= 10) {
              e._ignitedUntil = nowT + 2000;
              e._igniteValue = 0; // reset on trigger
              if (!e._igniteIndicator) { e._igniteIndicator = this.add.graphics(); try { e._igniteIndicator.setDepth(9000); } catch (_) {} e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
              try { e._igniteIndicator.setPosition(e.x, e.y - 20); } catch (_) {}
            }
          }
        }
        return true;
      });
    }

    // Update BIT units ??replicate CombatScene behavior with boss as the only target
    if (!this._bits) this._bits = [];
    if (this._bits.length) {
      const dt2 = (this.game?.loop?.delta || 16.7) / 1000;
      const now2 = this.time.now;
      const boss = (this.boss && this.boss.active) ? this.boss : null;
      this._bits = this._bits.filter((bit) => {
        if (!bit || !bit.g) { try { bit?._thr?.destroy?.(); } catch (_) {} return false; }
        // Expire: return-to-player phase, despawn on contact
        if (now2 >= (bit.despawnAt || 0)) {
          let dx = this.player.x - bit.x; let dy = this.player.y - bit.y;
          let len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} try { bit._thr?.destroy?.(); } catch (_) {} return false; }
          const sp = 420;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt2; bit.y += bit.vy * dt2;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try { const tAng = Math.atan2(bit.vy, bit.vx); bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, tAng, Phaser.Math.DegToRad(14)) : tAng; bit.g.setRotation(bit._rot); } catch (_) {}
          try { const g = bit._thr; if (g) { g.clear(); } } catch (_) {}
          // Yellow compact thruster particles behind BIT while moving
          try { const back = Math.atan2(bit.vy || 0, bit.vx || 0) + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
          dx = this.player.x - bit.x; dy = this.player.y - bit.y; len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} try { bit._thr?.destroy?.(); } catch (_) {} return false; }
          return true;
        }
        // Spawn scatter: keep initial outward motion briefly
        if (bit.spawnScatterUntil && now2 < bit.spawnScatterUntil) {
          bit.x += (bit.vx || 0) * dt2; bit.y += (bit.vy || 0) * dt2;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try { const tAng = Math.atan2((bit.vy || 0), (bit.vx || 0)); bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, tAng, Phaser.Math.DegToRad(14)) : tAng; bit.g.setRotation(bit._rot); } catch (_) {}
          try { const g = bit._thr; if (g) { g.clear(); } } catch (_) {}
          // Yellow compact thruster particles during scatter
          try { const back = Math.atan2(bit.vy || 0, bit.vx || 0) + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
          return true;
        }
        // Emulate target acquisition: lock only if boss within lock range
        const lockR = 180; const lockR2 = lockR * lockR;
        let trg = null;
        if (boss) {
          const dx = boss.x - bit.x; const dy = boss.y - bit.y; const d2 = dx * dx + dy * dy;
          if (d2 <= lockR2) trg = boss;
        }
        if (!trg) {
          // Idle orbit near player
          if (bit._idleAngle === undefined) bit._idleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          if (bit._idleRadius === undefined) bit._idleRadius = Phaser.Math.Between(28, 48);
          if (bit._idleSpeed === undefined) bit._idleSpeed = Phaser.Math.FloatBetween(2.0, 3.2);
          bit._idleAngle += bit._idleSpeed * dt2;
          const px = this.player.x; const py = this.player.y;
          const tx = px + Math.cos(bit._idleAngle) * bit._idleRadius;
          const ty = py + Math.sin(bit._idleAngle) * bit._idleRadius;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1; const sp = 260;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt2; bit.y += bit.vy * dt2; try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // Face along orbit tangent for stable idle orientation
          try { const tangent = Math.atan2(ty - py, tx - px) + Math.PI / 2; bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, tangent, Phaser.Math.DegToRad(12)) : tangent; bit.g.setRotation(bit._rot); } catch (_) {}
          // Thruster aligned with facing (single-sided)
          try { const g = bit._thr; if (g) { g.clear(); } } catch (_) {}
          // Yellow compact thruster particles aligned with facing (backwards)
          try { const back = bit._rot + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
          return true;
        }
        // Firing hold: face target and emit compact thruster away from enemy/laser direction
        if (now2 < (bit.holdUntil || 0)) {
          try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {}
          try { const laserAng = Math.atan2(trg.y - bit.y, trg.x - bit.x); const back = laserAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
          return true;
        }
        // Decide next action
        if (!bit.moveUntil || now2 >= bit.moveUntil) {
          // Fire if in range
          const fireR = 180; const fireR2 = fireR * fireR;
          const ddx = trg.x - bit.x; const ddy = trg.y - bit.y; const dd2 = ddx * ddx + ddy * ddy;
          if ((!bit.lastShotAt || (now2 - bit.lastShotAt > 500)) && dd2 <= fireR2) {
            // Laser + damage
            try { const lg = this.add.graphics(); lg.setDepth(9000); lg.lineStyle(1, 0x66aaff, 1); lg.beginPath(); lg.moveTo(bit.x, bit.y); lg.lineTo(trg.x, trg.y); lg.strokePath(); this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } }); } catch (_) {}
            // Blue pixel spray at bit laser origin (shorter, much wider, and more intense)
            try { const ang2 = Phaser.Math.Angle.Between(bit.x, bit.y, trg.x, trg.y); pixelSparks(this, bit.x, bit.y, { angleRad: ang2, count: 12, spreadDeg: 70, speedMin: 110, speedMax: 200, lifeMs: 110, color: 0x66aaff, size: 2, alpha: 0.95 }); } catch (_) {}
            try { impactBurst(this, trg.x, trg.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {}
            if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300;
            this.boss.hp -= 7; if (this.boss.hp <= 0) { try { this.killBoss(this.boss); } catch (_) {} }
            bit.lastShotAt = now2; bit.holdUntil = now2 + 400; bit.moveUntil = now2 + 400; return true;
          }
          // Plan quick straight movement around target
          const angTo = Math.atan2(bit.y - trg.y, bit.x - trg.x);
          const off = Phaser.Math.FloatBetween(-Math.PI / 2, Math.PI / 2);
          const r = Phaser.Math.Between(40, 120);
          const tx = trg.x + Math.cos(angTo + off) * r;
          const ty = trg.y + Math.sin(angTo + off) * r;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1;
          const sp = 380; bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.moveUntil = now2 + Phaser.Math.Between(240, 420);
        } else {
          // Move step
          bit.x += bit.vx * dt2; bit.y += bit.vy * dt2;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try { bit.g.setRotation(Math.atan2(bit.vy, bit.vx) + Math.PI); } catch (_) {}
        }
        return true;
      });
    }

    // Ability cooldown progress for UI (match CombatScene)
    try {
      const nowT2 = this.time.now;
      const until = this.ability?.onCooldownUntil || 0;
      const active = nowT2 < until;
      const denom = this.ability?.cooldownMs || 10000;
      const remaining = Math.max(0, until - nowT2);
      const prog = active ? (1 - Math.min(1, remaining / denom)) : 1;
      this.registry.set('abilityCooldownActive', active);
      this.registry.set('abilityCooldownProgress', prog);

    // Update Repulsion Pulse effects (block boss projectiles and push boss)
    if (this._repulses && this._repulses.length) {
      const dt = (this.game?.loop?.delta || 16.7) / 1000;
      this._repulses = this._repulses.filter((rp) => {
        rp.r += rp.speed * dt;
        try {
          rp.g.clear();
          rp.g.setBlendMode?.(Phaser.BlendModes.ADD);
          const now3 = this.time.now;
          if (rp._lastTrailR === undefined) rp._lastTrailR = 0;
          if (!rp._trail) rp._trail = [];
          if ((rp.r - rp._lastTrailR) > 10) { rp._trail.push({ r: rp.r, t: now3 }); rp._lastTrailR = rp.r; }
          while (rp._trail.length > 6) rp._trail.shift();
          for (let i = 0; i < rp._trail.length; i += 1) {
            const it = rp._trail[i];
            const age = (now3 - it.t) / 300;
            const a = Math.max(0, 0.22 * (1 - Math.min(1, age)));
            if (a <= 0) continue;
            rp.g.lineStyle(6, 0xffaa33, a).strokeCircle(0, 0, it.r);
          }
          rp.g.lineStyle(8, 0xffaa33, 0.20).strokeCircle(0, 0, rp.r);
          rp.g.lineStyle(3, 0xffdd88, 0.95).strokeCircle(0, 0, Math.max(1, rp.r - 1));
          if (!rp._nextSparkAt) rp._nextSparkAt = now3;
          if (now3 >= rp._nextSparkAt) {
            const sparks = 8;
            for (let s = 0; s < sparks; s += 1) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const sx = rp.x + Math.cos(a) * rp.r;
              const sy = rp.y + Math.sin(a) * rp.r;
              try { pulseSpark(this, sx, sy, { color: 0xffaa66, size: 2, life: 180 }); } catch (_) {}
              try { pixelSparks(this, sx, sy, { angleRad: a, count: 1, spreadDeg: 6, speedMin: 90, speedMax: 160, lifeMs: 160, color: 0xffaa33, size: 2, alpha: 0.8 }); } catch (_) {}
            }
            rp._nextSparkAt = now3 + 28;
          }
        } catch (_) {}
        const band = rp.band;
        const r2min = (rp.r - band) * (rp.r - band);
        const r2max = (rp.r + band) * (rp.r + band);
        try {
          const arrB = this.bossBullets?.getChildren?.() || [];
          for (let i = 0; i < arrB.length; i += 1) {
            const b = arrB[i]; if (!b?.active) continue; const dx = b.x - rp.x; const dy = b.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) { try { impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'small' }); } catch (_) {} try { b.destroy(); } catch (_) {} }
          }
          const arrG = this.grenades?.getChildren?.() || [];
          for (let i = 0; i < arrG.length; i += 1) {
            const b = arrG[i]; if (!b?.active) continue; const dx = b.x - rp.x; const dy = b.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) { try { impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'small' }); } catch (_) {} try { b.destroy(); } catch (_) {} }
          }
        } catch (_) {}
        try {
          const boss = this.boss;
          if (boss?.active) {
            if (!rp._pushedSet) rp._pushedSet = new Set();
            const dx = boss.x - rp.x; const dy = boss.y - rp.y; const d2 = dx * dx + dy * dy;
            if (d2 >= r2min && d2 <= r2max) {
              if (!rp._pushedSet.has(boss) && !(time < (this._bossKnockUntil || 0))) {
                const d = Math.sqrt(d2) || 1; const nx = dx / d; const ny = dy / d; const power = 240;
                this._bossKnockUntil = time + 1000;
                boss._repulseVX = nx * power; boss._repulseVY = ny * power;
                try { boss.body?.setVelocity?.(boss._repulseVX, boss._repulseVY); } catch (_) { try { boss.setVelocity(boss._repulseVX, boss._repulseVY); } catch (_) {} }
                rp._pushedSet.add(boss);
                try {
                  if (!rp._hitBoss) {
                    rp._hitBoss = true;
                    if (typeof boss.hp !== 'number') boss.hp = boss.maxHp || 300;
                    boss.hp -= 5;
                    if (boss.hp <= 0) { try { this.killBoss(boss); } catch (_) {} }
                  }
                } catch (_) {}
              }
            }
          }
        } catch (_) {}
        if (rp.r >= rp.maxR) { try { rp.g.destroy(); } catch (_) {} return false; }
        return true;
      });
    }
    } catch (_) {}

    // Boss modern movement/attacks
    if (this.boss && this.boss.active) {
      // Stun freeze: hold boss in place and pause plans
      if (time < (this.boss._stunnedUntil || 0)) {
        try { this.boss.body?.setVelocity?.(0, 0); } catch (_) { try { this.boss.setVelocity(0, 0); } catch (_) {} }
        // Cancel ongoing dash prep/dash
        try { if (this._dashSeq) { this._dashSeq._hintG?.destroy?.(); this._dashSeq = null; } } catch (_) {}
        return;
      }
      // Respect repulsion knockback for 1s, do not re-plan attacks during this period
      if (time < (this._bossKnockUntil || 0)) {
        const vx = this.boss._repulseVX || 0; const vy = this.boss._repulseVY || 0;
        try { this.boss.body?.setVelocity?.(vx, vy); } catch (_) { try { this.boss.setVelocity(vx, vy); } catch (_) {} }
        return;
      }
      const dx = this.player.x - this.boss.x;
      const dy = this.player.y - this.boss.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const wobble = Math.sin(time / 300) * 60;
      const isCharger = (this.boss.bossType === 'Charger');
      // Charger multi-dash window
      if (isCharger) {
        if (!this._dashSeq && !this._castingGrenades && time >= (this._dashNextAt || 0)) {
          this._dashSeq = { phase: 'prep', until: time + 600, idx: 0 };
          try {
            const hint = this.add.graphics(); hint.setDepth(9500); hint.lineStyle(3, 0xff3333, 0.9);
            const to = Math.atan2(this.player.y - this.boss.y, this.player.x - this.boss.x);
            hint.beginPath(); hint.moveTo(this.boss.x, this.boss.y); hint.lineTo(this.boss.x + Math.cos(to) * 260, this.boss.y + Math.sin(to) * 260); hint.strokePath();
            this._dashSeq._hintG = hint; this._dashSeq._hintAngle = to;
          } catch (_) {}
        }
        if (this._dashSeq) {
          const ds = this._dashSeq;
          if (time >= ds.until) {
            if (ds.phase === 'prep' || ds.phase === 'wait') {
              // start dash towards hinted angle
              const ang = ds._hintAngle ?? Math.atan2(this.player.y - this.boss.y, this.player.x - this.boss.x);
              const sp = 600; this.boss.body.setVelocity(Math.cos(ang) * sp, Math.sin(ang) * sp);
              ds.phase = 'dash'; ds.until = time + 260; ds.idx += 1; ds.lastX = this.boss.x; ds.lastY = this.boss.y;
              try { ds._hintG?.destroy(); } catch (_) {}
            } else if (ds.phase === 'dash') {
              // end dash, damage line, maybe prep next
              this.boss.body.setVelocity(0, 0);
              try {
                const line = new Phaser.Geom.Line(ds.lastX ?? this.boss.x, ds.lastY ?? this.boss.y, this.boss.x, this.boss.y);
                const rect = this.player.getBounds();
                if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
                  if (time >= (this.player.iframesUntil || 0)) { this.applyPlayerDamage((this.boss.dashDamage || 20)); this.player.iframesUntil = time + 600; }
                }
                const arr = this.barricadesSoft?.getChildren?.() || [];
                for (let i = 0; i < arr.length; i += 1) { const s = arr[i]; if (!s?.active) continue; const r = s.getBounds(); if (Phaser.Geom.Intersects.LineToRectangle(line, r)) { try { s.destroy(); } catch (_) {} } }
              } catch (_) {}
              ds.phase = (ds.idx >= 3) ? 'done' : 'wait'; ds.until = time + 500;
              if (ds.phase === 'wait') {
                try {
                  const to = Math.atan2(this.player.y - this.boss.y, this.player.x - this.boss.x);
                  const g = this.add.graphics(); g.setDepth(9500); g.lineStyle(3, 0xff3333, 0.9);
                  g.beginPath(); g.moveTo(this.boss.x, this.boss.y); g.lineTo(this.boss.x + Math.cos(to) * 260, this.boss.y + Math.sin(to) * 260); g.strokePath();
                  ds._hintG = g; ds._hintAngle = to;
                } catch (_) {}
              }
            } else if (ds.phase === 'done') {
              this._dashNextAt = time + 8000; try { ds._hintG?.destroy(); } catch (_) {} this._dashSeq = null;
            }
          } else if (ds.phase === 'prep' || ds.phase === 'wait') {
            this.boss.body.setVelocity(0, 0);
          } else if (ds.phase === 'dash') {
            // During dash, continuously clear any barricades the boss passes through
            try {
              if (ds._px == null) { ds._px = ds.lastX ?? this.boss.x; ds._py = ds.lastY ?? this.boss.y; }
              const seg = new Phaser.Geom.Line(ds._px, ds._py, this.boss.x, this.boss.y);
              const arr = this.barricadesSoft?.getChildren?.() || [];
              for (let i = 0; i < arr.length; i += 1) {
                const s = arr[i]; if (!s?.active) continue; const r = s.getBounds();
                if (Phaser.Geom.Intersects.LineToRectangle(seg, r)) { try { s.destroy(); } catch (_) {} }
              }
              ds._px = this.boss.x; ds._py = this.boss.y;
            } catch (_) {}
          }
        } else {
          this.boss.body.setVelocity((nx * this.boss.speed) + wobble * -ny * 0.4, (ny * this.boss.speed) + wobble * nx * 0.4);
        }
      } else {
        this.boss.body.setVelocity((nx * this.boss.speed) + wobble * -ny * 0.4, (ny * this.boss.speed) + wobble * nx * 0.4);
      }

      if (TEMP_BOSS_BOUND_GUARD) {
        const { width, height } = this.scale; const pad = (this.boss?.body?.halfWidth || 12);
        this.boss.x = Phaser.Math.Clamp(this.boss.x, pad, width - pad);
        this.boss.y = Phaser.Math.Clamp(this.boss.y, pad, height - pad);
      }
    }

    // Boss shooting pattern (pause during dash)
    if (this.boss && this.boss.active && !this._castingGrenades) {
      const isCharger = (this.boss.bossType === 'Charger');
      // Do not shoot while any dash sequence is active
      const canShoot = !this._dashSeq;
      const base = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
      if (isCharger) {
        if (canShoot) {
          const nowT = time;
          if (!this._bossBurstLeft && (!this.lastBossShot || nowT - this.lastBossShot > 600)) {
            this._bossBurstLeft = 5; this._bossBurstBase = base; this._bossBurstSpread = Phaser.Math.DegToRad(16); this._bossNextBurstAt = nowT;
          }
          if (this._bossBurstLeft && nowT >= (this._bossNextBurstAt || 0)) {
            const firedIdx = 5 - this._bossBurstLeft; const t = (firedIdx / Math.max(1, 5 - 1)) - 0.5;
            const ang = (this._bossBurstBase || base) + t * (this._bossBurstSpread || 0);
            const vx = Math.cos(ang) * 750; const vy = Math.sin(ang) * 750;
            const b = this.bossBullets.get(this.boss.x, this.boss.y, 'bullet');
            if (b) { b.setActive(true).setVisible(true); b.setCircle(2).setOffset(-2, -2); b.setVelocity(vx, vy); b.setTint(0xff4444); b.update = () => { if (!this.cameras.main.worldView.contains(b.x, b.y)) b.destroy(); }; }
            this._bossBurstLeft -= 1; this._bossNextBurstAt = this._bossBurstLeft <= 0 ? 0 : nowT + 100; if (this._bossBurstLeft <= 0) this.lastBossShot = nowT;
          }
        }
      } else {
        if (!this.lastBossShot || time - this.lastBossShot > 700) {
          this.lastBossShot = time; const pellets = 7; const spreadRad = Phaser.Math.DegToRad(28);
          for (let i = 0; i < pellets; i += 1) {
            const t = (pellets === 1) ? 0 : (i / (pellets - 1)) - 0.5; const ang = base + t * spreadRad; const vx = Math.cos(ang) * 280; const vy = Math.sin(ang) * 280;
            const b = this.bossBullets.get(this.boss.x, this.boss.y, 'bullet'); if (!b) continue; b.setActive(true).setVisible(true); b.setCircle(2).setOffset(-2, -2); b.setVelocity(vx, vy); b.setTint(0xffff00); b.update = () => { if (!this.cameras.main.worldView.contains(b.x, b.y)) b.destroy(); };
          }
        }
      }
    }


    // Weapon sprite follow + texture sync (match CombatScene)
    try { updateWeaponSprite(this); } catch (_) {}
    try { if (this.gs) syncWeaponTexture(this, this.gs.activeWeapon); } catch (_) {}
    // Portal confirm: require interact (E) inside portal bounds
    try {
      if (this.exitActive && this.portal && this.portal.active) {
        const playerRect = this.player.getBounds();
        const portalRect = this.portal.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, portalRect)) {
          if (this.inputMgr?.pressedInteract) {
            this.gs.progressAfterBoss();
            SaveManager.saveToLocal(this.gs);
            const next = (this.gs.nextScene === 'Boss') ? SceneKeys.Boss : SceneKeys.Hub;
            this.scene.start(next);
          }
        }
      }
    } catch (_) {}

    // Boss ability: grenade volley for Shotgunner
    if (this.boss && this.boss.active && this.boss.bossType !== 'Charger') {
      if (time >= (this._grenadeNextAvailableAt || 0)) {
        if (!this._lastAbilityRollAt || (time - this._lastAbilityRollAt) > 500) {
          this._lastAbilityRollAt = time; if (Math.random() < 0.35) { this.castGrenadeVolley(); this._grenadeNextAvailableAt = time + 6000; }
        }
      }
    }

    // Note: grenade volley handled only for Shotgunner above

    // Portal check handled by physics overlap when it exists
  }

  // Simple generation: a few short lines and clusters, all destructible
  generateBossBarricades() {
    const rect = this.arenaRect; if (!rect) return;
    const tile = 16;
    const tilesX = Math.floor(rect.width / tile);
    const tilesY = Math.floor(rect.height / tile);
    const centerX = rect.centerX; const centerY = rect.centerY;
    const avoidR2 = 64 * 64;
    const used = new Set();
    const key = (x, y) => `${x},${y}`;
    const place = (gx, gy) => {
      if (gx < 1 || gy < 1 || gx >= tilesX - 1 || gy >= tilesY - 1) return;
      const wx = rect.x + gx * tile + tile / 2;
      const wy = rect.y + gy * tile + tile / 2;
      const dx = wx - centerX; const dy = wy - centerY;
      if (dx * dx + dy * dy < avoidR2) return;
      const k = key(gx, gy); if (used.has(k)) return; used.add(k);
      const s = this.physics.add.staticImage(wx, wy, 'barricade_soft');
      s.setData('destructible', true); s.setData('hp', 50);
      this.barricadesSoft.add(s);
    };
    // Lines
    const lines = 5;
    for (let i = 0; i < lines; i += 1) {
      const vertical = (i % 2) === 0;
      if (vertical) {
        const gx = Phaser.Math.Between(3, tilesX - 4);
        let gy = Phaser.Math.Between(2, tilesY - 8);
        const len = Phaser.Math.Between(4, 8);
        for (let j = 0; j < len; j += 1) { place(gx, gy); if (Math.random() < 0.15) { gy += 1; continue; } gy += 1; }
      } else {
        const gy = Phaser.Math.Between(3, tilesY - 4);
        let gx = Phaser.Math.Between(2, tilesX - 8);
        const len = Phaser.Math.Between(4, 8);
        for (let j = 0; j < len; j += 1) { place(gx, gy); if (Math.random() < 0.15) { gx += 1; continue; } gx += 1; }
      }
    }
    // Clusters
    const clusters = 7;
    for (let c = 0; c < clusters; c += 1) {
      const gx = Phaser.Math.Between(2, tilesX - 3);
      const gy = Phaser.Math.Between(2, tilesY - 3);
      const n = Phaser.Math.Between(3, 5);
      for (let k = 0; k < n; k += 1) { place(gx + Phaser.Math.Between(-1, 1), gy + Phaser.Math.Between(-1, 1)); }
    }
  }

  // Player bullet hits a barricade (all barricades here are destructible)
  onBulletHitBarricade(b, s) {
    if (!b || !b.active || !s) return;
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 50;
    const hp1 = hp0 - dmg;
    try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
    // Rockets: explode on barricade and splash boss if in range
    if (b._core === 'blast') {
      const radius = b._blastRadius || 70;
      try { impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
      const r2 = radius * radius; const ex = b.x; const ey = b.y;
      if (this.boss?.active) {
        const dx = this.boss.x - ex; const dy = this.boss.y - ey;
        if ((dx * dx + dy * dy) <= r2) {
          if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300;
          this.boss.hp -= (b.damage || 12);
          if (this.boss.hp <= 0) this.killBoss(this.boss);
        }
      }
      // Also damage nearby destructible barricades
      this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
      // Ensure fire field spawns on any explosive detonation, not only at target
      try { if (b._firefield) { this.spawnFireField(ex, ey, radius); this.applyNapalmIgniteToBoss(ex, ey, radius); } } catch (_) {}
    }
    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
    try { b.destroy(); } catch (_) {}
  }

  // Boss bullets collide with barricades (no splash)
  onBossBulletHitBarricade(b, s) {
    if (!b || !s) return;
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8;
    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 50;
    const hp1 = hp0 - dmg;
    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
    try { b.destroy(); } catch (_) {}
  }

  // Utility: damage all destructible barricades within radius (boss room)
  damageSoftBarricadesInRadius(x, y, radius, dmg) {
    try {
      const r2 = radius * radius;
      const arr = this.barricadesSoft?.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const dx = s.x - x; const dy = s.y - y;
        if ((dx * dx + dy * dy) <= r2) {
          const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 50;
          const hp1 = hp0 - dmg;
          if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
        }
      }
    } catch (_) {}
  }

  // Enemy body tries to push through a destructible barricade: damage over time
  onEnemyHitBarricade(e, s) {
    if (!s?.active) return;
    const now = this.time.now;
    const last = s.getData('_lastMeleeHurtAt') || 0;
    if (now - last < 250) return; // throttle
    s.setData('_lastMeleeHurtAt', now);
    const dmg = Math.max(6, Math.floor((e?.damage || 12) * 0.7));
    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 50;
    const hp1 = hp0 - dmg;
    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
  }

  createArenaWalls() {
    const { width, height } = this.scale;
    const tile = 16; const margin = 80;
    const w = width - margin; const h = height - margin;
    const x = (width - w) / 2; const y = (height - h) / 2;
    this.arenaRect = new Phaser.Geom.Rectangle(x, y, w, h);
    this.walls = this.physics.add.staticGroup();
    const tilesX = Math.ceil(w / tile); const tilesY = Math.ceil(h / tile);
    for (let i = 0; i < tilesX; i += 1) {
      const wx = x + i * tile + tile / 2;
      const top = this.physics.add.staticImage(wx, y + tile / 2, 'wall_tile');
      const bot = this.physics.add.staticImage(wx, y + h - tile / 2, 'wall_tile');
      this.walls.add(top); this.walls.add(bot);
    }
    for (let j = 1; j < tilesY - 1; j += 1) {
      const wy = y + j * tile + tile / 2;
      const left = this.physics.add.staticImage(x + tile / 2, wy, 'wall_tile');
      const right = this.physics.add.staticImage(x + w - tile / 2, wy, 'wall_tile');
      this.walls.add(left); this.walls.add(right);
    }
  }

  // Railgun helpers
  handleRailgunCharge(now, weapon, ptr) {
    const wid = this.gs.activeWeapon; const cap = this.getActiveMagCapacity(); this.ensureAmmoFor(wid, cap);
    const ammo = this.ammoByWeapon[wid] ?? 0; if (this.reload.active || ammo <= 0) { this.endRailAim(); return; }
    const maxMs = 1500; if (!this.rail) this.rail = { charging: false, startedAt: 0, aimG: null };
    const coreHold = !!weapon.railHold;
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);
    if (ptr.isDown && ((ptr.buttons & 1) === 1)) {
      if (!this.rail.charging) { if (!this.lastShot || (now - this.lastShot) > weapon.fireRateMs) { this.rail.charging = true; this.rail.startedAt = now; try { const key = ensurePixelParticle(this, 'rail_px', 0x66aaff, 1) || 'rail_px'; this.rail._mgr = this.add.particles(key); try { this.rail._mgr.setDepth(9500); } catch (_) {} try { this.rail._mgr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {} this.rail._em = this.rail._mgr.createEmitter({ speed: { min: 10, max: 60 }, lifespan: { min: 180, max: 320 }, alpha: { start: 1.0, end: 0 }, scale: 1, gravityY: 0, quantity: 0, }); } catch (_) {} } }
    } else {
      if (this.rail.charging) { const t = Math.min(1, (now - this.rail.startedAt) / maxMs); this.fireRailgun(baseAngle, weapon, t); this.rail.charging = false; this.endRailAim(); }
      return;
    }
    if (this.rail.charging) {
      const t = Math.min(1, (now - this.rail.startedAt) / maxMs); this.drawRailAim(baseAngle, weapon, t);
      if (t >= 1 && !coreHold) { this.fireRailgun(baseAngle, weapon, t); this.rail.charging = false; this.endRailAim(); }
    }
  }
  drawRailAim(angle, weapon, t) { try { if (!this.rail?.aimG) this.rail.aimG = this.add.graphics(); const g = this.rail.aimG; g.clear(); g.setDepth(9000); const spread0 = Phaser.Math.DegToRad(Math.max(0, weapon.spreadDeg || 0)); const spread = spread0 * (1 - t); const diag = Math.hypot(this.scale.width, this.scale.height); const len = Math.ceil(diag + 32); g.lineStyle(0.5, 0xffffff, 0.9); const a1 = angle - spread / 2; const a2 = angle + spread / 2; const x = this.player.x; const y = this.player.y; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a1) * len, y + Math.sin(a1) * len); g.strokePath(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len); g.strokePath(); try { const ts = [0.35, 0.55, 0.8]; const pick = Phaser.Math.Between(0, ts.length - 1); const pt = getWeaponBarrelPoint(this, ts[pick], 3); const common = { spreadDeg: 10, speedMin: 40, speedMax: 90, lifeMs: 140, color: 0x66aaff, size: 1, alpha: 0.45 }; pixelSparks(this, pt.x, pt.y, { angleRad: angle - Math.PI / 2, count: 1, ...common }); pixelSparks(this, pt.x, pt.y, { angleRad: angle + Math.PI / 2, count: 1, ...common }); } catch (_) {} } catch (_) {} }
  endRailAim() { try { this.rail?.aimG?.clear(); this.rail?.aimG?.destroy(); } catch (_) {} try { this.rail?._mgr?.destroy(); } catch (_) {} if (this.rail) { this.rail.aimG = null; this.rail._mgr = null; this.rail._em = null; } }
  fireRailgun(baseAngle, weapon, t) {
    const wid = this.gs.activeWeapon; const cap = this.getActiveMagCapacity(); this.ensureAmmoFor(wid, cap); const ammo = this.ammoByWeapon[wid] ?? 0; if (ammo <= 0 || this.reload.active) return;
    const dmg = Math.floor(weapon.damage * (1 + 2 * t)); const speed = Math.floor(weapon.bulletSpeed * (1 + 2 * t)); const spreadRad = Phaser.Math.DegToRad(Math.max(0, (weapon.spreadDeg || 0))) * (1 - t); const off = (spreadRad > 0) ? Phaser.Math.FloatBetween(-spreadRad / 2, spreadRad / 2) : 0; const angle = baseAngle + off; const vx = Math.cos(angle) * speed; const vy = Math.sin(angle) * speed;
    const b = this.bullets.get(this.player.x, this.player.y, 'bullet'); if (!b) return; b.setActive(true).setVisible(true); b.setCircle(2).setOffset(-2, -2); b.setVelocity(vx, vy); b.damage = dmg; b.setTint(0x66aaff); b._core = 'pierce'; b._pierceLeft = 999; b._rail = true; b._stunOnHit = weapon._stunOnHit || 0; const trail = this.add.graphics(); b._g = trail; trail.setDepth(8000); b._px = b.x; b._py = b.y; b.update = () => { try { trail.clear(); trail.lineStyle(2, 0xaaddff, 0.9); const tx = b.x - (vx * 0.02); const ty = b.y - (vy * 0.02); trail.beginPath(); trail.moveTo(b.x, b.y); trail.lineTo(tx, ty); trail.strokePath(); } catch (_) {} try { const line = new Phaser.Geom.Line(b._px ?? b.x, b._py ?? b.y, b.x, b.y); const boss = this.boss; if (boss && boss.active) { if (!b._hitSet) b._hitSet = new Set(); if (!b._hitSet.has(boss)) { const rect = boss.getBounds(); if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) { if (typeof boss.hp !== 'number') boss.hp = boss.maxHp || 300; boss.hp -= (b.damage || 12); if (b._stunOnHit && b._stunOnHit > 0) { const nowS = this.time.now; boss._stunValue = Math.min(10, (boss._stunValue || 0) + b._stunOnHit); if ((boss._stunValue || 0) >= 10) { boss._stunnedUntil = nowS + 200; boss._stunValue = 0; if (!boss._stunIndicator) { boss._stunIndicator = this.add.graphics(); try { boss._stunIndicator.setDepth(9000); } catch (_) {} boss._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); } try { boss._stunIndicator.setPosition(boss.x, boss.y - 24); } catch (_) {} } } try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {} b._hitSet.add(boss); if (boss.hp <= 0) this.killBoss(boss); } } } } catch (_) {} const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} } b._px = b.x; b._py = b.y; }; b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
    // Rail muzzle VFX: big blue split flash + particle burst
    try { const m = getWeaponMuzzleWorld(this, 3); muzzleFlashSplit(this, m.x, m.y, { angle, color: 0xaaddff, count: 4, spreadDeg: 30, length: 24, thickness: 5 }); const burst = { spreadDeg: 14, speedMin: 140, speedMax: 240, lifeMs: 280, color: 0x66aaff, size: 2, alpha: 0.9 }; pixelSparks(this, m.x, m.y, { angleRad: angle - Math.PI / 2, count: 10, ...burst }); pixelSparks(this, m.x, m.y, { angleRad: angle + Math.PI / 2, count: 10, ...burst }); if (this.rail?._em) { try { this.rail._em.explode?.(60, m.x, m.y); } catch (_) {} } try { this.rail?._mgr?.destroy(); } catch (_) {} if (this.rail) { this.rail._mgr = null; this.rail._em = null; } } catch (_) {}
    // High recoil kick for railgun
    try { this._weaponRecoil = Math.max(this._weaponRecoil || 0, 5.5); } catch (_) {}
    this.ammoByWeapon[wid] = Math.max(0, (this.ammoByWeapon[wid] ?? cap) - 1);
    this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
    const nowT = this.time.now;
    this.lastShot = nowT;
    if (this.ammoByWeapon[wid] <= 0) {
      if (!this.reload.active) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = nowT + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    }
  }

  castGrenadeVolley() {
    // Throw five grenades one at a time, 0.5s between each
    this._castingGrenades = true;
    for (let i = 0; i < 5; i += 1) {
      this.time.delayedCall(i * 500, () => {
        if (!this.boss || !this.boss.active) return;
        const tx = this.player.x; const ty = this.player.y;
        this.throwGrenadeAt(tx, ty);
        if (i === 4) {
          // End of volley shortly after last throw
          this.time.delayedCall(100, () => { this._castingGrenades = false; });
        }
      });
    }
  }

  throwGrenadeAt(targetX, targetY) {
    const b = this.grenades.get(this.boss.x, this.boss.y, 'bullet');
    if (!b) return;
    b.setActive(true).setVisible(true);
    // Make grenade visually distinct (red tint, slightly larger)
    b.setCircle(3).setOffset(-3, -3);
    try { b.setScale(1.3); } catch (_) {}
    b.setTint(0xff4444);
    const angle = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, targetX, targetY);
    const speed = 220;
    const vx = Math.cos(angle) * speed; const vy = Math.sin(angle) * speed;
    b.setVelocity(vx, vy);
    b._spawnAt = this.time.now;
    b._lifeMs = 800; // explode after ~0.8s
    b._targetX = targetX; b._targetY = targetY;
    b.update = () => {
      const now = this.time.now;
      const dx = b.x - b._targetX; const dy = b.y - b._targetY;
      const near = (dx * dx + dy * dy) <= 18 * 18;
      const expired = (now - b._spawnAt) >= b._lifeMs;
      const view = this.cameras?.main?.worldView;
      const off = view && !view.contains(b.x, b.y);
      if (near || expired || off) {
        const ex = b.x; const ey = b.y;
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius: 70 }); } catch (_) {}
        // Damage player if within radius (use rocket-like radius ~70)
        const radius = 70; const r2 = radius * radius;
        const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2) {
          if (now >= this.player.iframesUntil) {
            this.applyPlayerDamage((this.boss.damage || 20));
            this.player.iframesUntil = now + 500;
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        // Also damage destructible barricades near grenade explosion
        this.damageSoftBarricadesInRadius(ex, ey, radius, (this.boss?.damage || 20));
        try { b.destroy(); } catch (_) {}
      }
    };
  }
  
  // Simple generation: a few short lines and clusters, all destructible
  generateBossBarricades() {
    const rect = this.arenaRect || new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
    const tile = 16;
    const tilesX = Math.floor(rect.width / tile);
    const tilesY = Math.floor(rect.height / tile);
    const centerX = rect.centerX; const centerY = rect.centerY;
    const avoidR2 = 64 * 64;
    const used = new Set();
    const key = (x, y) => `${x},${y}`;
    const place = (gx, gy) => {
      if (gx < 1 || gy < 1 || gx >= tilesX - 1 || gy >= tilesY - 1) return;
      const wx = rect.x + gx * tile + tile / 2;
      const wy = rect.y + gy * tile + tile / 2;
      const dx = wx - centerX; const dy = wy - centerY;
      if (dx * dx + dy * dy < avoidR2) return;
      const k = key(gx, gy); if (used.has(k)) return; used.add(k);
      const s = this.physics.add.staticImage(wx, wy, 'barricade_soft');
      s.setData('destructible', true); s.setData('hp', 20);
      this.barricadesSoft.add(s);
    };
    // Lines
    const lines = 5;
    for (let i = 0; i < lines; i += 1) {
      const vertical = (i % 2) === 0;
      if (vertical) {
        const gx = Phaser.Math.Between(3, tilesX - 4);
        let gy = Phaser.Math.Between(2, tilesY - 8);
        const len = Phaser.Math.Between(4, 8);
        for (let j = 0; j < len; j += 1) { place(gx, gy); gy += 1; }
      } else {
        const gy = Phaser.Math.Between(3, tilesY - 4);
        let gx = Phaser.Math.Between(2, tilesX - 8);
        const len = Phaser.Math.Between(4, 8);
        for (let j = 0; j < len; j += 1) { place(gx, gy); gx += 1; }
      }
    }
    // Clusters
    const clusters = 6;
    for (let c = 0; c < clusters; c += 1) {
      const gx = Phaser.Math.Between(2, tilesX - 3);
      const gy = Phaser.Math.Between(2, tilesY - 3);
      const n = Phaser.Math.Between(3, 5);
      for (let k = 0; k < n; k += 1) { place(gx + Phaser.Math.Between(-1, 1), gy + Phaser.Math.Between(-1, 1)); }
    }
  }

  // Player bullet hits barricade (all destructible)
  onBulletHitBarricade(b, s) {
    if (b?._rail) return; if (!b || !b.active || !s) return;
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
    const hp1 = hp0 - dmg;
    try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
    if (b._core === 'blast') {
      const radius = b._blastRadius || 20; try { impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
      const r2 = radius * radius; const ex = b.x; const ey = b.y;
      if (this.boss?.active) { const dx = this.boss.x - ex; const dy = this.boss.y - ey; if ((dx * dx + dy * dy) <= r2) { if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300; const splash = b._rocket ? (b.damage || 12) : Math.ceil((b.damage || 12) * 0.5); this.boss.hp -= splash; if (this.boss.hp <= 0) this.killBoss(this.boss); } }
      this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
    }
    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
    try { b.destroy(); } catch (_) {}
  }

  // Boss bullets into barricades
  onBossBulletHitBarricade(b, s) { if (!b || !s) return; const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8; const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20; const hp1 = hp0 - dmg; if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); } try { b.destroy(); } catch (_) {} }

  // Utility AoE damage to soft barricades
  damageSoftBarricadesInRadius(x, y, radius, dmg) {
    try { const r2 = radius * radius; const arr = this.barricadesSoft?.getChildren?.() || []; for (let i = 0; i < arr.length; i += 1) { const s = arr[i]; if (!s?.active) continue; const dx = s.x - x; const dy = s.y - y; if ((dx * dx + dy * dy) <= r2) { const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20; const hp1 = hp0 - dmg; if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); } } } } catch (_) {}
  }

  // Boss trying to push destructible cover
  onEnemyHitBarricade(e, s) { if (!s?.active) return; const now = this.time.now; const last = s.getData('_lastMeleeHurtAt') || 0; if (now - last < 250) return; s.setData('_lastMeleeHurtAt', now); const dmg = Math.max(6, Math.floor((e?.damage || 12) * 0.7)); const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20; const hp1 = hp0 - dmg; if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); } }

  // Optional walls
  createArenaWalls() {
    const { width, height } = this.scale; const tile = 16; const margin = 80; const w = width - margin; const h = height - margin; const x = (width - w) / 2; const y = (height - h) / 2; this.arenaRect = new Phaser.Geom.Rectangle(x, y, w, h); this.walls = this.physics.add.staticGroup(); const tilesX = Math.ceil(w / tile); const tilesY = Math.ceil(h / tile); for (let i = 0; i < tilesX; i += 1) { const wx = x + i * tile + tile / 2; const top = this.physics.add.staticImage(wx, y + tile / 2, 'wall_tile'); const bot = this.physics.add.staticImage(wx, y + h - tile / 2, 'wall_tile'); this.walls.add(top); this.walls.add(bot); } for (let j = 1; j < tilesY - 1; j += 1) { const wy = y + j * tile + tile / 2; const left = this.physics.add.staticImage(x + tile / 2, wy, 'wall_tile'); const right = this.physics.add.staticImage(x + w - tile / 2, wy, 'wall_tile'); this.walls.add(left); this.walls.add(right); }
  }
  
  // Deploy BITs ??identical to CombatScene
  deployBITs() {
    if (!this._bits) this._bits = [];
    // Green particle spawn burst around player
    try { bitSpawnRing(this, this.player.x, this.player.y, { radius: 18, lineWidth: 3, duration: 420, scaleTarget: 2.0 }); } catch (_) {}
    try { const cx = this.player.x, cy = this.player.y; for (let i = 0; i < 18; i += 1) { const a = Phaser.Math.FloatBetween(0, Math.PI * 2); pixelSparks(this, cx, cy, { angleRad: a, count: 1, spreadDeg: 6, speedMin: 80, speedMax: 180, lifeMs: 240, color: 0x33ff66, size: 2, alpha: 0.8 }); } } catch (_) {}
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      // Use asset sprite for BIT unit and fit to moderate height
      const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
      try { g.setDepth(9000); } catch (_) {}
      const bit = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g, target: null, lastShotAt: 0, holdUntil: 0, moveUntil: 0, despawnAt: this.time.now + 7000, spawnScatterUntil: this.time.now + Phaser.Math.Between(260, 420) };
      try { bit._thr = this.add.graphics(); bit._thr.setDepth(8800); bit._thr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      // initial scatter velocity
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const sp = Phaser.Math.Between(180, 260);
      bit.vx = Math.cos(a) * sp; bit.vy = Math.sin(a) * sp; bit.moveUntil = this.time.now + Phaser.Math.Between(200, 400);
      this._bits.push(bit);
    }
  }


  deployRepulsionPulse() {
    if (!this._repulses) this._repulses = [];
    const x = this.player.x, y = this.player.y;
    const g = this.add.graphics({ x, y });
    try { g.setDepth?.(9000); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    const rect = this.arenaRect || new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
    const corners = [ { x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom } ];
    let maxD = 0; for (let i = 0; i < corners.length; i += 1) { const dx = corners[i].x - x; const dy = corners[i].y - y; const d = Math.hypot(dx, dy); if (d > maxD) maxD = d; }
    const obj = { x, y, r: 0, band: 8, speed: 300, maxR: maxD + 24, g };
    this._repulses.push(obj);
  }

  // Deploy ADS ??identical to CombatScene
  deployADS() {
    const x = this.player.x; const y = this.player.y;
    const g = createFittedImage(this, x, y, 'ability_ads',  20);
    try { g.setDepth(9000); } catch (_) {}
    const obj = { x, y, g, radius: 120, nextZapAt: 0, until: this.time.now + 8000 };
    this._gadgets.push(obj);
  }
  // Returns the effective magazine capacity for the currently active weapon
  getActiveMagCapacity() {
    try {
      const w = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
      const useCeil = !!w._magRoundUp;
      const raw = (w.magSize || 1);
      const cap = Math.max(1, useCeil ? Math.ceil(raw) : Math.floor(raw));
      return cap;
    } catch (_) {
      return 1;
    }
  }

  // Ensure ammo entry exists for weaponId. If clampOnly, only caps ammo when above capacity
  ensureAmmoFor(weaponId, capacity, clampOnly = false) {
    if (weaponId == null) return;
    if (this.ammoByWeapon[weaponId] == null) {
      this.ammoByWeapon[weaponId] = Math.max(0, capacity | 0);
      return;
    }
    if (clampOnly) {
      if (this.ammoByWeapon[weaponId] > capacity) this.ammoByWeapon[weaponId] = capacity;
    }
  }

  // Returns reload time in ms for active weapon (default 1.5s, rocket 2s)
  getActiveReloadMs() {
    try {
      const w = getEffectiveWeapon(this.gs, this.gs.activeWeapon);
      if (typeof w.reloadMs === 'number') return w.reloadMs;
      return (w.projectile === 'rocket') ? 1000 : 1500;
    } catch (_) {
      return 1500;
    }
  }

  // Laser mechanics (continuous, clip on boss/barricades, non-penetrating)
  handleLaser(now, weapon, ptr, dt) {
    if (!this.laser) this.laser = { heat: 0, firing: false, overheat: false, startedAt: 0, coolDelayUntil: 0, g: null, lastTickAt: 0 };
    if (!this.laser.g) {
      this.laser.g = this.add.graphics();
      // Keep beam under weapon layer; weapon is set to a very high depth
      try { this.laser.g.setDepth(8000); this.laser.g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    }
    const lz = this.laser;
    const canPress = ptr?.isDown && ((ptr.buttons & 1) === 1);
    const canFire = canPress && !lz.overheat;
    const heatPerSec = 1 / 5; const coolDelay = 0.5; const coolFastPerSec = 2.5; const tickRate = 0.1;
    if (canFire) {
      if (!lz.firing) { lz.firing = true; lz.startedAt = now; }
      lz.heat = Math.min(1, lz.heat + heatPerSec * dt);
      if (lz.heat >= 1 && !lz.overheat) {
        lz.overheat = true;
        this.reload.active = true; this.reload.duration = this.getActiveReloadMs(); this.reload.until = now + this.reload.duration;
        this.registry.set('reloadActive', true); this.registry.set('reloadProgress', 0);
      }
    } else {
      if (lz.firing) { lz.firing = false; lz.coolDelayUntil = now + Math.floor(coolDelay * 1000); }
      if (!lz.overheat) {
        if (now >= lz.coolDelayUntil) lz.heat = Math.max(0, lz.heat - coolFastPerSec * dt);
      } else {
        if (!this.reload.active || now >= this.reload.until) {
          lz.overheat = false; lz.heat = 0; this.reload.active = false; this.reload.duration = 0;
          this.registry.set('reloadActive', false); this.registry.set('reloadProgress', 1);
        } else {
          const remaining = Math.max(0, this.reload.until - now); const dur = Math.max(1, this.reload.duration || this.getActiveReloadMs());
          const prog = 1 - Math.min(1, remaining / dur); this.registry.set('reloadActive', true); this.registry.set('reloadProgress', prog);
        }
      }
    }
    this.registry.set('laserHeat', lz.heat); this.registry.set('laserOverheated', !!lz.overheat);
    lz.g.clear();
    if (canFire && !lz.overheat) {
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);
      // Start from weapon sprite location for more natural origin
      const wx = (this.weaponSprite?.x ?? this.player.x);
      const wy = (this.weaponSprite?.y ?? this.player.y);
      const sx = wx + Math.cos(angle) * 4;
      const sy = wy + Math.sin(angle) * 4;
      const hit = this.computeLaserEnd(angle, sx, sy);
      const ex = hit.ex, ey = hit.ey; const e = hit.hitEnemy;
      try {
        lz.g.lineStyle(3, 0xff3333, 0.9).beginPath(); lz.g.moveTo(sx, sy); lz.g.lineTo(ex, ey); lz.g.strokePath();
        lz.g.lineStyle(1, 0x66aaff, 1).beginPath(); lz.g.moveTo(sx, sy - 1); lz.g.lineTo(ex, ey); lz.g.strokePath();
      } catch (_) {}
      lz.lastTickAt = (lz.lastTickAt || 0) + dt;
      if (lz.lastTickAt >= tickRate) {
        const step = lz.lastTickAt; lz.lastTickAt = 0; const dps = 30; const ignitePerSec = 8; const dmg = Math.max(0, Math.round(dps * step)); const igniteAdd = ignitePerSec * step;
        if (e && e.active) {
          try { impactBurst(this, ex, ey, { color: 0xff4455, size: 'small' }); } catch (_) {}
          if (typeof e.hp !== 'number') e.hp = e.maxHp || 300; e.hp -= dmg; if (e.hp <= 0) this.killBoss(e);
          e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
          if ((e._igniteValue || 0) >= 10) {
            e._ignitedUntil = this.time.now + 2000;
            e._igniteValue = 0; // reset on trigger
            if (!e._igniteIndicator) { e._igniteIndicator = this.add.graphics(); try { e._igniteIndicator.setDepth(9000); } catch (_) {} e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
            try { e._igniteIndicator.setPosition(e.x, e.y - 20); } catch (_) {}
          }
        }
      }
    }
  }

  computeLaserEnd(angle, sxOverride = null, syOverride = null) {
    const sx = (typeof sxOverride === 'number') ? sxOverride : this.player.x;
    const sy = (typeof syOverride === 'number') ? syOverride : this.player.y;
    const maxLen = 1000; const ex0 = sx + Math.cos(angle) * maxLen; const ey0 = sy + Math.sin(angle) * maxLen; const ray = new Phaser.Geom.Line(sx, sy, ex0, ey0);
    let ex = ex0; let ey = ey0; let bestD2 = Infinity; let hitEnemy = null;
    // Barricades (soft only here)
    const arr = this.barricadesSoft?.getChildren?.() || [];
    for (let i = 0; i < arr.length; i += 1) {
      const s = arr[i]; if (!s?.active) continue; const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
      if (pts && pts.length) { const p = pts[0]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; } }
    }
    // Boss hit
    const e = this.boss; if (e?.active) {
      const rect = e.getBounds?.() || new Phaser.Geom.Rectangle(e.x - 10, e.y - 10, 20, 20);
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
      if (pts && pts.length) { const p = pts[0]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; hitEnemy = e; } }
    }
    return { ex, ey, line: new Phaser.Geom.Line(sx, sy, ex, ey), hitEnemy };
  }

  // Spawn a temporary fire field that applies ignite to boss while inside
  spawnFireField(x, y, radius, durationMs = 2000) {
    if (!this._firefields) this._firefields = [];
    // Additive glow we can flicker each tick
    const g = this.add.graphics();
    try { g.setDepth(7000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}

    // Lightweight particle flames rising within the radius
    let pm = null; let em = null;
    try {
      const texKey = 'fire_particle';
      if (!this.textures || !this.textures.exists(texKey)) {
        const tg = this.make.graphics({ x: 0, y: 0, add: false });
        tg.clear();
        tg.fillStyle(0xffdd66, 1).fillCircle(6, 6, 3);
        tg.fillStyle(0xff9933, 0.9).fillCircle(6, 6, 5);
        tg.fillStyle(0xff5522, 0.5).fillCircle(6, 6, 6);
        tg.generateTexture(texKey, 12, 12);
        tg.destroy();
      }
      pm = this.add.particles(texKey);
      try { pm.setDepth(7050); } catch (_) {}
      const zone = new Phaser.Geom.Circle(x, y, Math.max(6, Math.floor(radius * 0.85)));
      em = pm.createEmitter({
        emitZone: { type: 'random', source: zone },
        frequency: 35,
        quantity: 3,
        lifespan: { min: 400, max: 900 },
        speedY: { min: -70, max: -25 },
        speedX: { min: -30, max: 30 },
        alpha: { start: 0.95, end: 0 },
        scale: { start: 0.9, end: 0 },
        gravityY: -30,
        tint: [0xffdd66, 0xffbb55, 0xff9933, 0xff5522],
        blendMode: Phaser.BlendModes.ADD,
      });
    } catch (_) {}

    // Initial draw
    try {
      g.clear();
      const inner = Math.max(4, Math.floor(radius * 0.55));
      g.fillStyle(0xff6633, 0.22).fillCircle(x, y, inner);
      g.fillStyle(0xffaa33, 0.14).fillCircle(x, y, Math.floor(radius * 0.85));
      g.lineStyle(2, 0xffaa33, 0.5).strokeCircle(x, y, radius);
    } catch (_) {}
    // Initial orange pixel spark burst (railgun/muzzle-style)
    try {
      const bases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      for (let i = 0; i < bases.length; i += 1) {
        const base = bases[i] + Phaser.Math.FloatBetween(-0.2, 0.2);
        pixelSparks(this, x, y, { angleRad: base, count: 6, spreadDeg: 38, speedMin: 80, speedMax: 160, lifeMs: 220, color: 0xffaa66, size: 2, alpha: 0.95 });
      }
    } catch (_) {}

    const obj = { x, y, r: radius, until: this.time.now + durationMs, g, pm, em, _pulse: 0 };
    this._firefields.push(obj);
    return obj;
  }
}









