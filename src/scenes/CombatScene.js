import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { generateRoom, generateBarricades } from '../systems/ProceduralGen.js';
import { createEnemy, createShooterEnemy, createRunnerEnemy, createSniperEnemy, createMachineGunnerEnemy, createRocketeerEnemy, createBoss } from '../systems/EnemyFactory.js';
import { weaponDefs } from '../core/Weapons.js';
import { impactBurst, bitSpawnRing } from '../systems/Effects.js';
import { getEffectiveWeapon, getPlayerEffects } from '../core/Loadout.js';
import { buildNavGrid, worldToGrid, findPath } from '../systems/Pathfinding.js';
import { preloadWeaponAssets, createPlayerWeaponSprite, syncWeaponTexture, updateWeaponSprite, createFittedImage } from '../systems/WeaponVisuals.js';
import { drawPanel } from '../ui/Panels.js';
import { makeTextButton } from '../ui/Buttons.js';

const DISABLE_WALLS = true; // Temporary: remove concrete walls

export default class CombatScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Combat); }
  preload() {
    // Ensure weapon images are loaded even if entering this scene directly
    try { preloadWeaponAssets(this); } catch (_) {}
  }
  
  openTerminalPanel() {
    if (this.panel) return;
    const { width } = this.scale;
    const panelW = 360; const panelH = 300;
    this.panel = drawPanel(this, width / 2 - panelW / 2, 60, panelW, panelH);
    this.panel._type = 'terminal';
    const title = this.add.text(width / 2, 80, 'Terminal - Spawn', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const y0 = 105; const line = 26; const cx = width / 2;
    const addBtn = (ix, label, fn) => makeTextButton(this, cx, y0 + ix * line, label, fn);
    const sp = (fn) => {
      const px = this.player.x + Phaser.Math.Between(-40, 40);
      const py = this.player.y + Phaser.Math.Between(-40, 40);
      return fn(this, px, py);
    };
    const b1 = addBtn(0, 'Spawn Melee', () => { this.enemies.add(sp(createEnemy)); });
    const b2 = addBtn(1, 'Spawn Runner', () => { this.enemies.add(sp(createRunnerEnemy)); });
    const b3 = addBtn(2, 'Spawn Shooter', () => { this.enemies.add(sp(createShooterEnemy)); });
    const b4 = addBtn(3, 'Spawn MachineGunner', () => { this.enemies.add(sp(createMachineGunnerEnemy)); });
    const b5 = addBtn(4, 'Spawn Rocketeer', () => { this.enemies.add(sp(createRocketeerEnemy)); });
    const b6 = addBtn(5, 'Spawn Sniper', () => { this.enemies.add(sp(createSniperEnemy)); });
    const b7 = addBtn(6, 'Spawn Boss', () => { this.enemies.add(sp((sc, x, y) => { const e = createBoss(sc, x, y, 600, 20, 50); e.isEnemy = true; return e; })); });
    const b8 = addBtn(8, 'Clear Enemies', () => {
      try { this.enemies.getChildren().forEach((e) => { if (e && e.active && !e.isDummy) e.destroy(); }); } catch (_) {}
    });
    const close = makeTextButton(this, cx, y0 + 10 * line, 'Close', () => this.closePanel([title, b1, b2, b3, b4, b5, b6, b7, b8, close]));
    this.panel._extra = [title, b1, b2, b3, b4, b5, b6, b7, b8, close];
  }

  closePanel(extra = []) {
    const extras = [
      ...(Array.isArray(extra) ? extra : []),
      ...(this.panel && Array.isArray(this.panel._extra) ? this.panel._extra : []),
    ];
    if (this.panel) { try { this.panel.destroy(); } catch (_) {} this.panel = null; }
    extras.forEach((o) => { try { o?.destroy?.(); } catch (_) {} });
  }

  create() {
    const { width, height } = this.scale;
    // Ensure physics world bounds match the visible area so enemies can't leave the screen
    this.physics.world.setBounds(0, 0, width, height);
    try { this.physics.world.setBoundsCollision(true, true, true, true); } catch (_) {}
    // Ensure UI overlay is active during combat
    this.scene.launch(SceneKeys.UI);
    this.gs = this.registry.get('gameState');
    this.inputMgr = new InputManager(this);

    // Player
    this.player = this.physics.add.sprite(width / 2, height / 2, 'player_square').setCollideWorldBounds(true);
    this.player.setSize(12, 12);
    this.player.iframesUntil = 0;
    this.playerFacing = 0; // radians

    // Visualize currently equipped weapon in the player's hands
    try { createPlayerWeaponSprite(this); } catch (_) {}

    // Dash state
    this.dash = { active: false, until: 0, cooldownUntil: 0, vx: 0, vy: 0, charges: 0, regen: [] };
    this.dash.charges = this.gs.dashMaxCharges;
    this.registry.set('dashCharges', this.dash.charges);
    this.registry.set('dashRegenProgress', 1);

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

    // Keep weapon sprite updated every frame without touching existing update()
    try {
      this.events.on('update', () => {
        // Update position/rotation
        updateWeaponSprite(this);
        // Always try to sync texture in case it finished loading after create
        if (this.gs) syncWeaponTexture(this, this.gs.activeWeapon);
        this._lastActiveWeapon = this.gs?.activeWeapon;
      });
    } catch (_) {}
		// Update Repulsion Pulse effects
		if (this._repulses && this._repulses.length) {
		  const dt = (this.game?.loop?.delta || 16.7) / 1000;
		  this._repulses = this._repulses.filter((rp) => {
			 rp.r += rp.speed * dt;
			 try { rp.g.clear(); rp.g.lineStyle(3, 0xffaa33, 0.95).strokeCircle(0, 0, rp.r); } catch (_) {}
			 const band = rp.band;
			 const r2min = (rp.r - band) * (rp.r - band);
			 const r2max = (rp.r + band) * (rp.r + band);
			 try {
			   const arrB = this.enemyBullets?.getChildren?.() || [];
			   for (let i = 0; i < arrB.length; i += 1) {
			     const b = arrB[i]; if (!b?.active) continue; const dx = b.x - rp.x; const dy = b.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) { try { b.destroy(); } catch (_) {} }
			   }
			 } catch (_) {}
			 try {
			   const arrE = this.enemies?.getChildren?.() || [];
			   for (let i = 0; i < arrE.length; i += 1) {
			     const e = arrE[i]; if (!e?.active || e.isDummy) continue; const dx = e.x - rp.x; const dy = e.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) { const d = Math.sqrt(d2) || 1; const nx = dx / d; const ny = dy / d; const power = 280; try { e.body?.setVelocity?.(nx * power, ny * power); } catch (_) { try { e.setVelocity(nx * power, ny * power); } catch (_) {} } }
			   }
			 } catch (_) {}
			 if (rp.r >= rp.maxR) { try { rp.g.destroy(); } catch (_) {} return false; }
			 return true;
		  });
		}

    // Bullets group (use Arcade.Image for proper pooling)
    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 256,
      runChildUpdate: true,
    });

    // Enemies (must be a physics group so overlaps work reliably)
    this.enemies = this.physics.add.group();
    const mods = this.gs.getDifficultyMods();
    const room = generateRoom(this.gs.rng, this.gs.currentDepth);
    this.room = room;
    if (!DISABLE_WALLS) {
      this.createArenaWalls(room);
    } else {
      // Expand arena to full screen when walls are disabled
      const { width, height } = this.scale;
      this.arenaRect = new Phaser.Geom.Rectangle(0, 0, width, height);
      this.walls = null;
    }
    // Barricades: indestructible (hard) and destructible (soft)
    this.barricadesHard = this.physics.add.staticGroup();
    this.barricadesSoft = this.physics.add.staticGroup();
    if (!this.gs?.shootingRange) {
      const barricades = generateBarricades(this.gs.rng, this.arenaRect);
      barricades.forEach((b) => {
        if (b.kind === 'hard') {
          const s = this.physics.add.staticImage(b.x, b.y, 'barricade_hard');
          s.setData('destructible', false);
          this.barricadesHard.add(s);
        } else {
          const s = this.physics.add.staticImage(b.x, b.y, 'barricade_soft');
          s.setData('destructible', true);
          // Base HP for destructible tiles
          s.setData('hp', 20);
          this.barricadesSoft.add(s);
        }
      });
    }
    // Helper: pick a spawn on screen edges/corners, far from player
    const pickEdgeSpawn = () => {
      const pad = 12;
      const { width: W, height: H } = this.scale;
      const px = this.player.x, py = this.player.y;
      const minDist = 180;
      for (let tries = 0; tries < 12; tries += 1) {
        const r = Math.random();
        let sx = pad, sy = pad;
        if (r < 0.125) { sx = pad; sy = pad; } // TL corner
        else if (r < 0.25) { sx = W - pad; sy = pad; } // TR
        else if (r < 0.375) { sx = pad; sy = H - pad; } // BL
        else if (r < 0.5) { sx = W - pad; sy = H - pad; } // BR
        else if (r < 0.625) { sx = Phaser.Math.Between(pad, W - pad); sy = pad; } // top
        else if (r < 0.75) { sx = Phaser.Math.Between(pad, W - pad); sy = H - pad; } // bottom
        else if (r < 0.875) { sx = pad; sy = Phaser.Math.Between(pad, H - pad); } // left
        else { sx = W - pad; sy = Phaser.Math.Between(pad, H - pad); } // right
        const dx = sx - px, dy = sy - py;
        if ((dx * dx + dy * dy) >= (minDist * minDist)) return { x: sx, y: sy };
      }
      // Fallback: farthest corner from player
      const sx = (px < this.scale.width / 2) ? (this.scale.width - pad) : pad;
      const sy = (py < this.scale.height / 2) ? (this.scale.height - pad) : pad;
      return { x: sx, y: sy };
    };

    if (!this.gs?.shootingRange) room.spawnPoints.forEach((_) => {
      const sp = pickEdgeSpawn();
      // Spawn composition (normal level): Sniper 10%, Shooter 20%, MachineGunner 10%, Rocketeer 10%, Runner 20%, Melee 30%
      const roll = this.gs.rng.next();
      let e;
      if (roll < 0.10) {
        e = createSniperEnemy(this, sp.x, sp.y, Math.floor(80 * mods.enemyHp), Math.floor(18 * mods.enemyDamage), 40);
      } else if (roll < 0.30) {
        e = createShooterEnemy(this, sp.x, sp.y, Math.floor(90 * mods.enemyHp), Math.floor(8 * mods.enemyDamage), 50, 900);
      } else if (roll < 0.40) {
        e = createMachineGunnerEnemy(this, sp.x, sp.y, Math.floor(140 * mods.enemyHp), Math.floor(7 * mods.enemyDamage), 35, 1100, 12, 24);
      } else if (roll < 0.50) {
        e = createRocketeerEnemy(this, sp.x, sp.y, Math.floor(80 * mods.enemyHp), Math.floor(12 * mods.enemyDamage), 40, 2000);
      } else if (roll < 0.70) {
        // Melee runner (fast)
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); // +50% melee damage
        e = createRunnerEnemy(this, sp.x, sp.y, Math.floor(60 * mods.enemyHp), meleeDmg, 120);
      } else {
        // Melee normal
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); // +50% melee damage
        e = createEnemy(this, sp.x, sp.y, Math.floor(100 * mods.enemyHp), meleeDmg, 60);
      }
      this.enemies.add(e);
    });

    // Shooting Range setup: terminal, dummy, and portal to hub
    if (this.gs?.shootingRange) {
      // Terminal (left side)
      this.terminalZone = this.add.zone(60, height / 2, 36, 36);
      this.physics.world.enable(this.terminalZone);
      this.terminalZone.body.setAllowGravity(false);
      this.terminalZone.body.setImmovable(true);
      this.terminalG = this.add.graphics();
      this.terminalG.fillStyle(0x33ccff, 1).fillRect(this.terminalZone.x - 12, this.terminalZone.y - 12, 24, 24);

      // Persistent dummy target in the center-right
      this._dummyDamage = 0;
      this.dummy = this.physics.add.sprite(width / 2 + 120, height / 2, 'enemy_square');
      this.dummy.setSize(12, 12).setOffset(0, 0).setCollideWorldBounds(true);
      this.dummy.setTint(0xffff00);
      this.dummy.isEnemy = true;
      this.dummy.isDummy = true;
      this.dummy.maxHp = 999999;
      this.dummy.hp = this.dummy.maxHp;
      this.enemies.add(this.dummy);
      this.dummyLabel = this.add.text(this.dummy.x, this.dummy.y - 16, 'DMG: 0', { fontFamily: 'monospace', fontSize: 12, color: '#ffff66' }).setOrigin(0.5);

      // Portal back to Hub (right side)
      const px = width - 40; const py = height / 2;
      this.portal = this.physics.add.staticImage(px, py, 'portal');
      this.portal.setSize(24, 24).setOffset(0, 0);

      // Helper text
      this.rangeText = this.add.text(width / 2, 28, 'Shooting Range: E near Terminal/Dummy/Portal', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
    }

    // Colliders
    if (this.walls) {
      this.physics.add.collider(this.player, this.walls);
      this.physics.add.collider(this.enemies, this.walls);
    }
    // Colliders with barricades (block movement and bullets)
    this.physics.add.collider(this.player, this.barricadesHard);
    this.physics.add.collider(this.player, this.barricadesSoft);
    this.physics.add.collider(this.enemies, this.barricadesHard);
    this.physics.add.collider(this.enemies, this.barricadesSoft);
    // Enemies can break destructible barricades by pushing into them
    this.physics.add.collider(this.enemies, this.barricadesSoft, (e, s) => this.onEnemyHitBarricade(e, s));
    // For rail bullets, skip physics separation so they don't get stuck
    this.physics.add.collider(
      this.bullets,
      this.barricadesHard,
      (b, s) => this.onBulletHitBarricade(b, s),
      (b, s) => !(b && b._rail),
      this,
    );
    this.physics.add.collider(
      this.bullets,
      this.barricadesSoft,
      (b, s) => this.onBulletHitBarricade(b, s),
      (b, s) => !(b && b._rail),
      this,
    );

    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => {
      if (!b.active || !e.active) return;
      // Only track per-target hits for piercing bullets to allow shotgun pellets to stack normally
      if (b._core === 'pierce') {
        if (!b._hitSet) b._hitSet = new Set();
        if (b._hitSet.has(e)) return;
        b._hitSet.add(e);
      }
      // Dummy target: accumulate damage and do not die
      if (e.isDummy) {
        const baseDmg = b.damage || 10;
        const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
        this._dummyDamage = (this._dummyDamage || 0) + primaryDmg;
      } else {
        if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
        // Apply damage (Explosive Core reduces primary to 80%; explosive projectiles keep 100%)
        {
          const baseDmg = b.damage || 10;
          const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
          e.hp -= primaryDmg;
        }
      }
      // Visual impact effect by core type (small unless blast)
      try {
        const core = b._core || null;
        if (core === 'blast') {
          const radius = b._blastRadius || 20;
          impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius });
        } else if (core === 'pierce') impactBurst(this, b.x, b.y, { color: 0x66aaff, size: 'small' });
        else impactBurst(this, b.x, b.y, { color: 0xffffff, size: 'small' });
      } catch (_) {}
      // Apply blast splash before removing the bullet
      if (b._core === 'blast') {
        const radius = b._blastRadius || 20;
        this.enemies.getChildren().forEach((other) => {
          if (!other.active) return;
          const isPrimary = (other === e);
          if (isPrimary && !b._rocket) return; // do not double-hit primary for core-only blasts
          const dx = other.x - b.x; const dy = other.y - b.y;
          if (dx * dx + dy * dy <= radius * radius) {
            const splashDmg = b._rocket ? (b._aoeDamage || b.damage || 10) : Math.ceil((b.damage || 10) * 0.5);
            if (other.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + splashDmg;
            } else {
              if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
              other.hp -= splashDmg;
              if (other.hp <= 0) { this.killEnemy(other); }
            }
          }
        });
        // Splash to barricades now 100%
        this.damageSoftBarricadesInRadius(b.x, b.y, radius, (b.damage || 10));
      }
      // Handle pierce core: allow one extra target without removing the bullet
      if (b._core === 'pierce' && (b._pierceLeft || 0) > 0) {
        b._pierceLeft -= 1;
      } else {
        // Defer removal to end of tick to avoid skipping other overlaps this frame
        try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
        try { b.setActive(false).setVisible(false); } catch (_) {}
        this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
      }
      // Check primary enemy death after damage
      if (e.hp <= 0) { this.killEnemy(e); }
    });

    this.physics.add.overlap(this.player, this.enemies, (p, e) => {
      if (this.time.now < this.player.iframesUntil) return;
      this.gs.hp -= e.damage;
      this.player.iframesUntil = this.time.now + 600;
      if (this.gs.hp <= 0) {
        // For framework: respawn at hub
        const eff = getPlayerEffects(this.gs);
        this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
        this.gs.nextScene = SceneKeys.Hub;
        SaveManager.saveToLocal(this.gs);
        this.scene.start(SceneKeys.Hub);
      }
    });

    // Enemy bullets (for shooters)
    this.enemyBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 64,
      runChildUpdate: true,
    });
    this.physics.add.overlap(this.player, this.enemyBullets, (p, b) => {
      const inIframes = this.time.now < this.player.iframesUntil;
      if (b?._rocket) {
        // Rocket: explode on contact, apply AoE to player
        const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70; const r2 = radius * radius;
        const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2 && !inIframes) {
          const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 12;
          this.gs.hp -= dmg;
          this.player.iframesUntil = this.time.now + 600;
          if (this.gs.hp <= 0) {
            const eff = getPlayerEffects(this.gs);
            this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
            this.gs.nextScene = SceneKeys.Hub;
            SaveManager.saveToLocal(this.gs);
            this.scene.start(SceneKeys.Hub);
          }
        }
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Chip nearby destructible barricades
        this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
        try { b.destroy(); } catch (_) {}
        return;
      }
      if (!inIframes) {
        const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8; // default shooter damage
        this.gs.hp -= dmg;
        this.player.iframesUntil = this.time.now + 600;
        if (this.gs.hp <= 0) {
          const eff = getPlayerEffects(this.gs);
          this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
      // Always destroy enemy bullet on contact, even during i-frames
      try { b.destroy(); } catch (_) {}
    });
    // Enemy bullets blocked by barricades as well
    this.physics.add.collider(this.enemyBullets, this.barricadesHard, (b, s) => this.onEnemyBulletHitBarricade(b, s));
    this.physics.add.collider(this.enemyBullets, this.barricadesSoft, (b, s) => this.onEnemyBulletHitBarricade(b, s));

    // Exit appears when all enemies dead
    this.exitActive = false;
    this.exitG = this.add.graphics();
    // Move in-game prompt down to avoid overlapping UI
    this.prompt = this.add.text(width / 2, 40, 'Clear enemies', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
    // Keybinds hint (bottom-right, small font)
    const binds = [
      'W/A/S/D: Move',
      'Space: Dash',
      'E: Interact',
      'LMB: Shoot',
      'F: Ability',
      'Q: Swap Weapon',
      'Tab: Loadout',
    ].join('\n');
    this.add.text(width - 10, height - 10, binds, { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' })
      .setOrigin(1, 1)
      .setAlpha(0.9);

    // Init nav state for enemy pathfinding
    this._nav = { grid: null, builtAt: 0 };
    // Ability system state (cooldown etc.)
    this._gadgets = [];
    this.ability = { onCooldownUntil: 0 };
    
  }

  // Centralized enemy death handler to keep removal tied to HP system
  killEnemy(e) {
    if (!e || !e.active) return;
    try {
      // Ensure HP reflects death for any downstream logic
      if (typeof e.hp === 'number' && e.hp > 0) e.hp = 0;
    } catch (_) {}
    // Reward gold per standard enemy kill
    try { this.gs.gold += 5; } catch (_) {}
    // Destroy the enemy sprite
    try { e.destroy(); } catch (_) {}
  }

  // Player bullet hits a barricade (hard or soft)
  onBulletHitBarricade(b, s) {
    if (!b || !b.active || !s) return;
    // Railgun bullets pierce and do not affect barricades
    if (b._rail) return;
    const isSoft = !!s.getData('destructible');
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
    // Apply damage to destructible tiles
    if (isSoft) {
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
      const hp1 = hp0 - dmg;
      // Small brown puff for soft hits
      try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
      if (hp1 <= 0) {
        try { s.destroy(); } catch (_) {}
      } else {
        s.setData('hp', hp1);
      }
    } else {
      // Grey puff on hard
      try { impactBurst(this, b.x, b.y, { color: 0xBBBBBB, size: 'small' }); } catch (_) {}
    }
    // Rockets: explode on barricade contact and splash enemies
    if (b._core === 'blast') {
      const radius = b._blastRadius || 20;
      try { impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large', radius }); } catch (_) {}
      const r2 = radius * radius; const ex = b.x; const ey = b.y;
      this.enemies.getChildren().forEach((other) => {
        if (!other?.active) return;
        const dx = other.x - ex; const dy = other.y - ey;
        if (dx * dx + dy * dy <= r2) {
          const splashDmg = b._rocket ? (b._aoeDamage || b.damage || 10) : Math.ceil((b.damage || 10) * 0.5);
          if (other.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + splashDmg;
          } else {
            if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
            other.hp -= splashDmg;
            if (other.hp <= 0) this.killEnemy(other);
          }
        }
      });
      // Also damage nearby destructible barricades
      this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 10));
    }
    // Always destroy player bullet on barricade collision
    try { b.destroy(); } catch (_) {}
  }

  // Enemy bullet hits a barricade
  onEnemyBulletHitBarricade(b, s) {
    if (!b || !s) return;
    const isSoft = !!s.getData('destructible');
    // Explosive rockets: detonate on barricade contact, chip soft barricades in radius
    if (b._rocket) {
      const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70;
      try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
      this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 12));
      try { b.destroy(); } catch (_) {}
      return;
    }
    const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8;
    if (isSoft) {
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
      const hp1 = hp0 - dmg;
      if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
      else s.setData('hp', hp1);
    }
    try { b.destroy(); } catch (_) {}
  }

  // Utility: damage all destructible barricades within radius
  damageSoftBarricadesInRadius(x, y, radius, dmg) {
    try {
      const r2 = radius * radius;
      const arr = this.barricadesSoft?.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const dx = s.x - x; const dy = s.y - y;
        if ((dx * dx + dy * dy) <= r2) {
      const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
          const hp1 = hp0 - dmg;
          if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
        }
      }
    } catch (_) {}
  }

  // Enemy body tries to push through a destructible barricade: damage over time
  onEnemyHitBarricade(e, s) {
    if (!s?.active) return;
    if (!s.getData('destructible')) return;
    const now = this.time.now;
    const last = s.getData('_lastMeleeHurtAt') || 0;
    if (now - last < 250) return; // throttle
    s.setData('_lastMeleeHurtAt', now);
    const dmg = Math.max(4, Math.floor((e?.damage || 8) * 0.6));
    const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
    const hp1 = hp0 - dmg;
    if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
    else s.setData('hp', hp1);
  }

  // Returns true if a straight line between two points hits any barricade
  isLineBlocked(x1, y1, x2, y2) {
    try {
      const line = new Phaser.Geom.Line(x1, y1, x2, y2);
      const checkGroup = (grp) => {
        if (!grp) return false;
        const arr = grp.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const s = arr[i]; if (!s?.active) continue;
          const rect = s.getBounds();
          if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) return true;
        }
        return false;
      };
      if (checkGroup(this.barricadesHard)) return true;
      if (checkGroup(this.barricadesSoft)) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  shoot() {
    const gs = this.gs;
    const weapon = getEffectiveWeapon(gs, gs.activeWeapon);
    const startX = this.player.x;
    const startY = this.player.y;
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, this.inputMgr.pointer.worldX, this.inputMgr.pointer.worldY);
    this.playerFacing = baseAngle;
    const pellets = weapon.pelletCount || 1;
    // Dynamic spread: increases while holding fire, recovers when released
    const heat = this._spreadHeat || 0;
    const maxExtra = (typeof weapon.maxSpreadDeg === 'number') ? weapon.maxSpreadDeg : 20;
    const extraDeg = weapon.singleFire ? 0 : (maxExtra * heat);
    const totalSpreadRad = Phaser.Math.DegToRad((weapon.spreadDeg || 0) + extraDeg);
    // Rocket projectile: explode on hit or when reaching click position
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
        // Use weapon.damage for direct-hit; carry AoE damage separately
        b.damage = weapon.damage;
        b._aoeDamage = (typeof weapon.aoeDamage === 'number') ? weapon.aoeDamage : weapon.damage;
        b._core = 'blast';
        b._blastRadius = weapon.blastRadius || 70;
        b._rocket = true;
        b._startX = startX; b._startY = startY;
        b._targetX = targetX; b._targetY = targetY;
        const sx = targetX - startX; const sy = targetY - startY;
        b._targetLen2 = sx * sx + sy * sy;
        b.update = () => {
          // Lifetime via camera view when walls are disabled
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
          // Check if reached or passed target point
          const dxs = (b.x - b._startX); const dys = (b.y - b._startY);
          const prog = dxs * (sx) + dys * (sy);
          const dx = b.x - b._targetX; const dy = b.y - b._targetY;
          const nearTarget = (dx * dx + dy * dy) <= 64; // within 8px
          const passed = prog >= b._targetLen2 - 1;
          if (nearTarget || passed) {
            // Explode at target/current pos
            const ex = b.x; const ey = b.y;
            try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
            const radius = b._blastRadius || 70; const r2 = radius * radius;
            this.enemies.getChildren().forEach((other) => {
              if (!other.active) return;
              const ddx = other.x - ex; const ddy = other.y - ey;
              if ((ddx * ddx + ddy * ddy) <= r2) {
                const aoe = (b._aoeDamage || b.damage || 10);
                if (other.isDummy) {
                  this._dummyDamage = (this._dummyDamage || 0) + aoe;
                } else {
                  if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
                  other.hp -= aoe;
                  if (other.hp <= 0) { this.killEnemy(other); }
                }
              }
            });
            // Also damage nearby destructible barricades
            this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
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
        // Single bullet: apply random deviation within the total spread cone
        const off = Phaser.Math.FloatBetween(-0.5, 0.5) * totalSpreadRad;
        angle += off;
      } else {
        // Multi-pellet: distribute across the total spread with slight jitter
        const t = (i / (pellets - 1)) - 0.5;
        angle += t * totalSpreadRad;
        if (totalSpreadRad > 0) angle += Phaser.Math.FloatBetween(-0.1, 0.1) * totalSpreadRad;
      }
      // Increase bullet speed for all non-rocket projectiles
      const effSpeed = (weapon.projectile === 'rocket') ? weapon.bulletSpeed : Math.floor((weapon.bulletSpeed || 0) * 1.25);
      const vx = Math.cos(angle) * effSpeed;
      const vy = Math.sin(angle) * effSpeed;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (!b) continue;
      b.setActive(true).setVisible(true);
      b.setCircle(2).setOffset(-2, -2);
      b.setVelocity(vx, vy);
      b.setTint(0xffffff); // player bullets are white
      b.damage = weapon.damage;
      b._core = weapon._core || null;
      if (b._core === 'pierce') { b._pierceLeft = 1; }
      b.update = () => {
        // Lifetime via camera view when walls are disabled
        const view = this.cameras?.main?.worldView;
        if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
      };
      b.on('destroy', () => b._g?.destroy());
    }
  }

  update() {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);
    // Dash regen progress for UI (0..1) for the next slot
    let prog = 0;
    const eff = getPlayerEffects(this.gs);
    if (this.dash.charges < this.gs.dashMaxCharges && this.dash.regen.length) {
      const now = this.time.now;
      const nextReady = Math.min(...this.dash.regen);
      const remaining = Math.max(0, nextReady - now);
      const denom = (eff.dashRegenMs || this.gs.dashRegenMs || 1000);
      prog = 1 - Math.min(1, remaining / denom);
    } else {
      prog = 1;
    }
    this.registry.set('dashRegenProgress', prog);

    // Dash handling
    const now = this.time.now;
    if (this.inputMgr.pressedDash && now >= this.dash.cooldownUntil && this.dash.charges > 0) {
      const dir = this.inputMgr.moveVec;
      const angle = (dir.x !== 0 || dir.y !== 0) ? Math.atan2(dir.y, dir.x) : this.playerFacing;
      const dashSpeed = 520;
      const dur = 180;
      this.dash.active = true;
      this.dash.until = now + dur;
      this.dash.cooldownUntil = now + 600;
      this.dash.vx = Math.cos(angle) * dashSpeed;
      this.dash.vy = Math.sin(angle) * dashSpeed;
      this.player.iframesUntil = now + dur; // i-frames while dashing
      // consume charge and queue regen
      this.dash.charges -= 1;
      this.dash.regen.push(now + (eff.dashRegenMs || this.gs.dashRegenMs));
    }

    if (this.dash.active && now < this.dash.until) {
      this.player.setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      const mv = this.inputMgr.moveVec;
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
      const now = this.time.now;
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

    // Shooting Range interactions
    if (this.gs?.shootingRange) {
      // Update dummy label position and text
      if (this.dummy && this.dummyLabel) {
        try {
          this.dummyLabel.setPosition(this.dummy.x, this.dummy.y - 16);
          this.dummyLabel.setText(`DMG: ${this._dummyDamage | 0}`);
        } catch (_) {}
      }
      // Context prompts
      const playerRect = this.player.getBounds();
      const nearTerminal = this.terminalZone && Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.terminalZone.getBounds());
      const nearPortal = this.portal && Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.portal.getBounds());
      const nearDummy = this.dummy && Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.dummy.getBounds());
      if (nearTerminal) this.prompt.setText('E: Open Terminal');
      else if (nearDummy) this.prompt.setText('E: Reset Dummy Damage');
      else if (nearPortal) this.prompt.setText('E: Return to Hub');
      else this.prompt.setText('Shooting Range');

      if (this.inputMgr.pressedInteract) {
        if (nearTerminal) this.openTerminalPanel?.();
        if (nearDummy) { this._dummyDamage = 0; }
        if (nearPortal) {
          try { this.gs.shootingRange = false; } catch (_) {}
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
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
    // Update spread heat each frame based on whether player is holding fire
    const dt = (this.game?.loop?.delta || 16.7) / 1000;
    if (this._spreadHeat === undefined) this._spreadHeat = 0;
    const rampPerSec = 0.7; // time to max ~1.4s holding
    const coolPerSec = 1.2; // cool to 0 in ~0.8s
    if (this.inputMgr.isLMBDown && !weapon.singleFire && !isRail) {
      this._spreadHeat = Math.min(1, this._spreadHeat + rampPerSec * dt);
    } else {
      this._spreadHeat = Math.max(0, this._spreadHeat - coolPerSec * dt);
    }
    // Robust single-click detect: Phaser pointer.justDown or edge from previous frame
    const ptr = this.inputMgr.pointer;
    if (this._lmbWasDown === undefined) this._lmbWasDown = false;
    const edgeDown = (!this._lmbWasDown) && !!ptr.isDown && ((ptr.buttons & 1) === 1);
    const wantsClick = !!ptr.justDown || edgeDown;
    if (isRail) {
      this.handleRailgunCharge(this.time.now, weapon, ptr);
    }
    const wantsShot = (!isRail) && (weapon.singleFire ? wantsClick : this.inputMgr.isLMBDown);
    if (wantsShot && (!this.lastShot || this.time.now - this.lastShot > weapon.fireRateMs)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      const ammo = this.ammoByWeapon[wid] ?? 0;
      if (ammo <= 0 || this.reload.active) {
        // Start auto-reload when empty (or continue if already reloading)
        if (!this.reload.active) {
          this.reload.active = true;
          this.reload.duration = this.getActiveReloadMs();
          this.reload.until = this.time.now + this.reload.duration;
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', 0);
        }
      } else {
        this.shoot();
        this.lastShot = this.time.now;
        this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
      }
    }
    this._lmbWasDown = !!ptr.isDown;

    // Swap weapons with Q
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.q)) {
      // Prefer swapping between equipped weapon slots
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
      // Cancel any in-progress reload on weapon swap
      this.reload.active = false;
      this.reload.duration = 0;
      this.registry.set('reloadActive', false);
      // Cancel rail charging/aim if any
      try { if (this.rail?.charging) this.rail.charging = false; } catch (_) {}
      this.endRailAim?.();
      }
    }

    // Manual reload (R)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.r)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      if (!this.reload.active && (this.ammoByWeapon[wid] ?? 0) < cap) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = this.time.now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    }

    // Ability activation (F)
    if (this.inputMgr.pressedAbility) {
      const nowT = this.time.now;
      if (nowT >= (this.ability.onCooldownUntil || 0)) {
        const abilityId = this.gs?.abilityId || 'ads';
        if (abilityId === 'ads') {
          this.deployADS();
          // Cooldown 10s
          this.ability.onCooldownUntil = nowT + 10000;
        } else if (abilityId === 'bits') {
          this.deployBITs();
          this.ability.onCooldownUntil = nowT + 10000;
        } else if (abilityId === 'repulse') {
          this.deployRepulsionPulse();
          this.ability.onCooldownUntil = nowT + 3000;
        }
      }
    }

    // Update active gadgets (ADS)
    if (this._gadgets && this._gadgets.length) {
      const nowT = this.time.now;
      this._gadgets = this._gadgets.filter((g) => {
        if (nowT >= (g.until || 0)) { try { g.g?.destroy(); } catch (_) {} return false; }
        // Zap nearest enemy projectile within radius, at most 5/s
        if (nowT >= (g.nextZapAt || 0)) {
          const radius = g.radius || 120; const r2 = radius * radius;
          let best = null; let bestD2 = Infinity;
          const arr = this.enemyBullets?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const b = arr[i]; if (!b?.active) continue;
            const dx = b.x - g.x; const dy = b.y - g.y; const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD2) { best = b; bestD2 = d2; }
          }
          if (best) {
            // Draw instant blue laser then destroy the projectile
            try {
              const lg = this.add.graphics();
              lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              lg.beginPath(); lg.moveTo(g.x, g.y - 4); lg.lineTo(best.x, best.y); lg.strokePath();
              lg.setAlpha(1);
              try {
                this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
              } catch (_) {
                this.time.delayedCall(320, () => { try { lg.destroy(); } catch (__ ) {} });
              }
              // Tiny blue particle at impact point
              try { impactBurst(this, best.x, best.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            } catch (_) {}
            try { best.destroy(); } catch (_) {}
            g.nextZapAt = nowT + 100; // 10 per second
          }
        }
        return true;
      });
    }

    // Ability cooldown progress for UI
    try {
      const nowT2 = this.time.now;
      const until = this.ability?.onCooldownUntil || 0;
      const active = nowT2 < until;
      const denom = 10000;
      const remaining = Math.max(0, until - nowT2);
      const prog = active ? (1 - Math.min(1, remaining / denom)) : 1;
      this.registry.set('abilityCooldownActive', active);
      this.registry.set('abilityCooldownProgress', prog);
    } catch (_) {}

    // Update BIT units
    if (!this._bits) this._bits = [];
    if (this._bits.length) {
      const dt = (this.game?.loop?.delta || 16.7) / 1000;
      const now = this.time.now;
      const enemiesArr = this.enemies?.getChildren?.() || [];
      this._bits = this._bits.filter((bit) => {
        // Expire: return to player then disappear
        if (now >= (bit.despawnAt || 0)) {
          // Return-to-player phase: despawn immediately on contact
          let dx = this.player.x - bit.x; let dy = this.player.y - bit.y;
          let len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} return false; }
          const sp = 420;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;           try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}          try { const ang = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx) + Math.PI);  } catch (_) {}          try { bit.g.setRotation(Math.atan2(bit.vy, bit.vx) + Math.PI); } catch (_) {}
          dx = this.player.x - bit.x; dy = this.player.y - bit.y; len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} return false; }
          return true;
        }
        // Spawn scatter animation: keep initial outward motion briefly before any idle/lock logic
        if (bit.spawnScatterUntil && now < bit.spawnScatterUntil) {
          bit.x += (bit.vx || 0) * dt; bit.y += (bit.vy || 0) * dt;           try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}          try { const ang = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx) + Math.PI);  } catch (_) {}          try { bit.g.setRotation(Math.atan2((bit.vy || 0), (bit.vx || 0)) + Math.PI); } catch (_) {}
          return true;
        }
        // Acquire or validate target (short lock range)
        const lockR = 180; const lockR2 = lockR * lockR;
        if (!bit.target || !bit.target.active) {
          // nearest enemy within lock range only
          let best = null; let bestD2 = Infinity;
          for (let i = 0; i < enemiesArr.length; i += 1) {
            const e = enemiesArr[i]; if (!e?.active) continue;
            const dx = e.x - bit.x; const dy = e.y - bit.y; const d2 = dx * dx + dy * dy;
            if (d2 <= lockR2 && d2 < bestD2) { best = e; bestD2 = d2; }
          }
          bit.target = best;
        } else {
          // Drop target if it moved out of lock range
          const dx = bit.target.x - bit.x; const dy = bit.target.y - bit.y; const d2 = dx * dx + dy * dy;
          if (d2 > lockR2) bit.target = null;
        }
        const trg = bit.target;
        if (!trg) {
          // Idle: hover closely around the player in a small orbit until a target enters lock range
          if (bit._idleAngle === undefined) bit._idleAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
          if (bit._idleRadius === undefined) bit._idleRadius = Phaser.Math.Between(20, 36);
          if (bit._idleSpeed === undefined) bit._idleSpeed = Phaser.Math.FloatBetween(2.0, 3.2); // rad/s
          bit._idleAngle += bit._idleSpeed * dt;
          const px = this.player.x; const py = this.player.y;
          const tx = px + Math.cos(bit._idleAngle) * bit._idleRadius;
          const ty = py + Math.sin(bit._idleAngle) * bit._idleRadius;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1;
          const sp = 260;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
                    try { const ang = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx) + Math.PI);  } catch (_) {}          try { bit.g.setRotation(Math.atan2(bit.vy, bit.vx) + Math.PI); } catch (_) {}
          return true;
        }
        // Firing hold
        if (now < (bit.holdUntil || 0)) {
          // stay still; face target if present
          if (trg) { try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {} }
          return true;
        }
        // Decide next action
        if (!bit.moveUntil || now >= bit.moveUntil) {
          // Either fire (if in range) or choose a new dash around target
          const fireR = 180; const fireR2 = fireR * fireR;
          const ddx = trg.x - bit.x; const ddy = trg.y - bit.y; const dd2 = ddx * ddx + ddy * ddy;
          if ((!bit.lastShotAt || (now - bit.lastShotAt > 500)) && dd2 <= fireR2) {
            // Fire: draw laser and damage
            try {
              const lg = this.add.graphics(); lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              lg.beginPath(); lg.moveTo(bit.x, bit.y); lg.lineTo(trg.x, trg.y); lg.strokePath();
              this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
            } catch (_) {}
            try { impactBurst(this, trg.x, trg.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {}
            // Apply damage
            if (typeof trg.hp !== 'number') trg.hp = trg.maxHp || 20;
            trg.hp -= 7; if (trg.hp <= 0) { try { this.killEnemy(trg); } catch (_) {} }
            // Shooting Range: accumulate dummy damage when present
            try { if (trg?.isDummy) this._dummyDamage = (this._dummyDamage || 0) + 7; } catch (_) {}
            bit.lastShotAt = now;
            bit.holdUntil = now + 400; // hold for 0.4s
            bit.moveUntil = now + 400; // next plan after hold
            return true;
          }
          // Plan a quick straight movement around target
          const angTo = Math.atan2(bit.y - trg.y, bit.x - trg.x);
          const off = Phaser.Math.FloatBetween(-Math.PI / 2, Math.PI / 2);
          const r = Phaser.Math.Between(40, 120);
          const tx = trg.x + Math.cos(angTo + off) * r;
          const ty = trg.y + Math.sin(angTo + off) * r;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1;
          const sp = 380; bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.moveUntil = now + Phaser.Math.Between(240, 420);
        } else {
          // Move step
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}           try { const ang = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx) + Math.PI);  } catch (_) {}          try { bit.g.setRotation(Math.atan2(bit.vy, bit.vx) + Math.PI); } catch (_) {}
        }
        return true;
      });
    }

    // Rebuild nav grid periodically so enemies can re-route around obstacles
    if (!this._nav) this._nav = { grid: null, builtAt: 0 };
    if (!this._nav.grid || (this.time.now - this._nav.builtAt > 1200)) {
      try {
        this._nav.grid = buildNavGrid(this, this.arenaRect, 16);
        this._nav.builtAt = this.time.now;
      } catch (_) {}
    }

    // Update enemies: melee chase; shooters chase gently and fire at intervals; snipers aim then fire
    this.enemies.getChildren().forEach((e) => {
      if (!e.active) return;
      if (e.isDummy) { try { e.body.setVelocity(0, 0); } catch (_) {} return; }
      const now = this.time.now;
      const dt = (this.game?.loop?.delta || 16.7) / 1000; // seconds
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;

      // Movement logic by type
      // Snipers: move like shooters when not aiming, freeze only during aim
      if (!e.isSniper || (e.isSniper && !e.aiming)) {
        let vx = 0, vy = 0;
        let speed = e.speed || 60;
        // Global speed boost for all enemies
        speed *= 1.5;
        // Pathfinding when LOS to player is blocked
        let usingPath = false;
        const losBlocked = this.isLineBlocked(e.x, e.y, this.player.x, this.player.y);
        if (losBlocked && this._nav?.grid) {
          const needRepath = (!e._path || (e._pathIdx == null) || (e._pathIdx >= e._path.length) || (now - (e._lastPathAt || 0) > 800));
          if (needRepath) {
            try {
              const [sgx, sgy] = worldToGrid(this._nav.grid, e.x, e.y);
              const [ggx, ggy] = worldToGrid(this._nav.grid, this.player.x, this.player.y);
              e._path = findPath(this._nav.grid, sgx, sgy, ggx, ggy) || null;
              e._pathIdx = 0; e._lastPathAt = now;
            } catch (_) {}
          }
          const wp = (e._path && e._path[e._pathIdx || 0]) || null;
          if (wp) {
            const tx = wp[0], ty = wp[1];
            const pdx = tx - e.x; const pdy = ty - e.y;
            const pd = Math.hypot(pdx, pdy) || 1;
            if (pd < 10) { e._pathIdx = (e._pathIdx || 0) + 1; }
            else { const px = pdx / pd; const py = pdy / pd; vx = px * speed; vy = py * speed; usingPath = true; }
          }
        }
        // Treat snipers like shooters for movement behavior
        if (!usingPath && (e.isShooter || e.isSniper)) {
          // Random wander; approach if far, back off if too close
          if (!e._wanderChangeAt || now >= e._wanderChangeAt) {
            // Longer hold times to avoid twitching
            e._wanderChangeAt = now + Phaser.Math.Between(1400, 2600);
            const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
            const mag = Phaser.Math.FloatBetween(0.6, 1.0);
            e._wanderVX = Math.cos(ang) * speed * mag;
            e._wanderVY = Math.sin(ang) * speed * mag;
          }
          // Desired velocity combines wander and a gentle bias toward/away from player
          vx = (e._wanderVX || 0);
          vy = (e._wanderVY || 0);
          // Bias towards player direction even when not far
          vx += nx * speed * 0.2; vy += ny * speed * 0.2;
          const far = dist > 280, tooClose = dist < 140;
          if (far) { vx += nx * speed * 0.75; vy += ny * speed * 0.75; }
          else if (tooClose) { vx -= nx * speed * 0.65; vy -= ny * speed * 0.65; }
        } else if (!usingPath) {
          // Melee: zig-zag sometimes; otherwise straight chase, with occasional wander/flee
          if (!e._zigPhase) e._zigPhase = Phaser.Math.FloatBetween(0, Math.PI * 2);
          if (!e._mode || now >= (e._modeUntil || 0)) {
            const r = Math.random();
            if (r < 0.55) e._mode = 'straight';
            else if (r < 0.75) e._mode = 'zig';
            else if (r < 0.90) e._mode = 'wander';
            else e._mode = 'flee';
            e._modeUntil = now + Phaser.Math.Between(900, 2200);
            if (e._mode === 'wander') {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              e._wanderVX = Math.cos(a) * speed * 0.6;
              e._wanderVY = Math.sin(a) * speed * 0.6;
            }
            if (e._mode === 'zig') {
              // Choose a smooth frequency and strafe amplitude for this zig session
              e._zigFreq = Phaser.Math.FloatBetween(1.0, 2.0); // Hz
              e._zigAmp = Phaser.Math.FloatBetween(0.5, 0.75); // strafe weight (slightly reduced)
            }
          }
          if (e._mode === 'zig') {
            // Perpendicular wiggle to dodge
            const px = -ny, py = nx;
            if (!e._lastZigT) e._lastZigT = now;
            const dtMs = Math.max(1, now - e._lastZigT);
            // Smooth continuous phase advance based on frequency
            const freq = e._zigFreq || 1.5; // Hz
            e._zigPhase += (Math.PI * 2) * freq * (dtMs / 1000);
            e._lastZigT = now;
            const w = Math.sin(e._zigPhase);
            const zigSpeed = speed * 1.5; // 150% of normal during zig-zag
            const amp = e._zigAmp || 0.75;
            vx = nx * zigSpeed * (0.85 + 0.10 * Math.sin(e._zigPhase * 0.5)) + px * zigSpeed * amp * w;
            vy = ny * zigSpeed * (0.85 + 0.10 * Math.sin(e._zigPhase * 0.5)) + py * zigSpeed * amp * w;
          } else if (e._mode === 'wander') {
            vx = (e._wanderVX || 0) * 0.9; vy = (e._wanderVY || 0) * 0.9;
          } else if (e._mode === 'straight') {
            vx = nx * speed; vy = ny * speed;
          } else { // flee
            vx = -nx * speed * 0.9; vy = -ny * speed * 0.9;
          }
        }
        // Smooth velocity to avoid twitching (inertia/acceleration)
        const smooth = 0.12; // approaching target ~12% per frame
        if (e._svx === undefined) e._svx = 0;
        if (e._svy === undefined) e._svy = 0;
        e._svx += (vx - e._svx) * smooth;
        e._svy += (vy - e._svy) * smooth;
        e.body.setVelocity(e._svx, e._svy);
        // Stuck detection triggers repath
        if (e._lastPosT === undefined) { e._lastPosT = now; e._lx = e.x; e._ly = e.y; }
        if (now - e._lastPosT > 400) {
          const md = Math.hypot((e.x - (e._lx || e.x)), (e.y - (e._ly || e.y)));
          e._lx = e.x; e._ly = e.y; e._lastPosT = now;
          if (md < 2 && this.isLineBlocked(e.x, e.y, this.player.x, this.player.y)) { e._path = null; e._pathIdx = 0; e._lastPathAt = 0; }
        }
      }
      // Clamp enemies to screen bounds as a failsafe
      try {
        const pad = (e.body?.halfWidth || 6);
        const w = this.scale.width, h = this.scale.height;
        e.x = Phaser.Math.Clamp(e.x, pad, w - pad);
        e.y = Phaser.Math.Clamp(e.y, pad, h - pad);
      } catch (_) {}

      if (e.isShooter) {
        if (!e.lastShotAt) e.lastShotAt = 0;
        if (e.isMachineGunner) {
          const nowT = this.time.now;
          // Start a new burst if cooled down and not currently bursting
          if ((!e._burstLeft || e._burstLeft <= 0) && (nowT - e.lastShotAt > (e.fireRateMs || 1100))) {
            e._burstLeft = e.burstCount || 15;
            e._nextBurstShotAt = nowT;
            e._sprayPhase = 0;
          }
          // Fire next bullet in the burst if it's time
          if (e._burstLeft && e._burstLeft > 0 && nowT >= (e._nextBurstShotAt || 0)) {
            const base = Math.atan2(dy, dx);
            const spreadRad = Phaser.Math.DegToRad(e.spreadDeg || 14);
            // Slight walk within spread over the burst
            const t = ((e.burstCount || 15) - e._burstLeft) / Math.max(1, (e.burstCount || 15) - 1);
            let ang = base + (t - 0.5) * spreadRad * 0.9;
            ang += Phaser.Math.FloatBetween(-0.05, 0.05) * spreadRad;
            const speed = 250;
            const vx = Math.cos(ang) * speed;
            const vy = Math.sin(ang) * speed;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(2).setOffset(-2, -2);
              b.setVelocity(vx, vy);
              b.setTint(0xffcc00);
              b.damage = e.damage;
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); }
              };
            }
            e._burstLeft -= 1;
            if (e._burstLeft <= 0) {
              e.lastShotAt = nowT; // end of burst
            } else {
              e._nextBurstShotAt = nowT + (e.burstGapMs || 70);
            }
          }
        } else if (e.isRocketeer) {
          const nowT = this.time.now;
          if (nowT - e.lastShotAt > (e.fireRateMs || 2000)) {
            e.lastShotAt = nowT;
            const ang = Math.atan2(dy, dx);
            const speed = 300;
            const vx = Math.cos(ang) * speed;
            const vy = Math.sin(ang) * speed;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(6).setOffset(-6, -6);
              try { b.setScale(1.4); } catch (_) {}
              b.setVelocity(vx, vy);
              b.setTint(0xff8844);
              b.damage = e.damage;
              b._rocket = true;
              b._blastRadius = 70;
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); }
              };
            }
          }
        } else {
          const nowT = this.time.now;
          // Shooter: 2-round burst (one at a time)
          if ((!e._burstLeft || e._burstLeft <= 0) && (nowT - e.lastShotAt > (e.fireRateMs || 900))) {
            e._burstLeft = 2;
            e._nextBurstShotAt = nowT;
            e._burstGapMsS = e._burstGapMsS || 110; // per-shot gap within burst
          }
          if (e._burstLeft && e._burstLeft > 0 && nowT >= (e._nextBurstShotAt || 0)) {
            const ang = Math.atan2(dy, dx);
            const vx = Math.cos(ang) * 240;
            const vy = Math.sin(ang) * 240;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(2).setOffset(-2, -2);
              b.setVelocity(vx, vy);
              b.setTint(0xffff00); // enemy bullets are yellow
              b.damage = e.damage;
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); }
              };
            }
            e._burstLeft -= 1;
            if (e._burstLeft <= 0) {
              e.lastShotAt = nowT; // burst complete
            } else {
              e._nextBurstShotAt = nowT + (e._burstGapMsS || 110);
            }
          }
        }
      }

      // Sniper behavior
      if (e.isSniper) {
        const now = this.time.now;
        // If aiming, freeze movement and draw/update red aim line
        if (e.aiming) {
          e.body.setVelocity(0, 0);
          if (!e._aimG) e._aimG = this.add.graphics();
          try {
            e._aimG.clear();
            e._aimG.lineStyle(1, 0xff2222, 1); // thinner sniper aim line
            e._aimG.beginPath();
            e._aimG.moveTo(e.x, e.y);
            e._aimG.lineTo(this.player.x, this.player.y);
            e._aimG.strokePath();
          } catch (_) {}
          if (now - (e.aimStartedAt || 0) >= (e.aimDurationMs || 1000)) {
            // Fire a slower, high-damage shot
            const angle = Math.atan2(dy, dx);
            const snipeSpeed = 1200;
            const vx = Math.cos(angle) * snipeSpeed;
            const vy = Math.sin(angle) * snipeSpeed;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              // Slightly larger hitbox to avoid tunneling at extreme speed
              b.setCircle(3).setOffset(-3, -3);
              b.setVelocity(vx, vy);
              b.damage = Math.max(35, Math.floor((e.damage || 20) * 2.0)); // higher sniper damage
              b.setTint(0xff3333);
              b._sniper = true;
              b._px = b.x; b._py = b.y;
              b.update = () => {
                // Manual ray-style collision to prevent tunneling at extreme speed
                try {
                  const line = new Phaser.Geom.Line(b._px || b.x, b._py || b.y, b.x, b.y);
                  const playerRect = this.player.getBounds();
                  if (Phaser.Geom.Intersects.LineToRectangle(line, playerRect)) {
                    const inIframes = this.time.now < this.player.iframesUntil;
                    if (!inIframes) {
                      const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8;
                      this.gs.hp -= dmg;
                      this.player.iframesUntil = this.time.now + 600;
                      if (this.gs.hp <= 0) {
                        const eff = getPlayerEffects(this.gs);
                        this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                        this.gs.nextScene = SceneKeys.Hub;
                        SaveManager.saveToLocal(this.gs);
                        this.scene.start(SceneKeys.Hub);
                      }
                    }
                    try { b.destroy(); } catch (_) {}
                    return;
                  }
                } catch (_) {}
                // Lifetime via camera view when walls are disabled
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
                // Update previous position for next frame
                b._px = b.x; b._py = b.y;
              };
            }
            // End aiming and start cooldown; remove laser
            e.aiming = false;
            e.lastShotAt = now;
            try { e._aimG?.clear(); e._aimG?.destroy(); e._aimG = null; } catch (_) {}
          }
        } else {
          // Not aiming: use normal movement like other shooters; only manage aim trigger
          // Start aiming if cooldown passed
          if (!e.lastShotAt) e.lastShotAt = 0;
          if (now - e.lastShotAt >= (e.cooldownMs || 2000)) {
            e.aiming = true;
            e.aimStartedAt = now;
          }
        }
      }
    });

    // Check clear (count only enemies that are active AND have HP left)
    const alive = this.enemies.getChildren().filter((e) => e.active && (typeof e.hp === 'number' ? e.hp > 0 : true)).length;
    if (alive === 0 && !this.exitActive) {
      this.exitActive = true;
      this.prompt.setText('Room clear! E to exit');
      this.exitRect = new Phaser.Geom.Rectangle(this.scale.width - 50, this.scale.height / 2 - 30, 40, 60);
      this.exitG.clear();
      this.exitG.fillStyle(0x22ff88, 1).fillRect(this.exitRect.x, this.exitRect.y, this.exitRect.width, this.exitRect.height);
    }

    if (this.exitActive) {
      const playerRect = this.player.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.exitRect)) {
        if (this.inputMgr.pressedInteract) {
          this.gs.progressAfterCombat();
          SaveManager.saveToLocal(this.gs);
          const next = this.gs.nextScene === 'Boss' ? SceneKeys.Boss : SceneKeys.Combat;
          this.scene.start(next);
        }
      }
    }
  }

  createArenaWalls(room) {
    const { width, height } = this.scale;
    const tile = 16;
    const w = Math.min(room.width * tile, width - 80);
    const h = Math.min(room.height * tile, height - 80);
    const x = (width - w) / 2;
    const y = (height - h) / 2;
    this.arenaRect = new Phaser.Geom.Rectangle(x, y, w, h);

    // Visual wall tiles and physics
    this.walls = this.physics.add.staticGroup();
    const tilesX = Math.ceil(w / tile);
    const tilesY = Math.ceil(h / tile);
    // Top & Bottom rows
    for (let i = 0; i < tilesX; i += 1) {
      const wx = x + i * tile + tile / 2;
      const top = this.physics.add.staticImage(wx, y + tile / 2, 'wall_tile');
      const bot = this.physics.add.staticImage(wx, y + h - tile / 2, 'wall_tile');
      this.walls.add(top); this.walls.add(bot);
    }
    // Left & Right cols
    for (let j = 1; j < tilesY - 1; j += 1) {
      const wy = y + j * tile + tile / 2;
      const left = this.physics.add.staticImage(x + tile / 2, wy, 'wall_tile');
      const right = this.physics.add.staticImage(x + w - tile / 2, wy, 'wall_tile');
      this.walls.add(left); this.walls.add(right);
    }
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

  deployADS() {
    const x = this.player.x; const y = this.player.y;
    // Use asset sprite for ADS and fit to small height
    const g = createFittedImage(this, x, y, 'ability_ads',  20);
    try { g.setDepth(9000); } catch (_) {}
    const obj = { x, y, g, radius: 120, nextZapAt: 0, until: this.time.now + 8000 };
    this._gadgets.push(obj);
  }

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

  // Repulsion Pulse: expanding ring that blocks enemy projectiles and pushes enemies
  deployRepulsionPulse() {
    if (!this._repulses) this._repulses = [];
    const x = this.player.x, y = this.player.y;
    const color = 0xffaa33;
    const g = this.add.graphics({ x, y });
    try { g.setDepth?.(9000); } catch (_) {}
    const rect = this.arenaRect || new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
    // Max distance to farthest corner
    const corners = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
    let maxD = 0; for (let i = 0; i < corners.length; i += 1) { const cx = corners[i].x; const cy = corners[i].y; const dx = cx - x; const dy = cy - y; const d = Math.hypot(dx, dy); if (d > maxD) maxD = d; }
    const obj = { x, y, r: 0, band: 8, speed: 600, maxR: maxD + 24, g, lastDrawnAt: 0 };
    this._repulses.push(obj);
  }

  // Railgun mechanics
  handleRailgunCharge(now, weapon, ptr) {
    const wid = this.gs.activeWeapon;
    const cap = this.getActiveMagCapacity();
    this.ensureAmmoFor(wid, cap);
    const ammo = this.ammoByWeapon[wid] ?? 0;
    // Cancel charge if swapping away handled elsewhere
    if (this.reload.active || ammo <= 0) {
      this.endRailAim();
      return;
    }
    const maxMs = 1500;
    if (!this.rail) this.rail = { charging: false, startedAt: 0, aimG: null };
    const coreHold = !!weapon.railHold;
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);

    if (ptr.isDown && ((ptr.buttons & 1) === 1)) {
      if (!this.rail.charging) {
        if (!this.lastShot || (now - this.lastShot) > weapon.fireRateMs) {
          this.rail.charging = true;
          this.rail.startedAt = now;
        }
      }
    } else {
      // Released: fire if charging
      if (this.rail.charging) {
        const t = Math.min(1, (now - this.rail.startedAt) / maxMs);
        this.fireRailgun(baseAngle, weapon, t);
        this.rail.charging = false;
        this.endRailAim();
      }
      return;
    }

    // While holding
    if (this.rail.charging) {
      const t = Math.min(1, (now - this.rail.startedAt) / maxMs);
      this.drawRailAim(baseAngle, weapon, t);
      if (t >= 1 && !coreHold) {
        // Auto-fire at max unless core allows holding
        this.fireRailgun(baseAngle, weapon, t);
        this.rail.charging = false;
        this.endRailAim();
      }
    }
  }

  drawRailAim(angle, weapon, t) {
    try {
      if (!this.rail?.aimG) this.rail.aimG = this.add.graphics();
      const g = this.rail.aimG; g.clear(); g.setDepth(9000);
      const spread0 = Phaser.Math.DegToRad(Math.max(0, weapon.spreadDeg || 0));
      const spread = spread0 * (1 - t);
      const len = 340; // longer aim guide for railgun
      g.lineStyle(1, 0xffffff, 0.9); // thinner lines
      const a1 = angle - spread / 2; const a2 = angle + spread / 2;
      const x = this.player.x; const y = this.player.y;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a1) * len, y + Math.sin(a1) * len); g.strokePath();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len); g.strokePath();
    } catch (_) {}
  }

  endRailAim() {
    try { this.rail?.aimG?.clear(); this.rail?.aimG?.destroy(); } catch (_) {}
    if (this.rail) this.rail.aimG = null;
  }

  fireRailgun(baseAngle, weapon, t) {
    const wid = this.gs.activeWeapon;
    const cap = this.getActiveMagCapacity();
    this.ensureAmmoFor(wid, cap);
    const ammo = this.ammoByWeapon[wid] ?? 0;
    if (ammo <= 0 || this.reload.active) return;
    const dmg = Math.floor(weapon.damage * (1 + 2 * t));
    const speed = Math.floor(weapon.bulletSpeed * (1 + 2 * t));
    const spreadRad = Phaser.Math.DegToRad(Math.max(0, (weapon.spreadDeg || 0))) * (1 - t);
    const off = (spreadRad > 0) ? Phaser.Math.FloatBetween(-spreadRad / 2, spreadRad / 2) : 0;
    const angle = baseAngle + off;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const b = this.bullets.get(this.player.x, this.player.y, 'bullet');
    if (!b) return;
    b.setActive(true).setVisible(true);
    b.setCircle(2).setOffset(-2, -2);
    b.setVelocity(vx, vy);
    b.damage = dmg;
    b.setTint(0x66aaff);
    b._core = 'pierce';
    b._pierceLeft = 999; // effectively unlimited pierce
    b._rail = true; // identify railgun bullets for special handling
    // Simple light-blue trail
    const trail = this.add.graphics();
    b._g = trail; trail.setDepth(8000);
    b._px = b.x; b._py = b.y;
    b.update = () => {
      try {
        // Draw trail
        trail.clear();
        trail.lineStyle(2, 0xaaddff, 0.9);
        const tx = b.x - (vx * 0.02); const ty = b.y - (vy * 0.02);
        trail.beginPath(); trail.moveTo(b.x, b.y); trail.lineTo(tx, ty); trail.strokePath();
      } catch (_) {}

      // Manual hit check to avoid tunneling at high speed
      try {
        const line = new Phaser.Geom.Line(b._px ?? b.x, b._py ?? b.y, b.x, b.y);
        if (!b._hitSet) b._hitSet = new Set();
        const arr = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const e = arr[i];
          if (!e || !e.active) continue;
          if (b._hitSet.has(e)) continue;
          const rect = e.getBounds();
          if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= (b.damage || 10);
            try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {}
            b._hitSet.add(e);
            if (e.hp <= 0) { try { this.killEnemy ? this.killEnemy(e) : e.destroy(); } catch (_) {} }
          }
        }
        // Railgun should pierce barricades and not damage them.
        // For non-rail bullets, use normal barricade handling; for rail, trigger only a pierce VFX once per barricade.
        if (!b._rail) {
          const hitBarricade = (grp) => {
            if (!grp) return false;
            const arrS = grp.getChildren?.() || [];
            for (let j = 0; j < arrS.length; j += 1) {
              const s = arrS[j]; if (!s?.active) continue;
              const r = s.getBounds();
              if (Phaser.Geom.Intersects.LineToRectangle(line, r)) {
                try { this.onBulletHitBarricade(b, s); } catch (_) { try { b.destroy(); } catch (__ ) {} }
                return true;
              }
            }
            return false;
          };
          if (hitBarricade(this.barricadesHard)) return;
          if (hitBarricade(this.barricadesSoft)) return;
        } else {
          // Rail: spawn a small spark the first time we pass through each barricade
          const pierceVfx = (grp) => {
            if (!grp) return;
            const arrS = grp.getChildren?.() || [];
            if (!b._piercedBarricades) b._piercedBarricades = new Set();
            for (let j = 0; j < arrS.length; j += 1) {
              const s = arrS[j]; if (!s?.active) continue;
              if (b._piercedBarricades.has(s)) continue;
              const r = s.getBounds();
              if (Phaser.Geom.Intersects.LineToRectangle(line, r)) {
                b._piercedBarricades.add(s);
                try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {}
              }
            }
          };
          pierceVfx(this.barricadesHard);
          pierceVfx(this.barricadesSoft);
        }
      } catch (_) {}

      // Offscreen cleanup
      const view = this.cameras?.main?.worldView;
      if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} }
      b._px = b.x; b._py = b.y;
    };
    b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
    // consume ammo and start cooldown
    this.ammoByWeapon[wid] = Math.max(0, (this.ammoByWeapon[wid] ?? cap) - 1);
    this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
    this.lastShot = this.time.now;
    if (this.ammoByWeapon[wid] <= 0) {
      // trigger reload
      if (!this.reload.active) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = this.time.now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    }
  }
}











