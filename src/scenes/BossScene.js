import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { createBoss } from '../systems/EnemyFactory.js';
import { HpBar } from '../ui/HpBar.js';
import { getWeaponById } from '../core/Weapons.js';
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

    // Boss
    const mods = this.gs.getDifficultyMods();
    const pistol = getWeaponById('pistol');
    const baseBossHp = Math.floor((pistol?.damage || 15) * 20);
    this.boss = createBoss(this, width / 2, 100, Math.floor(baseBossHp * (mods.enemyHp || 1)), Math.floor(20 * (mods.enemyDamage || 1)), 50);
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
      maxSize: 64,
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

    // Text + Boss HP bar at bottom
    // Move in-game prompt down to avoid overlapping UI
    this.prompt = this.add.text(width / 2, 40, 'Defeat the Boss', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    this.bossHpBar = new HpBar(this, 16, height - 24, width - 32, 12);
    this.exitRect = null;
    this.exitG = this.add.graphics();
  }

  win() {
    // Reward and spawn portal to hub
    if (this.gs) this.gs.gold += 50;
    if (this.prompt) this.prompt.setText('Boss defeated! Enter portal');
    const px = this.scale.width - 50 + 20; // center of previous exit area
    const py = this.scale.height / 2;
    this.exitG.clear();
    // Create a visible portal sprite and physics overlap
    this.portal = this.physics.add.staticImage(px, py, 'portal');
    this.portal.setSize(24, 24).setOffset(0, 0);
    this.physics.add.overlap(this.player, this.portal, () => {
      this.gs.progressAfterBoss();
      SaveManager.saveToLocal(this.gs);
      this.scene.start(SceneKeys.Hub);
    });
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
    const spread = Phaser.Math.DegToRad(weapon.spreadDeg || 0);
    for (let i = 0; i < pellets; i += 1) {
      const t = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5);
      const angle = baseAngle + t * spread;
      const vx = Math.cos(angle) * weapon.bulletSpeed;
      const vy = Math.sin(angle) * weapon.bulletSpeed;
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
    if (this.inputMgr.isLMBDown && (!this.lastShot || time - this.lastShot > weapon.fireRateMs)) {
      this.shoot();
      this.lastShot = time;
    }

    // Boss simple pattern: drift toward player with sine offset
    if (this.boss && this.boss.active) {
      const dx = this.player.x - this.boss.x;
      const dy = this.player.y - this.boss.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const wobble = Math.sin(time / 300) * 60;
      this.boss.body.setVelocity((nx * this.boss.speed) + wobble * -ny * 0.4, (ny * this.boss.speed) + wobble * nx * 0.4);

      if (TEMP_BOSS_BOUND_GUARD) {
        // Clamp inside screen bounds
        const { width, height } = this.scale;
        this.boss.x = Phaser.Math.Clamp(this.boss.x, 12, width - 12);
        this.boss.y = Phaser.Math.Clamp(this.boss.y, 12, height - 12);
        // Failsafe: if off-camera for >1.5s, warp back near center
        const inView = this.cameras.main.worldView.contains(this.boss.x, this.boss.y);
        if (!inView) {
          if (!this._bossOffscreenSince) this._bossOffscreenSince = time;
          if (time - this._bossOffscreenSince > 1500) {
            this.boss.setPosition(width / 2, height / 3);
            this._bossOffscreenSince = 0;
          }
        } else {
          this._bossOffscreenSince = 0;
        }
      }
    }

    // Boss shooting pattern
    if (this.boss && this.boss.active) {
      if (!this.lastBossShot || time - this.lastBossShot > 700) {
        this.lastBossShot = time;
        // Fire 3-way aimed burst
        const base = Phaser.Math.Angle.Between(this.boss.x, this.boss.y, this.player.x, this.player.y);
        [0, -0.15, 0.15].forEach((off) => {
          const vx = Math.cos(base + off) * 240; const vy = Math.sin(base + off) * 240;
          const b = this.bossBullets.get(this.boss.x, this.boss.y, 'bullet'); if (!b) return;
          b.setActive(true).setVisible(true);
          b.setCircle(2).setOffset(-2, -2);
          b.setVelocity(vx, vy);
          b.setTint(0xffff00); // enemy bullets are yellow
          b.update = () => { if (!this.cameras.main.worldView.contains(b.x, b.y)) b.destroy(); };
        });
      }
    }

    // Portal check handled by physics overlap when it exists
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
}
