import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { generateRoom } from '../systems/ProceduralGen.js';
import { createEnemy } from '../systems/EnemyFactory.js';
import { getWeaponById, weaponDefs } from '../core/Weapons.js';

export default class CombatScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Combat); }

  create() {
    const { width, height } = this.scale;
    this.gs = this.registry.get('gameState');
    this.inputMgr = new InputManager(this);

    // Player
    this.player = this.physics.add.sprite(width / 2, height / 2, 'player_square').setCollideWorldBounds(true);
    this.player.setSize(12, 12);
    this.player.iframesUntil = 0;
    this.playerFacing = 0; // radians

    // Dash state
    this.dash = { active: false, until: 0, cooldownUntil: 0, vx: 0, vy: 0, charges: 0, regen: [] };
    this.dash.charges = this.gs.dashMaxCharges;
    this.registry.set('dashCharges', this.dash.charges);

    // Bullets group
    this.bullets = this.physics.add.group({ maxSize: 64, runChildUpdate: true });

    // Enemies
    this.enemies = this.add.group();
    const mods = this.gs.getDifficultyMods();
    const room = generateRoom(this.gs.rng, this.gs.currentDepth);
    this.room = room;
    this.createArenaWalls(room);
    room.spawnPoints.forEach((p) => {
      const e = createEnemy(this, p.x, p.y, Math.floor(20 * mods.enemyHp), Math.floor(10 * mods.enemyDamage), 60);
      this.enemies.add(e);
    });

    // Colliders
    if (this.walls) {
      this.physics.add.collider(this.player, this.walls);
      this.physics.add.collider(this.enemies.getChildren(), this.walls);
    }

    this.physics.add.overlap(this.bullets, this.enemies.getChildren(), (b, e) => {
      if (!b.active || !e.active) return;
      e.hp -= b.damage || 10;
      b.destroy();
      if (e.hp <= 0) {
        e.destroy();
        // coin drop
        this.gs.gold += 5;
      }
    });

    this.physics.add.overlap(this.player, this.enemies.getChildren(), (p, e) => {
      if (this.time.now < this.player.iframesUntil) return;
      this.gs.hp -= e.damage;
      this.player.iframesUntil = this.time.now + 600;
      if (this.gs.hp <= 0) {
        // For framework: respawn at hub
        this.gs.hp = this.gs.maxHp;
        this.gs.nextScene = SceneKeys.Hub;
        SaveManager.saveToLocal(this.gs);
        this.scene.start(SceneKeys.Hub);
      }
    });

    // Exit appears when all enemies dead
    this.exitActive = false;
    this.exitG = this.add.graphics();
    this.prompt = this.add.text(width / 2, 20, 'Clear enemies', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
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
      const b = this.bullets.get();
      if (!b) continue;
      b.setActive(true).setVisible(true);
      b.body = this.physics.add.image(startX, startY, 'bullet');
      b.body.setCircle(2).setOffset(-2, -2);
      b.body.setVelocity(vx, vy);
      b.damage = weapon.damage;
      b.update = () => {
        // Lifetime and arena bounds
        if (!this.arenaRect.contains(b.body.x, b.body.y)) { b.destroy(); return; }
      };
      b.on('destroy', () => b._g?.destroy());
    }
  }

  update() {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);

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
      this.dash.regen.push(now + this.gs.dashRegenMs);
    }

    if (this.dash.active && now < this.dash.until) {
      this.player.setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      const mv = this.inputMgr.moveVec;
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
    if (this.inputMgr.isLMBDown && (!this.lastShot || this.time.now - this.lastShot > weapon.fireRateMs)) {
      this.shoot();
      this.lastShot = this.time.now;
    }

    // Swap weapons with Q
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.q)) {
      const owned = this.gs.ownedWeapons;
      if (owned && owned.length) {
        const idx = Math.max(0, owned.indexOf(this.gs.activeWeapon));
        const next = owned[(idx + 1) % owned.length];
        this.gs.activeWeapon = next;
      }
    }

    // Update enemies: simple chase
    this.enemies.getChildren().forEach((e) => {
      if (!e.active) return;
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      e.body.setVelocity((dx / len) * e.speed, (dy / len) * e.speed);
    });

    // Check clear
    const alive = this.enemies.getChildren().filter((e) => e.active).length;
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
}
