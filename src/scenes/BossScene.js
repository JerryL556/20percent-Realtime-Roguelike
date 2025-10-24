import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { createBoss } from '../systems/EnemyFactory.js';
import { HpBar } from '../ui/HpBar.js';
import { getWeaponById } from '../core/Weapons.js';
import { impactBurst, bitSpawnRing } from '../systems/Effects.js';
import { preloadWeaponAssets, createPlayerWeaponSprite, syncWeaponTexture, updateWeaponSprite, createFittedImage } from '../systems/WeaponVisuals.js';
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

    // Ability system (match normal rooms)
    this._gadgets = [];
    this._bits = [];
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
      this.gs.hp -= this.boss.damage;
      this.player.iframesUntil = this.time.now + 700;
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
      // Visual impact effect by core type
      try {
        const core = b._core || null;
        if (core === 'blast') {
          const radius = b._blastRadius || 40;
          impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius });
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
    this.physics.add.collider(this.bullets, this.barricadesSoft, (b, s) => this.onBulletHitBarricade(b, s));

    // Boss bullets (Arcade.Image pool)
    this.bossBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 64,
      runChildUpdate: true,
    });
    this.physics.add.overlap(this.player, this.bossBullets, (p, b) => {
      const inIframes = this.time.now < this.player.iframesUntil;
      if (!inIframes) {
        this.gs.hp -= 10; // boss bullet damage
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
    try { e.destroy(); } catch (_) {}
  }

  shoot() {
    const gs = this.gs;
    const weapon = getEffectiveWeapon(gs, gs.activeWeapon);
    const startX = this.player.x;
    const startY = this.player.y;
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.inputMgr.pointer.worldX, this.inputMgr.pointer.worldY);
    this.playerFacing = baseAngle;
    const pellets = weapon.pelletCount || 1;
    // Dynamic spread similar to Combat
    const heat = this._spreadHeat || 0;
    const maxExtra = (typeof weapon.maxSpreadDeg === 'number') ? weapon.maxSpreadDeg : 20;
    const extraDeg = weapon.singleFire ? 0 : (maxExtra * heat);
    const totalSpreadRad = Phaser.Math.DegToRad((weapon.spreadDeg || 0) + extraDeg);
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
        b._startX = startX; b._startY = startY;
        b._targetX = targetX; b._targetY = targetY;
        const sx = targetX - startX; const sy = targetY - startY;
        b._targetLen2 = sx * sx + sy * sy;
        b.update = () => {
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
          const dxs = (b.x - b._startX); const dys = (b.y - b._startY);
          const prog = dxs * (sx) + dys * (sy);
          const dx = b.x - b._targetX; const dy = b.y - b._targetY;
          const nearTarget = (dx * dx + dy * dy) <= 64;
          const passed = prog >= b._targetLen2 - 1;
          if (nearTarget || passed) {
            const ex = b.x; const ey = b.y;
            try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large' }); } catch (_) {}
            const radius = b._blastRadius || 70; const r2 = radius * radius;
            // Damage boss if in radius
            if (this.boss && this.boss.active) {
              const ddx = this.boss.x - ex; const ddy = this.boss.y - ey;
              if ((ddx * ddx + ddy * ddy) <= r2) {
                if (typeof this.boss.hp !== 'number') this.boss.hp = this.boss.maxHp || 300;
                this.boss.hp -= b.damage || 12;
                if (this.boss.hp <= 0) this.killBoss(this.boss);
              }
            }
            // Also damage nearby destructible barricades
            this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
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
      b.setTint(0xffffff);
      b._core = weapon._core || null;
      if (b._core === 'pierce') { b._pierceLeft = 1; }
      b.setTint(0xffffff); // player bullets are white
      b.update = () => {
        if (!this.cameras.main.worldView.contains(b.x, b.y)) b.destroy();
      };
      b.on('destroy', () => b._g?.destroy());
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
    if (this.inputMgr.isLMBDown && !weapon.singleFire && !isRail) {
      this._spreadHeat = Math.min(1, this._spreadHeat + rampPerSec * dt);
    } else {
      this._spreadHeat = Math.max(0, this._spreadHeat - coolPerSec * dt);
    }
    const ptr = this.inputMgr.pointer;
    if (this._lmbWasDown === undefined) this._lmbWasDown = false;
    const edgeDown = (!this._lmbWasDown) && !!ptr.isDown && ((ptr.buttons & 1) === 1);
    const wantsClick = !!ptr.justDown || edgeDown;
    if (isRail) { this.handleRailgunCharge(time, weapon, ptr); }
    const wantsShot = (!isRail) && (weapon.singleFire ? wantsClick : this.inputMgr.isLMBDown);
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
    }

    // Manual reload (R)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.r)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      if (!this.reload.active && (this.ammoByWeapon[wid] ?? 0) < cap) {
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
          this.ability.onCooldownUntil = nowT + 3000; // 3s
        } else if (abilityId === 'bits') {
          this.deployBITs();
          this.ability.onCooldownUntil = nowT + 3000; // 3s
        } else if (abilityId === 'repulse') {
          this.deployRepulsionPulse();
          this.ability.onCooldownUntil = nowT + 3000; // 3s
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
              lg.beginPath(); lg.moveTo(g.x, g.y - 4); lg.lineTo(best.x, best.y); lg.strokePath();
              lg.setAlpha(1);
              this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
            } catch (_) { /* ignore */ }
            try { impactBurst(this, best.x, best.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            try { best.destroy(); } catch (_) {}
            g.nextZapAt = nowT + 100; // 10 per second
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
        if (!bit || !bit.g) return false;
        // Expire: return-to-player phase, despawn on contact
        if (now2 >= (bit.despawnAt || 0)) {
          let dx = this.player.x - bit.x; let dy = this.player.y - bit.y;
          let len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} return false; }
          const sp = 420;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt2; bit.y += bit.vy * dt2;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try { bit.g.setRotation(Math.atan2(bit.vy, bit.vx) + Math.PI); } catch (_) {}
          dx = this.player.x - bit.x; dy = this.player.y - bit.y; len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} return false; }
          return true;
        }
        // Spawn scatter: keep initial outward motion briefly
        if (bit.spawnScatterUntil && now2 < bit.spawnScatterUntil) {
          bit.x += (bit.vx || 0) * dt2; bit.y += (bit.vy || 0) * dt2;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try { bit.g.setRotation(Math.atan2((bit.vy || 0), (bit.vx || 0)) + Math.PI); } catch (_) {}
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
          if (bit._idleRadius === undefined) bit._idleRadius = Phaser.Math.Between(20, 36);
          if (bit._idleSpeed === undefined) bit._idleSpeed = Phaser.Math.FloatBetween(2.0, 3.2);
          bit._idleAngle += bit._idleSpeed * dt2;
          const px = this.player.x; const py = this.player.y;
          const tx = px + Math.cos(bit._idleAngle) * bit._idleRadius;
          const ty = py + Math.sin(bit._idleAngle) * bit._idleRadius;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1; const sp = 260;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt2; bit.y += bit.vy * dt2; try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try { bit.g.setRotation(Math.atan2(bit.vy, bit.vx) + Math.PI); } catch (_) {}
          return true;
        }
        // Firing hold: face target
        if (now2 < (bit.holdUntil || 0)) {
          try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {}
          return true;
        }
        // Decide next action
        if (!bit.moveUntil || now2 >= bit.moveUntil) {
          // Fire if in range
          const fireR = 180; const fireR2 = fireR * fireR;
          const ddx = trg.x - bit.x; const ddy = trg.y - bit.y; const dd2 = ddx * ddx + ddy * ddy;
          if ((!bit.lastShotAt || (now2 - bit.lastShotAt > 500)) && dd2 <= fireR2) {
            // Laser + damage
            try {
              const lg = this.add.graphics(); lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              lg.beginPath(); lg.moveTo(bit.x, bit.y); lg.lineTo(trg.x, trg.y); lg.strokePath();
              this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
            } catch (_) {}
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
      const denom = 10000;
      const remaining = Math.max(0, until - nowT2);
      const prog = active ? (1 - Math.min(1, remaining / denom)) : 1;
      this.registry.set('abilityCooldownActive', active);
      this.registry.set('abilityCooldownProgress', prog);

    // Update Repulsion Pulse effects (block boss projectiles and push boss)
    if (this._repulses && this._repulses.length) {
      const dt = (this.game?.loop?.delta || 16.7) / 1000;
      this._repulses = this._repulses.filter((rp) => {
        rp.r += rp.speed * dt;
        try { rp.g.clear(); rp.g.lineStyle(3, 0xffaa33, 1.0).strokeCircle(0, 0, rp.r); } catch (_) {}
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
          const boss = this.boss; if (boss?.active) { const dx = boss.x - rp.x; const dy = boss.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) { const d = Math.sqrt(d2) || 1; const nx = dx / d; const ny = dy / d; const power = 240; try { boss.body?.setVelocity?.(nx * power, ny * power); } catch (_) { try { boss.setVelocity(nx * power, ny * power); } catch (_) {} } } }
          // Deal 5 damage to boss once per pulse
          try {
            if (!rp._hitBoss) {
              rp._hitBoss = true;
              if (typeof boss.hp !== 'number') boss.hp = boss.maxHp || 300;
              boss.hp -= 5;
              if (boss.hp <= 0) { try { this.killBoss(boss); } catch (_) {} }
            }
          } catch (_) {}
        } catch (_) {}
        if (rp.r >= rp.maxR) { try { rp.g.destroy(); } catch (_) {} return false; }
        return true;
      });
    }
    } catch (_) {}

    // Boss modern movement/attacks
    if (this.boss && this.boss.active) {
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
                  if (time >= (this.player.iframesUntil || 0)) { this.gs.hp -= (this.boss.dashDamage || 20); this.player.iframesUntil = time + 600; }
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
      if (!this.rail.charging) { if (!this.lastShot || (now - this.lastShot) > weapon.fireRateMs) { this.rail.charging = true; this.rail.startedAt = now; } }
    } else {
      if (this.rail.charging) { const t = Math.min(1, (now - this.rail.startedAt) / maxMs); this.fireRailgun(baseAngle, weapon, t); this.rail.charging = false; this.endRailAim(); }
      return;
    }
    if (this.rail.charging) {
      const t = Math.min(1, (now - this.rail.startedAt) / maxMs); this.drawRailAim(baseAngle, weapon, t);
      if (t >= 1 && !coreHold) { this.fireRailgun(baseAngle, weapon, t); this.rail.charging = false; this.endRailAim(); }
    }
  }
  drawRailAim(angle, weapon, t) { try { if (!this.rail?.aimG) this.rail.aimG = this.add.graphics(); const g = this.rail.aimG; g.clear(); g.setDepth(9000); const spread0 = Phaser.Math.DegToRad(Math.max(0, weapon.spreadDeg || 0)); const spread = spread0 * (1 - t); const len = 340; g.lineStyle(1, 0xffffff, 0.9); const a1 = angle - spread / 2; const a2 = angle + spread / 2; const x = this.player.x; const y = this.player.y; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a1) * len, y + Math.sin(a1) * len); g.strokePath(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len); g.strokePath(); } catch (_) {} }
  endRailAim() { try { this.rail?.aimG?.clear(); this.rail?.aimG?.destroy(); } catch (_) {} if (this.rail) this.rail.aimG = null; }
  fireRailgun(baseAngle, weapon, t) {
    const wid = this.gs.activeWeapon; const cap = this.getActiveMagCapacity(); this.ensureAmmoFor(wid, cap); const ammo = this.ammoByWeapon[wid] ?? 0; if (ammo <= 0 || this.reload.active) return;
    const dmg = Math.floor(weapon.damage * (1 + 2 * t)); const speed = Math.floor(weapon.bulletSpeed * (1 + 2 * t)); const spreadRad = Phaser.Math.DegToRad(Math.max(0, (weapon.spreadDeg || 0))) * (1 - t); const off = (spreadRad > 0) ? Phaser.Math.FloatBetween(-spreadRad / 2, spreadRad / 2) : 0; const angle = baseAngle + off; const vx = Math.cos(angle) * speed; const vy = Math.sin(angle) * speed;
    const b = this.bullets.get(this.player.x, this.player.y, 'bullet'); if (!b) return; b.setActive(true).setVisible(true); b.setCircle(2).setOffset(-2, -2); b.setVelocity(vx, vy); b.damage = dmg; b.setTint(0x66aaff); b._core = 'pierce'; b._pierceLeft = 999; const trail = this.add.graphics(); b._g = trail; trail.setDepth(8000); b._px = b.x; b._py = b.y; b.update = () => { try { trail.clear(); trail.lineStyle(2, 0xaaddff, 0.9); const tx = b.x - (vx * 0.02); const ty = b.y - (vy * 0.02); trail.beginPath(); trail.moveTo(b.x, b.y); trail.lineTo(tx, ty); trail.strokePath(); } catch (_) {} try { const line = new Phaser.Geom.Line(b._px ?? b.x, b._py ?? b.y, b.x, b.y); const boss = this.boss; if (boss && boss.active) { const rect = boss.getBounds(); if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) { if (typeof boss.hp !== 'number') boss.hp = boss.maxHp || 300; boss.hp -= (b.damage || 12); try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {} if (boss.hp <= 0) this.killBoss(boss); } } } catch (_) {} const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} } b._px = b.x; b._py = b.y; }; b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
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
            this.gs.hp -= (this.boss.damage || 20);
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
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      // Use asset sprite for BIT unit and fit to moderate height
      const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
      try { g.setDepth(9000); } catch (_) {}
      const bit = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g, target: null, lastShotAt: 0, holdUntil: 0, moveUntil: 0, despawnAt: this.time.now + 7000, spawnScatterUntil: this.time.now + Phaser.Math.Between(260, 420) };
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
      const cap = Math.max(1, Math.floor(w.magSize || 1));
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
}






