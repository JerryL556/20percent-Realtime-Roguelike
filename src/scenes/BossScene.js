import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { createBoss } from '../systems/EnemyFactory.js';
import { getWeaponById } from '../core/Weapons.js';

export default class BossScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Boss); }

  create() {
    const { width, height } = this.scale;
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

    // Boss
    const mods = this.gs.getDifficultyMods();
    this.boss = createBoss(this, width / 2, 100, Math.floor(300 * mods.enemyHp), Math.floor(20 * mods.enemyDamage), 50);
    this.physics.add.existing(this.boss);

    // Arena walls
    this.createArenaWalls();
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
        this.gs.hp = this.gs.maxHp;
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
    this.physics.add.overlap(this.bullets, this.boss, (b, boss) => {
      if (!b.active || !boss.active) return;
      boss.hp -= b.damage || 12;
      b.destroy();
      if (boss.hp <= 0) {
        boss.destroy();
        this.win();
      }
    });

    // Boss bullets (Arcade.Image pool)
    this.bossBullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 64,
      runChildUpdate: true,
    });
    this.physics.add.overlap(this.player, this.bossBullets, (p, b) => {
      if (this.time.now < this.player.iframesUntil) return;
      this.gs.hp -= 10; // boss bullet damage
      this.player.iframesUntil = this.time.now + 600;
      b.destroy();
      if (this.gs.hp <= 0) {
        this.gs.hp = this.gs.maxHp;
        this.gs.nextScene = SceneKeys.Hub;
        SaveManager.saveToLocal(this.gs);
        this.scene.start(SceneKeys.Hub);
      }
    });

    // Text
    this.prompt = this.add.text(width / 2, 20, 'Defeat the Boss', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    this.exitRect = null;
    this.exitG = this.add.graphics();
  }

  win() {
    // Reward and open exit
    this.gs.gold += 50;
    this.prompt.setText('Boss defeated! E to exit');
    this.exitRect = new Phaser.Geom.Rectangle(this.scale.width - 50, this.scale.height / 2 - 30, 40, 60);
    this.exitG.clear();
    this.exitG.fillStyle(0x22ff88, 1).fillRect(this.exitRect.x, this.exitRect.y, this.exitRect.width, this.exitRect.height);
  }

  shoot() {
    const gs = this.gs;
    const weapon = getWeaponById(gs.activeWeapon);
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
      b.update = () => {
        if (!this.cameras.main.worldView.contains(b.x, b.y)) b.destroy();
      };
      b.on('destroy', () => b._g?.destroy());
    }
  }

  update(time) {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);

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
      this.dash.charges -= 1; this.dash.regen.push(now + this.gs.dashRegenMs);
    }
    if (this.dash.active && now < this.dash.until) {
      this.player.setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      const speed = 200;
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
    const weapon = getWeaponById(this.gs.activeWeapon);
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
          b.update = () => { if (!this.cameras.main.worldView.contains(b.x, b.y)) b.destroy(); };
        });
      }
    }

    // Exit check
    if (this.exitRect) {
      const playerRect = this.player.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(playerRect, this.exitRect)) {
        if (this.inputMgr.pressedInteract) {
          this.gs.progressAfterBoss();
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
    }
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
