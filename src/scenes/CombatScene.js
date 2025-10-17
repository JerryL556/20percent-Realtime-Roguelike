import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { generateRoom } from '../systems/ProceduralGen.js';
import { createEnemy, createShooterEnemy, createRunnerEnemy, createSniperEnemy } from '../systems/EnemyFactory.js';
import { weaponDefs } from '../core/Weapons.js';
import { impactBurst } from '../systems/Effects.js';
import { getEffectiveWeapon, getPlayerEffects } from '../core/Loadout.js';

const DISABLE_WALLS = true; // Temporary: remove concrete walls

export default class CombatScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Combat); }

  create() {
    const { width, height } = this.scale;
    // Ensure UI overlay is active during combat
    this.scene.launch(SceneKeys.UI);
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
    this.registry.set('dashRegenProgress', 1);

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
    room.spawnPoints.forEach((p) => {
      // Spawn composition: 10% sniper, 40% shooter, else melee (runner or normal)
      const roll = this.gs.rng.next();
      let e;
      if (roll < 0.10) {
        e = createSniperEnemy(this, p.x, p.y, Math.floor(80 * mods.enemyHp), Math.floor(18 * mods.enemyDamage), 40);
      } else if (roll < 0.50) {
        e = createShooterEnemy(this, p.x, p.y, Math.floor(90 * mods.enemyHp), Math.floor(8 * mods.enemyDamage), 50, 900);
      } else {
        // Melee enemies deal more damage globally
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); // +50% melee damage
        // 50% chance of runner vs normal melee
        if (this.gs.rng.next() < 0.5) {
          e = createRunnerEnemy(this, p.x, p.y, Math.floor(42 * mods.enemyHp), meleeDmg, 120);
        } else {
          e = createEnemy(this, p.x, p.y, Math.floor(60 * mods.enemyHp), meleeDmg, 60);
        }
      }
      this.enemies.add(e);
    });

    // Colliders
    if (this.walls) {
      this.physics.add.collider(this.player, this.walls);
      this.physics.add.collider(this.enemies, this.walls);
    }

    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => {
      if (!b.active || !e.active) return;
      // Only track per-target hits for piercing bullets to allow shotgun pellets to stack normally
      if (b._core === 'pierce') {
        if (!b._hitSet) b._hitSet = new Set();
        if (b._hitSet.has(e)) return;
        b._hitSet.add(e);
      }
      if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
      // Apply damage
      e.hp -= b.damage || 10;
      // Visual impact effect by core type (small unless blast)
      try {
        const core = b._core || null;
        if (core === 'blast') impactBurst(this, b.x, b.y, { color: 0xffaa33, size: 'large' });
        else if (core === 'pierce') impactBurst(this, b.x, b.y, { color: 0x66aaff, size: 'small' });
        else impactBurst(this, b.x, b.y, { color: 0xffffff, size: 'small' });
      } catch (_) {}
      // Apply blast splash before removing the bullet
      if (b._core === 'blast') {
        const radius = 40;
        this.enemies.getChildren().forEach((other) => {
          if (!other.active || other === e) return;
          const dx = other.x - b.x; const dy = other.y - b.y;
          if (dx * dx + dy * dy <= radius * radius) {
            if (typeof other.hp !== 'number') other.hp = other.maxHp || 20;
            other.hp -= Math.ceil((b.damage || 10) * 0.5);
            if (other.hp <= 0) { this.killEnemy(other); }
          }
        });
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
      if (!inIframes) {
        const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 8; // default shooter damage
        this.gs.hp -= dmg;
        this.player.iframesUntil = this.time.now + 600;
        if (this.gs.hp <= 0) {
          this.gs.hp = this.gs.maxHp;
          this.gs.nextScene = SceneKeys.Hub;
          SaveManager.saveToLocal(this.gs);
          this.scene.start(SceneKeys.Hub);
        }
      }
      // Always destroy enemy bullet on contact, even during i-frames
      try { b.destroy(); } catch (_) {}
    });

    // Exit appears when all enemies dead
    this.exitActive = false;
    this.exitG = this.add.graphics();
    // Move in-game prompt down to avoid overlapping UI
    this.prompt = this.add.text(width / 2, 40, 'Clear enemies', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
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
    if (this.inputMgr.isLMBDown && (!this.lastShot || this.time.now - this.lastShot > weapon.fireRateMs)) {
      this.shoot();
      this.lastShot = this.time.now;
    }

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
      }
    }

    // Update enemies: melee chase; shooters chase gently and fire at intervals; snipers aim then fire
    this.enemies.getChildren().forEach((e) => {
      if (!e.active) return;
      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      const moveSpeed = e.isShooter ? e.speed * 0.8 : e.speed;
      e.body.setVelocity(nx * moveSpeed, ny * moveSpeed);

      if (e.isShooter) {
        if (!e.lastShotAt) e.lastShotAt = 0;
        if (this.time.now - e.lastShotAt > (e.fireRateMs || 900)) {
          e.lastShotAt = this.time.now;
          const angle = Math.atan2(dy, dx);
          const vx = Math.cos(angle) * 240;
          const vy = Math.sin(angle) * 240;
          const b = this.enemyBullets.get(e.x, e.y, 'bullet');
          if (b) {
            b.setActive(true).setVisible(true);
            b.setCircle(2).setOffset(-2, -2);
            b.setVelocity(vx, vy);
            b.setTint(0xffff00); // enemy bullets are yellow
            b.update = () => {
              const view = this.cameras?.main?.worldView;
              if (view && !view.contains(b.x, b.y)) { b.destroy(); }
            };
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
            e._aimG.lineStyle(2, 0xff2222, 1);
            e._aimG.beginPath();
            e._aimG.moveTo(e.x, e.y);
            e._aimG.lineTo(this.player.x, this.player.y);
            e._aimG.strokePath();
          } catch (_) {}
          if (now - (e.aimStartedAt || 0) >= (e.aimDurationMs || 1000)) {
            // Fire a high-speed, high-damage shot
            const angle = Math.atan2(dy, dx);
            const vx = Math.cos(angle) * 2000;
            const vy = Math.sin(angle) * 2000;
            const b = this.enemyBullets.get(e.x, e.y, 'bullet');
            if (b) {
              b.setActive(true).setVisible(true);
              b.setCircle(2).setOffset(-2, -2);
              b.setVelocity(vx, vy);
              b.damage = Math.max(35, Math.floor((e.damage || 20) * 2.0)); // higher sniper damage
              b.setTint(0xff3333);
              b.update = () => {
                const view = this.cameras?.main?.worldView;
                if (view && !view.contains(b.x, b.y)) { b.destroy(); }
              };
            }
            // End aiming and start cooldown; remove laser
            e.aiming = false;
            e.lastShotAt = now;
            try { e._aimG?.clear(); e._aimG?.destroy(); e._aimG = null; } catch (_) {}
          }
        } else {
          // Not aiming: wander randomly, do not chase player
          if (!e._wanderChangeAt || now >= e._wanderChangeAt) {
            const ang = this.gs.rng.next() * Math.PI * 2;
            const mag = e.speed * 0.9;
            e._wanderVX = Math.cos(ang) * mag;
            e._wanderVY = Math.sin(ang) * mag;
            e._wanderChangeAt = now + 800 + Math.floor(this.gs.rng.next() * 800);
          }
          e.body.setVelocity(e._wanderVX || 0, e._wanderVY || 0);
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
}
