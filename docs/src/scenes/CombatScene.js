import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { generateRoom, generateBarricades } from '../systems/ProceduralGen.js';
import { createEnemy, createShooterEnemy, createRunnerEnemy, createSniperEnemy, createMachineGunnerEnemy, createRocketeerEnemy, createBoss, createGrenadierEnemy, createPrismEnemy, createSnitchEnemy, createRookEnemy } from '../systems/EnemyFactory.js';
import { weaponDefs } from '../core/Weapons.js';
import { impactBurst, bitSpawnRing, pulseSpark, muzzleFlash, muzzleFlashSplit, ensureCircleParticle, ensurePixelParticle, pixelSparks, spawnDeathVfxForEnemy } from '../systems/Effects.js';
import { getEffectiveWeapon, getPlayerEffects } from '../core/Loadout.js';
import { buildNavGrid, worldToGrid, findPath } from '../systems/Pathfinding.js';
import { preloadWeaponAssets, createPlayerWeaponSprite, syncWeaponTexture, updateWeaponSprite, createFittedImage, getWeaponMuzzleWorld, getWeaponBarrelPoint } from '../systems/WeaponVisuals.js';
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
    const b7 = addBtn(6, 'Spawn Grenadier', () => { this.enemies.add(sp(createGrenadierEnemy)); });
    const b8 = addBtn(7, 'Spawn Prism', () => { this.enemies.add(sp(createPrismEnemy)); });
    const b9 = addBtn(8, 'Spawn Snitch', () => { this.enemies.add(sp(createSnitchEnemy)); });
    const b10 = addBtn(9, 'Spawn Rook', () => { this.enemies.add(sp(createRookEnemy)); });
    const b11 = addBtn(11, 'Spawn Boss', () => { this.enemies.add(sp((sc, x, y) => { const e = createBoss(sc, x, y, 600, 20, 50); e.isEnemy = true; return e; })); });
    const b12 = addBtn(13, 'Clear Enemies', () => {
      try { this.enemies.getChildren().forEach((e) => { if (e && e.active && !e.isDummy) e.destroy(); }); } catch (_) {}
    });
    const close = makeTextButton(this, cx, y0 + 15 * line, 'Close', () => this.closePanel([title, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, close]));
    this.panel._extra = [title, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, close];
  }

  closePanel(extra = []) {
    const extras = [
      ...(Array.isArray(extra) ? extra : []),
      ...(this.panel && Array.isArray(this.panel._extra) ? this.panel._extra : []),
    ];
    if (this.panel) { try { this.panel.destroy(); } catch (_) {} this.panel = null; }
    extras.forEach((o) => { try { o?.destroy?.(); } catch (_) {} });
  }

  // Player melee implementation: 150° cone, 48px range, 10 damage (faster registration)
  performPlayerMelee() {
    const caster = this.player;
    if (!caster) return;
    const ptr = this.inputMgr.pointer;
    const ang = Math.atan2(ptr.worldY - caster.y, ptr.worldX - caster.x);
    const totalDeg = 150; const half = Phaser.Math.DegToRad(totalDeg / 2);
    const range = 48;
    this._meleeAlt = !this._meleeAlt;
    // Simple transparent fan to indicate affected area (white)
    // Faster swing VFX to match earlier damage tick
    try { this.spawnMeleeVfx(caster, ang, totalDeg, 90, 0xffffff, range, this._meleeAlt); } catch (_) {}
    // Damage check against enemies (earlier ~30ms for snappier feedback)
    try {
      this.time.delayedCall(15, () => {
        const enemies = this.enemies?.getChildren?.() || [];
        enemies.forEach((e) => {
          if (!e?.active || !e.isEnemy || !caster?.active) return;
          const dx = e.x - caster.x; const dy = e.y - caster.y;
          const d = Math.hypot(dx, dy) || 1;
          const pad = (e.body?.halfWidth || 6);
          if (d > (range + pad)) return;
          const dir = Math.atan2(dy, dx);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(dir - ang));
          if (diff <= half) {
            if (e.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + 10;
              // Show universal hit VFX for dummy in shooting range
              try { impactBurst(this, e.x, e.y, { color: 0xffffff, size: 'small' }); } catch (_) {}
            } else {
              if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
              e.hp -= 10;
              if (e.hp <= 0) { try { this.killEnemy(e); } catch (_) {} }
              // Universal melee hit VFX on enemy
              try { impactBurst(this, e.x, e.y, { color: 0xffffff, size: 'small' }); } catch (_) {}
            }
          }
        });
      });
    } catch (_) {}
  }


  // Centralized damage application that respects Energy Shield and overrun
  applyPlayerDamage(amount) {
    try {
      const gs = this.gs; if (!gs) return;
      const dmg = Math.max(0, Math.floor(amount || 0)); if (dmg <= 0) return;
      let remaining = dmg;
      const s = Math.max(0, Math.floor(gs.shield || 0));
      const hadShield = s > 0;
      let shieldBroke = false;
      if (s > 0) {
        const absorbed = Math.min(s, remaining);
        gs.shield = s - absorbed;
        remaining -= absorbed;
        if (s > 0 && gs.shield === 0) shieldBroke = true;
      }
      if (remaining > 0) {
        let allow = (gs.allowOverrun !== false);
        try { const eff = getPlayerEffects(gs) || {}; if (hadShield && eff.preventShieldOverflow) allow = false; } catch (_) {}
        if (allow) gs.hp = Math.max(0, (gs.hp | 0) - remaining);
      }
      // If shield just broke and the Emergency Pulse mod is active, auto-release a Repulsion Pulse
      try {
        if (shieldBroke) {
          const eff = getPlayerEffects(gs) || {};
          if (eff.preventShieldOverflow) {
            const nowT = this.time.now;
            // Hidden cooldown: trigger at most once every 12s
            if (nowT >= (this._emPulseCdUntil || 0)) {
              this._emPulseCdUntil = nowT + 12000;
              const blue = { trail: 0x66aaff, outer: 0x66aaff, inner: 0x99ccff, spark: 0x66aaff, pixel: 0x66aaff, impact: 0x66aaff };
              this.deployRepulsionPulse(blue);
            }
          }
        }
      } catch (_) {}
      gs.lastDamagedAt = this.time.now;
      // Reset Deep Dive run on death so level/stage restart when returning to hub
      try {
        if ((gs.hp | 0) <= 0 && gs.gameMode === 'DeepDive') {
          gs.deepDive = { level: 1, stage: 1, baseNormal: 5, baseElite: 1 };
        }
      } catch (_) {}
    } catch (_) {}
  }

  // Shared melee VFX: simple transparent fan (sector) showing affected area; follows caster position
  spawnMeleeVfx(caster, baseAngle, totalDeg, durationMs, color, range, altStart) {
    try {
      if (caster._meleeFan?.cleanup) { caster._meleeFan.cleanup(); }
      else if (caster._meleeFan?.g) { caster._meleeFan.g.destroy(); }
    } catch (_) {}
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

    // Add a bright additive "beam" line that sweeps across the melee fan during the swing
    try {
      const beam = this.add.graphics({ x: caster.x, y: caster.y });
      try { beam.setDepth?.(9500); } catch (_) {}
      try { beam.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      const start = altStart ? (baseAngle + half) : (baseAngle - half);
      const end = altStart ? (baseAngle - half) : (baseAngle + half);
      const startAt = this.time.now;
      const endAt = startAt + dur;
      const thick = Math.max(2, Math.floor(r * 0.08));
      // Base-white accent near origin for readability on enemies (short segment)
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
          // Linear interpolate angles (range is <= 180�? safe for lerp)
          const cur = start + (end - start) * t;
          const tipX = Math.cos(cur) * r;
          const tipY = Math.sin(cur) * r;
          beam.clear();
          // Outer colored stroke
          beam.lineStyle(thick, col, 0.95);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX, tipY); beam.strokePath();
          // White base segment for the first ~1/3 of beam length
          const baseFrac = 0.35;
          beam.lineStyle(Math.max(1, thick - 1), 0xffffee, 0.98);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX * baseFrac, tipY * baseFrac); beam.strokePath();
          // Inner core using the beam color for the rest
          beam.lineStyle(Math.max(1, thick - 1), col, 0.95);
          beam.beginPath(); beam.moveTo(0, 0); beam.lineTo(tipX * 0.85, tipY * 0.85); beam.strokePath();
          // Tip bloom
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

          if (now >= endAt) { cleanupBeam(); return; }
        } catch (_) {}
      };
      this.events.on('update', updateBeam, this);
      const cleanupBeam = () => {
        try { this.events.off('update', updateBeam, this); } catch (_) {}
        try { this.tweens.killTweensOf(beam); } catch (_) {}
        try { beam.clear(); beam.visible = false; } catch (_) {}
        try { beam.destroy(); } catch (_) {}
        try { if (caster && caster._meleeLine && caster._meleeLine.g === beam) caster._meleeLine = null; } catch (_) {}
      };
      // Store handle for potential early cleanup next swing
      caster._meleeLine = { g: beam, cleanup: cleanupBeam };
      // Safety guard in case scene stops updating
      this.time.delayedCall(dur, cleanupBeam);
    } catch (_) {}
  }

  create() {
    const { width, height } = this.scale;
    // Ensure physics world bounds match the visible area so enemies can't leave the screen
    this.physics.world.setBounds(0, 0, width, height);
    try { this.physics.world.setBoundsCollision(true, true, true, true); } catch (_) {}
    // Ensure UI overlay is active during combat
    this.scene.launch(SceneKeys.UI);
    try { this.scene.bringToTop(SceneKeys.UI); } catch (_) {}
    this.gs = this.registry.get('gameState');
    this.gs = this.registry.get('gameState');
    // Ensure Deep Dive tracker text exists in UI scene (create deterministically)
    try {
      const ensureDeepDiveLabel = () => {
        const ui = this.scene.get(SceneKeys.UI);
        if (!ui) return;
        if (!ui.deepDiveText || !ui.deepDiveText.active) {
          ui.deepDiveText = ui.add.text(12, 28, '', { fontFamily: 'monospace', fontSize: 12, color: '#66ffcc' }).setOrigin(0, 0).setAlpha(0.95);
        }
        if (this.gs?.gameMode === 'DeepDive' && this.gs.deepDive) {
          const L = Math.max(1, this.gs.deepDive.level || 1);
          const S = Math.max(1, Math.min(4, this.gs.deepDive.stage || 1));
          ui.deepDiveText.setText(`Deep Dive ${L}-${S}`);
          ui.deepDiveText.setVisible(true);
        } else {
          ui.deepDiveText.setVisible(false);
        }
      };
      // Attempt immediately and after a short delay in case UI is still booting
      ensureDeepDiveLabel();
      this.time.delayedCall(50, ensureDeepDiveLabel);
      this.time.delayedCall(150, ensureDeepDiveLabel);
    } catch (_) {}
    // Ensure shield is full on scene start
    try {
      if (typeof this.gs.shieldMax !== "number") this.gs.shieldMax = 20;
      this.gs.shield = this.gs.shieldMax;
    } catch (_) {}
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
    // Persistent WASP BITS (armour)
    this._wasps = [];
    // Laser state
    this.laser = { heat: 0, firing: false, overheat: false, startedAt: 0, coolDelayUntil: 0, g: null, lastTickAt: 0 };
    // Persistent fire fields from MGL core
    this._firefields = [];
    this.registry.set('reloadProgress', 0);

    // Keep weapon sprite updated every frame without touching existing update()
    try {
      this.events.on('update', () => {
        // Update position/rotation
        updateWeaponSprite(this);
        // Always try to sync texture in case it finished loading after create
        if (this.gs) syncWeaponTexture(this, this.gs.activeWeapon);
        this._lastActiveWeapon = this.gs?.activeWeapon;
        // Shield regeneration (regens even from 0 after a delay)
        // Shield VFX: subtle blue ring when shield > 0; break animation on 0
        try {
          const gs = this.gs; if (!gs || !this.player) return;
          const hasShield = (gs.shield || 0) > 0.0001;
          if (hasShield) {
            if (!this._shieldRingG || !this._shieldRingG.active) {
              this._shieldRingG = this.add.graphics({ x: this.player.x, y: this.player.y });
              try { this._shieldRingG.setDepth(8800); } catch (_) {}
              try { this._shieldRingG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
            }
            const g = this._shieldRingG; g.clear();
            const t = (this.time.now % 1000) / 1000;
            const radius = 13 + Math.sin(t * Math.PI * 2) * 1.0; const s = Math.max(0, gs.shield || 0); const smax = Math.max(1e-6, gs.shieldMax || 0); const p = Math.max(0, Math.min(1, s / smax)); const alpha = (0.12 + 0.28 * p) + Math.sin(t * Math.PI * 2) * 0.04 * p;
            g.lineStyle(3, 0x66ccff, 0.55 + 0.4 * p).strokeCircle(0, 0, radius);
            g.lineStyle(2, 0x99ddff, 0.3 + 0.4 * p).strokeCircle(0, 0, Math.max(11, radius - 2.5));
            try { g.setAlpha(alpha); } catch (_) {}
            g.x = this.player.x; g.y = this.player.y;
          } else {
            if (this._shieldRingG) {
              const old = this._shieldRingG; this._shieldRingG = null;
              try {
                this.tweens.add({ targets: old, alpha: 0, scale: 1.6, duration: 160, ease: 'Cubic.Out', onComplete: () => { try { old.destroy(); } catch (_) {} } });
              } catch (_) { try { old.destroy(); } catch (_) {} }
              try {
                const cx = this.player.x, cy = this.player.y;
                for (let i = 0; i < 18; i += 1) {
                  const a = (i / 12) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.05, 0.05);
                  pixelSparks(this, cx, cy, { angleRad: a, count: 1, spreadDeg: 10, speedMin: 160, speedMax: 280, lifeMs: 220, color: 0x66ccff, size: 2, alpha: 0.95 });
                }
                const br = this.add.graphics({ x: cx, y: cy });
                try { br.setDepth(8800); br.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
                br.lineStyle(3, 0x66ccff, 1.0).strokeCircle(0, 0, 12);
                this.tweens.add({ targets: br, alpha: 0, scale: 2.0, duration: 220, ease: 'Cubic.Out', onComplete: () => { try { br.destroy(); } catch (_) {} } });
              } catch (_) {}
            }
          }
        } catch (_) {}
        try {
          const gs = this.gs; if (!gs) return;
          const now = this.time.now;
          const since = now - (gs.lastDamagedAt || 0);
          if (since >= (gs.shieldRegenDelayMs || 4000) && (gs.shield || 0) < (gs.shieldMax || 0)) {
            const dt = ((this.game?.loop?.delta) || 16) / 1000;
            const inc = ((gs.shieldRegenPerSec || 0) + ((getPlayerEffects(this.gs)||{}).shieldRegenBonus || 0)) * dt;
            gs.shield = Math.min((gs.shield || 0) + inc, (gs.shieldMax || 0));
          }
        } catch (_) {}
        // Deep Dive tracker update in UI scene
        try {
          const ui = this.scene.get(SceneKeys.UI);
          if (ui && ui.deepDiveText) {
            if (this.gs?.gameMode === 'DeepDive' && this.gs.deepDive) {
              const L = Math.max(1, this.gs.deepDive.level || 1);
              const S = Math.max(1, Math.min(4, this.gs.deepDive.stage || 1));
              ui.deepDiveText.setText(`Deep Dive ${L}-${S}`);
              ui.deepDiveText.setVisible(true);
            } else {
              ui.deepDiveText.setVisible(false);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}

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
      // Choose a barricade variant for normal rooms
      const brRoll = this.gs.rng.next();
      const variant = (brRoll < 0.34) ? 'normal' : (brRoll < 0.67) ? 'soft_many' : 'hard_sparse';
      const barricades = generateBarricades(this.gs.rng, this.arenaRect, variant);
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

    // Helpers for spawns
    const spawnOneNormal = () => {
      const sp = pickEdgeSpawn();
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
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5);
        e = createRunnerEnemy(this, sp.x, sp.y, Math.floor(60 * mods.enemyHp), meleeDmg, 120);
      } else {
        const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5);
        e = createEnemy(this, sp.x, sp.y, Math.floor(100 * mods.enemyHp), meleeDmg, 60);
      }
      this.enemies.add(e);
    };
    const spawnOneElite = () => {
      const spE = pickEdgeSpawn();
      const pick = Math.random();
      if (pick < (1/4)) {
        this.enemies.add(createGrenadierEnemy(this, spE.x, spE.y, Math.floor(260 * mods.enemyHp), Math.floor(14 * mods.enemyDamage), 48, 2000));
      } else if (pick < (2/4)) {
        this.enemies.add(createPrismEnemy(this, spE.x, spE.y, Math.floor(180 * mods.enemyHp), Math.floor(16 * mods.enemyDamage), 46));
      } else if (pick < (3/4)) {
        this.enemies.add(createSnitchEnemy(this, spE.x, spE.y, Math.floor(100 * mods.enemyHp), Math.floor(6 * mods.enemyDamage), 60));
      } else {
        this.enemies.add(createRookEnemy(this, spE.x, spE.y, Math.floor(300 * mods.enemyHp), Math.floor(25 * mods.enemyDamage), 35));
      }
    };

    if (!this.gs?.shootingRange) {
      if (this.gs?.gameMode === 'DeepDive') {
        const dd = this.gs.deepDive || {};
        const baseN = Math.max(1, dd.baseNormal || 5);
        const baseE = Math.max(1, dd.baseElite || 1);
        const stage = Math.max(1, Math.min(4, dd.stage || 1));
        const stageNormal = baseN + Math.min(stage - 1, 2);
        const stageElite = (stage === 4) ? (baseE * 2) : baseE;
        for (let i = 0; i < stageNormal; i += 1) spawnOneNormal();
        for (let i = 0; i < stageElite; i += 1) spawnOneElite();
      } else {
        // Normal game: existing composition
        room.spawnPoints.forEach(() => spawnOneNormal());
        // Exactly 1 elite
        spawnOneElite();
      }
    }

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
      (b, s) => {
        if (!b || !s) return false;
        if (b._rail) return false; // rail pierces
        if (b._core === 'pierce') {
          try {
            const dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 10;
            const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
            const hp1 = hp0 - dmg;
            try { impactBurst(this, b.x, b.y, { color: 0xC8A165, size: 'small' }); } catch (_) {}
            if (hp1 <= 0) { try { s.destroy(); } catch (_) {} } else { s.setData('hp', hp1); }
          } catch (_) {}
          return false;
        }
        return true;
      },
      this,
    );

    // Shield hitboxes for Rook (separate from body)
    this.rookShieldGroup = this.physics.add.group();
    this.physics.add.overlap(this.bullets, this.rookShieldGroup, (b, z) => {
      try {
        if (!b?.active || !z?.active) return;
        if (b._rail) return; // rail pierces shields
        const e = z._owner; if (!e?.active || !e.isRook) return;
        const cx = z.x, cy = z.y; const r = (e._shieldRadius || 60);
        const angToBullet = Math.atan2(b.y - cy, b.x - cx);
        const shieldAng = e._shieldAngle || 0; const half = Phaser.Math.DegToRad(45);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(angToBullet - shieldAng));
        if (diff <= half) {
          const dxr = b.x - cx, dyr = b.y - cy; const d2 = dxr * dxr + dyr * dyr; const r2 = r * r;
          if (d2 >= (r2 * 0.7)) {
            const hitX = cx + Math.cos(angToBullet) * r;
            const hitY = cy + Math.sin(angToBullet) * r;
            try { impactBurst(this, hitX, hitY, { color: 0xff3333, size: 'small' }); } catch (_) {}
            try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
            try { b.setActive(false).setVisible(false); } catch (_) {}
            this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
          }
        }
      } catch (_) {}
    }, null, this);
    // Rook shield zone overlap disabled; blocking handled in bullets vs enemies outer-arc check

    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => {
      if (!b.active || !e.active) return;
      // Rook shield: block non-rail bullets (including rockets) within 90° front arc
      if (e.isRook && !b._rail) {
        try {
          const r = (e._shieldRadius || 60);
          const gap = 35; const off = (gap - r);
          const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
          const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
          const angToBullet = Math.atan2(b.y - cy, b.x - cx);
          const shieldAng = e._shieldAngle || 0;
          const diff = Math.abs(Phaser.Math.Angle.Wrap(angToBullet - shieldAng));
          const half = Phaser.Math.DegToRad(45);
          // r: using fixed shield radius above
          // Compute hit on outside arc boundary along direction from shield center to bullet
          const hitX = cx + Math.cos(angToBullet) * r;
          const hitY = cy + Math.sin(angToBullet) * r;
          // Only block if bullet is within arc sector and outside/at radius (ensures boundary hit)
          const dxr = b.x - cx, dyr = b.y - cy; const d2 = dxr * dxr + dyr * dyr;
          if (diff <= half && d2 >= (r * r * 0.9)) {
            // Spark exactly on the arc boundary
            try { impactBurst(this, hitX, hitY, { color: 0xff3333, size: 'small' }); } catch (_) {}
            // Destroy projectile without applying damage or AoE
            try { if (b.body) b.body.checkCollision.none = true; } catch (_) {}
            try { b.setActive(false).setVisible(false); } catch (_) {}
            this.time.delayedCall(0, () => { try { b.destroy(); } catch (_) {} });
            return;
          }
        } catch (_) {}
      }
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
        // Reflect on-hit status effects in Range: build ignite/toxin values on dummy
        if (b._igniteOnHit && b._igniteOnHit > 0) {
          e._igniteValue = Math.min(10, (e._igniteValue || 0) + b._igniteOnHit);
          if ((e._igniteValue || 0) >= 10) {
            e._ignitedUntil = this.time.now + 2000;
            e._igniteValue = 0; // reset on trigger
            // Create/position ignite indicator for dummy
            if (!e._igniteIndicator) {
              e._igniteIndicator = this.add.graphics();
              try { e._igniteIndicator.setDepth(9000); } catch (_) {}
              e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
            }
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        }
        if (b._toxinOnHit && b._toxinOnHit > 0) {
          e._toxinValue = Math.min(10, (e._toxinValue || 0) + b._toxinOnHit);
          if ((e._toxinValue || 0) >= 10) {
            e._toxinedUntil = this.time.now + 2000;
            e._toxinValue = 0; // reset on trigger
            // Create/position toxin indicator for dummy
            if (!e._toxinIndicator) {
              e._toxinIndicator = this.add.graphics();
              try { e._toxinIndicator.setDepth(9000); } catch (_) {}
              e._toxinIndicator.fillStyle(0x33ff33, 1).fillCircle(0, 0, 2);
            }
            try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {}
          }
        }
        if (b._stunOnHit && b._stunOnHit > 0) {
          const nowS = this.time.now;
          e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
          if ((e._stunValue || 0) >= 10) {
            e._stunnedUntil = nowS + 200;
            e._stunValue = 0;
            if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
            try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
          }
        }
      } else {
        if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
        // Apply damage (Explosive Core reduces primary to 80%; explosive projectiles keep 100%)
        {
          const baseDmg = b.damage || 10;
          const primaryDmg = (b._core === 'blast' && !b._rocket) ? Math.ceil(baseDmg * 0.8) : baseDmg;
          e.hp -= primaryDmg;
        }
        // Apply ignite buildup from special cores (e.g., Rifle Incendiary)
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
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        }
        // Apply toxin buildup from special cores (e.g., SMG Toxic Rounds)
        if (b._toxinOnHit && b._toxinOnHit > 0) {
          const addT = b._toxinOnHit;
          e._toxinValue = Math.min(10, (e._toxinValue || 0) + addT);
          if ((e._toxinValue || 0) >= 10) {
            const nowT = this.time.now;
            e._toxinedUntil = nowT + 2000;
            e._toxinValue = 0; // reset on trigger
            if (!e._toxinIndicator) {
              e._toxinIndicator = this.add.graphics();
              try { e._toxinIndicator.setDepth(9000); } catch (_) {}
              e._toxinIndicator.fillStyle(0x33ff33, 1).fillCircle(0, 0, 2);
            }
            try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {}
          }
        }
        // Apply stun buildup from stun ammunition (normal enemies)
        if (b._stunOnHit && b._stunOnHit > 0) {
          const nowS = this.time.now;
          e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
          if ((e._stunValue || 0) >= 10) {
            e._stunnedUntil = nowS + 200;
            e._stunValue = 0;
            if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
            try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
          }
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
        // Drop fire field on any explosive detonation, not just when reaching target
        try {
          if (b._firefield) {
            this.spawnFireField(b.x, b.y, radius);
            // Napalm: apply immediate ignite buildup (+5) to enemies in radius
            const r2 = radius * radius; const nowT = this.time.now;
            this.enemies.getChildren().forEach((other) => {
              if (!other?.active || other.isDummy) return;
              const dx2 = other.x - b.x; const dy2 = other.y - b.y;
              if ((dx2 * dx2 + dy2 * dy2) <= r2) {
                other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                if ((other._igniteValue || 0) >= 10) {
                  other._ignitedUntil = nowT + 2000; other._igniteValue = 0;
                  if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                  try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                }
              }
            });
          }
        } catch (_) {}
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
      // Ignore dummy collisions for player damage
      if (e?.isDummy) return;
      // Melee enemies do not apply touch damage; only their cone hit can damage
      if (e?.isMelee) return;
      if (this.time.now < this.player.iframesUntil) return;
      this.applyPlayerDamage(e.damage);
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
    // Enemy grenades (for elite Grenadiers)
    this.enemyGrenades = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 24,
      runChildUpdate: true,
    });
    // Grenades collide with barricades (respect cover)
    this.physics.add.collider(this.enemyGrenades, this.barricadesHard, (b, s) => this.onEnemyGrenadeHitBarricade(b, s));
    this.physics.add.collider(this.enemyGrenades, this.barricadesSoft, (b, s) => this.onEnemyGrenadeHitBarricade(b, s));
    this.physics.add.overlap(this.player, this.enemyBullets, (p, b) => {
      const inIframes = this.time.now < this.player.iframesUntil;
      if (b?._rocket) {
        // Rocket: explode on contact, apply AoE to player
      const ex = b.x; const ey = b.y; const radius = b._blastRadius || 70; const r2 = radius * radius;
        const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2 && !inIframes) {
          let dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 12; try { const eff = getPlayerEffects(this.gs) || {}; const mul = eff.enemyExplosionDmgMul || 1; dmg = Math.ceil(dmg * mul); } catch (_) {} this.applyPlayerDamage(dmg);
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
        this.applyPlayerDamage(dmg);
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
  'C: Melee',
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
    try { if (e._igniteIndicator) { e._igniteIndicator.destroy(); e._igniteIndicator = null; } } catch (_) {}
    try { if (e._toxinIndicator) { e._toxinIndicator.destroy(); e._toxinIndicator = null; } } catch (_) {}
    // Grenadier: explode on death
    try {
      if (e.isGrenadier && !e._exploded) {
        const ex = e.x; const ey = e.y; const radius = (e.explosionRadius || 60); // visual matches damage AoE
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Damage player if within radius
        const r2 = radius * radius; const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2) {
          const now = this.time.now;
          if (now >= (this.player.iframesUntil || 0)) {
            { let dmg=(e?.damage||14); try{ const eff=getPlayerEffects(this.gs)||{}; const mul=eff.enemyExplosionDmgMul||1; dmg=Math.ceil(dmg*mul);}catch(_){} this.applyPlayerDamage(dmg); }
            this.player.iframesUntil = now + 600;
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        // Also chip destructible barricades
        this.damageSoftBarricadesInRadius(ex, ey, radius, (e.damage || 14));
        e._exploded = true;
      }
    } catch (_) {}
    // Reward resources on kill (normal vs elite)
    try {
      if (!e.isDummy) {
        const ui = (() => { try { return this.scene.get(SceneKeys.UI); } catch (_) { return null; } })();
        const isElite = !!(e.isPrism || e.isSnitch || e.isRook || e.isGrenadier);
        const goldGain = isElite ? 20 : 10;
        this.gs.gold = (this.gs.gold || 0) + goldGain;
        if (ui?.showResourceHint) ui.showResourceHint(`+${goldGain} Gold`);
        const roll = Phaser.Math.Between(1, 100);
        const chance = isElite ? 50 : 10;
        if (roll <= chance) {
          this.gs.droneCores = (this.gs.droneCores || 0) + 1;
          if (ui?.showResourceHint) ui.showResourceHint(`+1 Drone Core`);
        }
      }
    } catch (_) {}
    // Death VFX (purely visual)
    try { spawnDeathVfxForEnemy(this, e); } catch (_) {}
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
      // Ensure fire field spawns on barricade detonation as well
      try { if (b._firefield) this.spawnFireField(ex, ey, radius); } catch (_) {}
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
      // Napalm immediate ignite around barricade impact for MGL rockets
      if (b._firefield) {
        const nowI = this.time.now;
        this.enemies.getChildren().forEach((other) => {
          if (!other?.active || other.isDummy) return;
          const dxn = other.x - ex; const dyn = other.y - ey;
          if ((dxn * dxn + dyn * dyn) <= r2) {
            other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
            if ((other._igniteValue || 0) >= 10) {
              other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
              if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
              try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
            }
          }
        });
      }
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

  // Enemy grenade hits a barricade: detonate and apply AoE
  onEnemyGrenadeHitBarricade(b, s) {
    if (!b || !b.active) return;
    const ex = b.x; const ey = b.y;
    const radius = b._grenadeRadius || 60;
    try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
    // Damage player if within radius
    try {
      const r2 = radius * radius; const pdx = this.player.x - ex; const pdy = this.player.y - ey;
      if ((pdx * pdx + pdy * pdy) <= r2) {
        const now = this.time.now;
        if (now >= (this.player.iframesUntil || 0)) {
          let dmg = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 14; try { const eff = getPlayerEffects(this.gs) || {}; const mul = eff.enemyExplosionDmgMul || 1; dmg = Math.ceil(dmg * mul); } catch (_) {} this.applyPlayerDamage(dmg);
          this.player.iframesUntil = now + 600;
          if (this.gs.hp <= 0) {
            const eff = getPlayerEffects(this.gs);
            this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
            this.gs.nextScene = SceneKeys.Hub;
            SaveManager.saveToLocal(this.gs);
            this.scene.start(SceneKeys.Hub);
          }
        }
      }
    } catch (_) {}
    // Damage soft barricades
    try { this.damageSoftBarricadesInRadius(ex, ey, radius, (b.damage || 14)); } catch (_) {}
    try { b.destroy(); } catch (_) {}
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
    // Trigger per-weapon recoil kick (no recoil for laser handled elsewhere)
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
        if (heavy.has(wid)) muzzleFlashSplit(this, startX, startY, { angle: baseAngle, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
        else if (wid === 'battle_rifle') muzzleFlash(this, startX, startY, { angle: baseAngle, color: 0xffee66, length: 14, thickness: 4 });
        else muzzleFlash(this, startX, startY, { angle: baseAngle, color: 0xffee66, length: 10, thickness: 3 });
        // Add yellow pixel spray from muzzle (wider angle overall; special tuning for heavy and battle rifle)
        const base = baseAngle;
        if (heavy.has(wid)) {
          const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 190, color: 0xffee66, size: 2, alpha: 0.75 };
          pixelSparks(this, startX, startY, { angleRad: base, count: 14, ...burst });
        } else if (wid === 'battle_rifle') {
          const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
          pixelSparks(this, startX, startY, { angleRad: base, count: 11, ...burst });
        } else {
          const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
          pixelSparks(this, startX, startY, { angleRad: base, count: 9, ...burst });
        }
      }
    } catch (_) {}
    const pellets = weapon.pelletCount || 1;
    // Dynamic spread: increases while holding fire, recovers when released
    const heat = this._spreadHeat || 0;
    const maxExtra = (typeof weapon.maxSpreadDeg === 'number') ? weapon.maxSpreadDeg : 20;
    const extraDeg = weapon.singleFire ? 0 : (maxExtra * heat);
    const totalSpreadRad = Phaser.Math.DegToRad((weapon.spreadDeg || 0) + extraDeg);
    // Smart HMG bullets: limited homing toward enemies (non-explosive)
    if (weapon.projectile === 'smart') {
      const angle0 = baseAngle;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        b.setCircle(2).setOffset(-2, -2);
        b.setTint(weapon.color || 0xffaa33);
        b.damage = weapon.damage;
        b._core = null; // non-explosive
        b._stunOnHit = weapon._stunOnHit || 0;

        // Homing params (more limited than Smart Missiles core)
        b._angle = angle0;
        b._speed = Math.max(40, weapon.bulletSpeed | 0);
        b._maxTurn = Phaser.Math.DegToRad(2) * 0.1; // ~0.2�?frame (more limited)
        b._fov = Phaser.Math.DegToRad(60); // narrower lock cone
        // Slightly increase Smart HMG homing: ~0.75��/frame (~45��/s)
        b._maxTurn = Phaser.Math.DegToRad(0.75);
        b._noTurnUntil = this.time.now + 120; // brief straight launch

        b.setVelocity(Math.cos(b._angle) * b._speed, Math.sin(b._angle) * b._speed);

        // Small orange tracer similar to micro rockets but shorter
        const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
        b.update = () => {
          const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }
          try {
            let desired = b._angle; const nowG = this.time.now;
            if (nowG >= (b._noTurnUntil || 0)) {
              const enemies = this.enemies?.getChildren?.() || [];
              const half = (b._fov || Math.PI / 2) / 2; const norm = (a) => Phaser.Math.Angle.Wrap(a); const ang = norm(b._angle);
              const valid = (t) => { if (!t?.active) return false; const a2 = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y); return Math.abs(norm(a2 - ang)) <= half; };
              if (!valid(b._target)) {
                b._target = null; let best=null, bestD2=Infinity;
                for (let i = 0; i < enemies.length; i += 1) { const e = enemies[i]; if (!e?.active) continue; const a2 = Phaser.Math.Angle.Between(b.x, b.y, e.x, e.y); const dAng = Math.abs(norm(a2 - ang)); if (dAng > half) continue; const dx=e.x-b.x, dy=e.y-b.y; const d2=dx*dx+dy*dy; if (d2 < bestD2) { best=e; bestD2=d2; } }
                b._target = best;
              }
              if (b._target && b._target.active) { desired = Phaser.Math.Angle.Between(b.x, b.y, b._target.x, b._target.y); }
            }
            const dtHmg = (this.game?.loop?.delta || 16.7) / 1000;
            b._angle = Phaser.Math.Angle.RotateTo(b._angle, desired, (b._maxTurn || 0) * (60 * dtHmg));
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

    // Guided micro-missiles: home toward the cursor with limited turn rate
    if (weapon.projectile === 'guided') {
      const angle0 = baseAngle;
      const b = this.bullets.get(startX, startY, 'bullet');
      if (b) {
        b.setActive(true).setVisible(true);
        b.setCircle(2).setOffset(-2, -2);
        b.setTint(weapon.color || 0xffaa33);
        // Stats and explosive behavior
        b.damage = weapon.damage;
        b._aoeDamage = (typeof weapon.aoeDamage === 'number') ? weapon.aoeDamage : weapon.damage;
        b._core = 'blast';
        b._blastRadius = weapon.blastRadius || 40;
        b._rocket = true; // treat as explosive projectile for AoE rules
        b._stunOnHit = weapon._stunOnHit || 0;

        // Homing parameters
        b._angle = angle0;
        b._speed = Math.max(40, weapon.bulletSpeed | 0); // low velocity
        // Max turn per frame baseline is increased for no-core missiles (effectively time-scaled later)
        // Drastically higher base homing for no-core: 8 deg/frame (~480��/s at 60 FPS)
        b._maxTurn = Phaser.Math.DegToRad(8);
        // Apply optional guided turn-rate multiplier from cores
        if (typeof weapon._guidedTurnMult === 'number') {
          const mul = Math.max(0.1, weapon._guidedTurnMult);
          b._maxTurn *= mul;
        }
        // Smart Missiles core: enable enemy-seeking and reduce turn further
        b._smart = !!weapon._smartMissiles;
        if (b._smart) {
          const mult = (typeof weapon._smartTurnMult === 'number') ? Math.max(0.1, weapon._smartTurnMult) : 0.5;
          b._maxTurn = b._maxTurn * mult; // e.g., 1�?frame
          b._fov = Phaser.Math.DegToRad(90); // 90�?cone total
        }
        // Preserve Smart Core homing equal to old behavior: 2 deg/frame scaled by mult
        if (b._smart) {
          const mult2 = (typeof weapon._smartTurnMult === 'number') ? Math.max(0.1, weapon._smartTurnMult) : 0.5;
          b._maxTurn = Phaser.Math.DegToRad(2) * mult2;
        }
        // Initial straight flight window (no steering)
        b._noTurnUntil = this.time.now + 200; // ms

        // Initial velocity
        b.setVelocity(Math.cos(b._angle) * b._speed, Math.sin(b._angle) * b._speed);

        // Tracer/visual tail
        const g = this.add.graphics();
        b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}

        b.update = () => {
          // Offscreen cleanup
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) { try { b.destroy(); } catch (_) {} return; }

          // Guidance
          try {
            let desired = b._angle;
            const nowG = this.time.now;
            if (nowG >= (b._noTurnUntil || 0)) {
              if (b._smart) {
                // Maintain/refresh target within FOV; otherwise go straight
                const enemies = this.enemies?.getChildren?.() || [];
                const half = (b._fov || Math.PI / 2) / 2; // 45�?half-angle
                const norm = (a) => Phaser.Math.Angle.Wrap(a);
                const ang = norm(b._angle);
                // Validate existing target
                const validExisting = (t) => {
                  if (!t?.active) return false;
                  const a2 = Phaser.Math.Angle.Between(b.x, b.y, t.x, t.y);
                  const d = Math.abs(norm(a2 - ang));
                  return d <= half;
                };
                if (!validExisting(b._target)) {
                  b._target = null;
                  // Find nearest within FOV cone
                  let best = null; let bestD2 = Infinity;
                  for (let i = 0; i < enemies.length; i += 1) {
                    const e = enemies[i]; if (!e?.active) continue;
                    const a2 = Phaser.Math.Angle.Between(b.x, b.y, e.x, e.y);
                    const dAng = Math.abs(norm(a2 - ang));
                    if (dAng > half) continue;
                    const dx = e.x - b.x; const dy = e.y - b.y; const d2 = dx * dx + dy * dy;
                    if (d2 < bestD2) { best = e; bestD2 = d2; }
                  }
                  b._target = best;
                }
                if (b._target && b._target.active) {
                  desired = Phaser.Math.Angle.Between(b.x, b.y, b._target.x, b._target.y);
                } else {
                  // No target in cone: keep heading
                  desired = b._angle;
                }
              } else {
                // Follow cursor (default guided behavior)
                const ptr = this.inputMgr?.pointer;
                const tx = ptr?.worldX ?? (this.player.x + Math.cos(this.playerFacing) * 2000);
                const ty = ptr?.worldY ?? (this.player.y + Math.sin(this.playerFacing) * 2000);
                desired = Phaser.Math.Angle.Between(b.x, b.y, tx, ty);
              }
            } // else: within straight-flight window; keep current desired (= b._angle)
            const dt = (this.game?.loop?.delta || 16.7) / 1000;
            b._angle = Phaser.Math.Angle.RotateTo(b._angle, desired, (b._maxTurn || 0) * (60 * dt));
            const vx = Math.cos(b._angle) * b._speed;
            const vy = Math.sin(b._angle) * b._speed;
            b.setVelocity(vx, vy);
          } catch (_) {}

          // Draw small elongated orange body + tracer tail
          try {
            g.clear();
            const headX = b.x + Math.cos(b._angle) * 2;
            const headY = b.y + Math.sin(b._angle) * 2;
            const tailX = b.x - Math.cos(b._angle) * 8;
            const tailY = b.y - Math.sin(b._angle) * 8;
            // Body (thicker, short)
            const headMul = b._fullSize ? 3.5 : 2;
            const tailMul = b._fullSize ? 14 : 8;
            const bodyThick = b._fullSize ? 4 : 3;
            const tracerThick = b._fullSize ? 2 : 1;
            const headX2 = b.x + Math.cos(b._angle) * headMul;
            const headY2 = b.y + Math.sin(b._angle) * headMul;
            const tailX2 = b.x - Math.cos(b._angle) * tailMul;
            const tailY2 = b.y - Math.sin(b._angle) * tailMul;
            g.lineStyle(bodyThick, 0xff8800, 0.95);
            g.beginPath(); g.moveTo(tailX2 + Math.cos(b._angle) * 4, tailY2 + Math.sin(b._angle) * 4); g.lineTo(headX2, headY2); g.strokePath();
            g.lineStyle(tracerThick, 0xffddaa, 0.9);
            g.beginPath(); g.moveTo(tailX2, tailY2); g.lineTo(b.x, b.y); g.strokePath();
          } catch (_) {}
        };
        b.on('destroy', () => { try { b._g?.destroy(); } catch (_) {} });
      }
      return;
    }

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
        // Carry stun-on-hit value for direct impacts (from Stun Ammunitions)
        b._stunOnHit = weapon._stunOnHit || 0;
        // Smart Explosives core flags
        b._smartExplosives = !!weapon._smartExplosives;
        b._firefield = !!weapon._firefield;
        if (b._smartExplosives) {
          const scale = (typeof weapon._detectScale === 'number') ? weapon._detectScale : 0.65;
          b._detectR = Math.max(8, Math.floor((b._blastRadius || 70) * scale));
        }
        b._startX = startX; b._startY = startY;
        b._targetX = targetX; b._targetY = targetY;
        const sx = targetX - startX; const sy = targetY - startY;
        b._targetLen2 = sx * sx + sy * sy;
        b.update = () => {
          // Lifetime via camera view when walls are disabled
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) {
            // Do not cull mines off-screen; allow them to persist
            if (!b._mine) { try { b.destroy(); } catch (_) {} return; }
          }
          // Napalm (MGL incendiary) rocket: add orange tracer particles behind projectile
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
          // Smart Explosives: proximity detection and mine behavior
          if (b._smartExplosives) {
            const detR = b._detectR || Math.max(8, Math.floor((b._blastRadius || 70) * 0.65));
            const detR2 = detR * detR;
            const now = this.time.now;
            // If deployed as a mine, sit until enemy enters detection or expiry
            if (b._mine) {
              if (now >= (b._mineExpireAt || 0)) {
                // Expire by detonating rather than disappearing silently
                const ex = b.x; const ey = b.y;
                try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
                const radius = b._blastRadius || 70; const r2 = radius * radius;
                this.enemies.getChildren().forEach((other) => {
                  if (!other.active) return; const ddx = other.x - ex; const ddy = other.y - ey;
                  if ((ddx * ddx + ddy * ddy) <= r2) {
                    const aoe = (b._aoeDamage || b.damage || 10);
                    if (other.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + aoe; }
                    else { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= aoe; if (other.hp <= 0) { this.killEnemy(other); } }
                  }
                });
                this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
                if (b._firefield) {
                  this.spawnFireField(ex, ey, radius);
                  const r2n = radius * radius; const nowI = this.time.now;
                  this.enemies.getChildren().forEach((other) => {
                    if (!other?.active || other.isDummy) return;
                    const dxn = other.x - ex; const dyn = other.y - ey;
                    if ((dxn * dxn + dyn * dyn) <= r2n) {
                      other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                      if ((other._igniteValue || 0) >= 10) {
                        other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                        if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                        try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                      }
                    }
                  });
                }
                try { b.destroy(); } catch (_) {}
                return;
              }
              const arr = this.enemies?.getChildren?.() || [];
              for (let i = 0; i < arr.length; i += 1) {
                const e = arr[i]; if (!e?.active) continue;
                const dx = e.x - b.x; const dy = e.y - b.y;
                if ((dx * dx + dy * dy) <= detR2) {
                  const ex = b.x; const ey = b.y;
                  try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
                  const radius = b._blastRadius || 70; const r2 = radius * radius;
                  this.enemies.getChildren().forEach((other) => {
                    if (!other.active) return; const ddx = other.x - ex; const ddy = other.y - ey;
                    if ((ddx * ddx + ddy * ddy) <= r2) {
                      const aoe = (b._aoeDamage || b.damage || 10);
                      if (other.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + aoe; }
                      else { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= aoe; if (other.hp <= 0) { this.killEnemy(other); } }
                    }
                  });
                  this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
                  if (b._firefield) {
                    this.spawnFireField(ex, ey, radius);
                    const r2n = radius * radius; const nowI = this.time.now;
                    this.enemies.getChildren().forEach((other) => {
                      if (!other?.active || other.isDummy) return;
                      const dxn = other.x - ex; const dyn = other.y - ey;
                      if ((dxn * dxn + dyn * dyn) <= r2n) {
                        other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                        if ((other._igniteValue || 0) >= 10) {
                          other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                          if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                          try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                        }
                      }
                    });
                  }
                  try { b.destroy(); } catch (_) {}
                  return;
                }
              }
              // Stay as mine this frame
              return;
            }
            // While flying: proximity-detonate if any enemy within detect radius
            {
              const arr = this.enemies?.getChildren?.() || [];
              for (let i = 0; i < arr.length; i += 1) {
                const e = arr[i]; if (!e?.active) continue;
                const dx = e.x - b.x; const dy = e.y - b.y;
                if ((dx * dx + dy * dy) <= detR2) {
                  const ex = b.x; const ey = b.y;
                  try { impactBurst(this, ex, ey, { color: 0xffaa33, size: 'large', radius: b._blastRadius || 40 }); } catch (_) {}
                  const radius = b._blastRadius || 70; const r2 = radius * radius;
                  this.enemies.getChildren().forEach((other) => {
                    if (!other.active) return; const ddx = other.x - ex; const ddy = other.y - ey;
                    if ((ddx * ddx + ddy * ddy) <= r2) {
                      const aoe = (b._aoeDamage || b.damage || 10);
                      if (other.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + aoe; }
                      else { if (typeof other.hp !== 'number') other.hp = other.maxHp || 20; other.hp -= aoe; if (other.hp <= 0) { this.killEnemy(other); } }
                    }
                  });
                  this.damageSoftBarricadesInRadius(ex, ey, radius, (b._aoeDamage || b.damage || 10));
                  if (b._firefield) {
                    this.spawnFireField(ex, ey, radius);
                    const r2n = radius * radius; const nowI = this.time.now;
                    this.enemies.getChildren().forEach((other) => {
                      if (!other?.active || other.isDummy) return;
                      const dxn = other.x - ex; const dyn = other.y - ey;
                      if ((dxn * dxn + dyn * dyn) <= r2n) {
                        other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                        if ((other._igniteValue || 0) >= 10) {
                          other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                          if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                          try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                        }
                      }
                    });
                  }
                  try { b.destroy(); } catch (_) {}
                  return;
                }
              }
            }
          }
          // Check if reached or passed target point
          const dxs = (b.x - b._startX); const dys = (b.y - b._startY);
          const prog = dxs * (sx) + dys * (sy);
          const dx = b.x - b._targetX; const dy = b.y - b._targetY;
          const nearTarget = (dx * dx + dy * dy) <= 64; // within 8px
          const passed = prog >= b._targetLen2 - 1;
          if (nearTarget || passed) {
            if (b._smartExplosives) {
              // Become a mine if no enemy in detection radius
              b._mine = true;
              b._mineExpireAt = this.time.now + 8000; // safety timeout
              try { b.setVelocity(0, 0); } catch (_) {}
              try { b.body?.setVelocity?.(0, 0); } catch (_) {}
              try { b.setTint(0x55ff77); } catch (_) {}
              return;
            }
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
            if (b._firefield) {
              this.spawnFireField(ex, ey, radius);
              const r2n = radius * radius; const nowI = this.time.now;
              this.enemies.getChildren().forEach((other) => {
                if (!other?.active || other.isDummy) return;
                const dxn = other.x - ex; const dyn = other.y - ey;
                if ((dxn * dxn + dyn * dyn) <= r2n) {
                  other._igniteValue = Math.min(10, (other._igniteValue || 0) + 5);
                  if ((other._igniteValue || 0) >= 10) {
                    other._ignitedUntil = nowI + 2000; other._igniteValue = 0;
                    if (!other._igniteIndicator) { other._igniteIndicator = this.add.graphics(); try { other._igniteIndicator.setDepth(9000); } catch (_) {} other._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
                    try { other._igniteIndicator.setPosition(other.x, other.y - 14); } catch (_) {}
                  }
                }
              });
            }
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
      // Bullet tint: default white; Explosive Core uses orange bullets
      if (weapon._core === 'blast') b.setTint(0xff8800); else b.setTint(0xffffff);
      b.damage = weapon.damage;
      b._core = weapon._core || null;
      b._igniteOnHit = weapon._igniteOnHit || 0;
      b._toxinOnHit = weapon._toxinOnHit || 0;
      b._stunOnHit = weapon._stunOnHit || 0;
      if (b._core === 'pierce') { b._pierceLeft = 1; }
      // Tracer setup: particle thruster for stun/toxin/incendiary; blue line for pierce core
      try {
        // Particle tracer colors
        const tracerColor = (() => {
          if (b._toxinOnHit > 0) return 0x33ff66; // green
          if (b._igniteOnHit > 0) return 0xffaa33; // orange
          if (b._stunOnHit > 0) return 0xffee66; // yellow
          return null;
        })();
        if (b._core === 'pierce') {
          const g = this.add.graphics(); b._g = g; try { g.setDepth(8000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          b.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
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
          // Emit stronger thruster-like particles behind the bullet each frame
          b.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
            try {
              const vx0 = b.body?.velocity?.x || vx; const vy0 = b.body?.velocity?.y || vy;
              const back = Math.atan2(vy0, vx0) + Math.PI;
              const ex = b.x + Math.cos(back) * 5; const ey = b.y + Math.sin(back) * 5;
              // Scale tracer strength by effect type
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
          b.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
          };
          b.on('destroy', () => b._g?.destroy());
        }
      } catch (_) {
        b.update = () => {
          const view = this.cameras?.main?.worldView;
          if (view && !view.contains(b.x, b.y)) { b.destroy(); return; }
        };
      }
      b.on('destroy', () => b._g?.destroy());
    }
    // Burst Fire core: schedule additional shots within a short window
    if (weapon._burstN && weapon._burstN > 1) {
      const wid = this.gs.activeWeapon;
      const ang = baseAngle;
      const perGap = Math.max(30, weapon._burstGapMs || 70);
      for (let k = 1; k < weapon._burstN; k += 1) {
        this.time.delayedCall(perGap * k, () => {
          if (this.gs.activeWeapon !== wid) return;
          const cap = this.getActiveMagCapacity();
          this.ensureAmmoFor(wid, cap);
          const ammo = this.ammoByWeapon[wid] ?? 0;
          if (ammo <= 0 || this.reload.active) return;
          const effSpeed = Math.floor((weapon.bulletSpeed || 0) * 1.25);
          const vx = Math.cos(ang) * effSpeed;
          const vy = Math.sin(ang) * effSpeed;
          const m = getWeaponMuzzleWorld(this, 3);
          try {
            const wid = this.gs.activeWeapon;
            const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','rocket']);
            if (allowed.has(wid)) {
              const heavy = new Set(['smart_hmg','guided_missiles','rocket','shotgun','mgl']);
              if (heavy.has(wid)) muzzleFlashSplit(this, m.x, m.y, { angle: ang, color: 0xffee66, count: 3, spreadDeg: 24, length: 16, thickness: 4 });
              else if (wid === 'battle_rifle') muzzleFlash(this, m.x, m.y, { angle: ang, color: 0xffee66, length: 14, thickness: 4 });
              else muzzleFlash(this, m.x, m.y, { angle: ang, color: 0xffee66, length: 10, thickness: 3 });
              // Burst yellow muzzle pixels for bursts (wider overall, special battle rifle)
              const base = ang;
              if (heavy.has(wid)) {
                const burst = { spreadDeg: 36, speedMin: 130, speedMax: 260, lifeMs: 180, color: 0xffee66, size: 2, alpha: 0.75 };
                pixelSparks(this, m.x, m.y, { angleRad: base, count: 12, ...burst });
              } else if (wid === 'battle_rifle') {
                const burst = { spreadDeg: 30, speedMin: 125, speedMax: 230, lifeMs: 185, color: 0xffee66, size: 2, alpha: 0.85 };
                pixelSparks(this, m.x, m.y, { angleRad: base, count: 10, ...burst });
              } else {
                const burst = { spreadDeg: 28, speedMin: 100, speedMax: 190, lifeMs: 165, color: 0xffee66, size: 1, alpha: 0.7 };
                pixelSparks(this, m.x, m.y, { angleRad: base, count: 8, ...burst });
              }
            }
          } catch (_) {}
          const bN = this.bullets.get(m.x, m.y, 'bullet');
          if (!bN) return;
          bN.setActive(true).setVisible(true);
          bN.setCircle(2).setOffset(-2, -2);
          bN.setVelocity(vx, vy);
          bN.setTint(0xffffff);
          bN.damage = weapon.damage;
          bN._core = weapon._core || null;
          bN._igniteOnHit = weapon._igniteOnHit || 0;
          bN._toxinOnHit = weapon._toxinOnHit || 0;
          bN._stunOnHit = weapon._stunOnHit || 0;
          if (bN._core === 'pierce') { bN._pierceLeft = 1; }
          bN.update = () => {
            const view = this.cameras?.main?.worldView;
            if (view && !view.contains(bN.x, bN.y)) { try { bN.destroy(); } catch (_) {} }
          };
          bN.on('destroy', () => bN._g?.destroy());
          // consume ammo and sync UI
          this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
          this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
        });
      }
    }
    // 2Tap Trigger: schedule an automatic second accurate shot shortly after
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
          const wid = this.gs.activeWeapon;
          const allowed = new Set(['pistol','mgl','rifle','battle_rifle','shotgun','smg','guided_missiles','smart_hmg','rocket']);
          if (allowed.has(wid)) {
            const heavy = new Set(['smart_hmg','guided_missiles','rocket','shotgun','mgl']);
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
         // Tint rules match primary: Explosive Core turns bullet orange
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
                const tail = 10;
                const tx = b2.x - Math.cos(ang) * tail; const ty = b2.y - Math.sin(ang) * tail;
                g2.lineStyle(3, 0x2266ff, 0.5).beginPath().moveTo(tx, ty).lineTo(b2.x, b2.y).strokePath();
                g2.lineStyle(1, 0xaaddff, 0.9).beginPath().moveTo(tx + Math.cos(ang) * 2, ty + Math.sin(ang) * 2).lineTo(b2.x, b2.y).strokePath();
              } catch (_) {}
            };
            b2.on('destroy', () => { try { b2._g?.destroy(); } catch (_) {} });
          } else if (tracerColor2 && weapon._core !== 'blast') {
            // Stronger tracer on burst bullets too
            b2.update = () => {
              const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} return; }
              try {
                const vx0 = b2.body?.velocity?.x || vx; const vy0 = b2.body?.velocity?.y || vy;
                const back = Math.atan2(vy0, vx0) + Math.PI;
                const ex = b2.x + Math.cos(back) * 5; const ey = b2.y + Math.sin(back) * 5;
                const isIgnite = (b2._igniteOnHit || 0) > 0;
                const isToxin  = (b2._toxinOnHit  || 0) > 0;
                const isStun   = (b2._stunOnHit   || 0) > 0;
                let count = 2, size = 2, lifeMs = 100, speedMin = 90, speedMax = 180, alpha = 0.9;
                if (isIgnite) { count = 3; size = 2; lifeMs = 120; speedMin = 100; speedMax = 200; alpha = 0.95; }
                else if (isToxin) { count = 2; size = 2; lifeMs = 110; speedMin = 90; speedMax = 190; alpha = 0.92; }
                else if (isStun) { count = 2; size = 2; lifeMs = 100; speedMin = 90; speedMax = 180; alpha = 0.9; }
                pixelSparks(this, ex, ey, { angleRad: back, count, spreadDeg: 8, speedMin, speedMax, lifeMs, color: tracerColor2, size, alpha });
              } catch (_) {}
            };
            b2.on('destroy', () => b2._g?.destroy());
          } else {
            b2.update = () => {
              const view = this.cameras?.main?.worldView;
              if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} }
            };
            b2.on('destroy', () => b2._g?.destroy());
          }
        } catch (_) {
          b2.update = () => {
            const view = this.cameras?.main?.worldView; if (view && !view.contains(b2.x, b2.y)) { try { b2.destroy(); } catch (_) {} }
          };
        }
        b2.on('destroy', () => b2._g?.destroy());
        // consume ammo and sync UI
        this.ammoByWeapon[wid] = Math.max(0, ammo - 1);
        this.registry.set('ammoInMag', this.ammoByWeapon[wid]);
      });
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
      // Initialize dash trail start
      this._dashTrailLast = { x: this.player.x, y: this.player.y };
      // consume charge and queue regen
      this.dash.charges -= 1;
      this.dash.regen.push(now + (eff.dashRegenMs || this.gs.dashRegenMs));
    }

    if (this.dash.active && now < this.dash.until) {
      // Draw a fading white tracer behind the player while dashing
      try {
        if (this._dashTrailLast) {
          const g = this.add.graphics();
          try { g.setDepth(9800); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
          g.lineStyle(4, 0xffffff, 0.9);
          g.beginPath(); g.moveTo(this._dashTrailLast.x, this._dashTrailLast.y); g.lineTo(this.player.x, this.player.y); g.strokePath();
          this.tweens.add({ targets: g, alpha: 0, duration: 220, ease: 'Quad.easeOut', onComplete: () => { try { g.destroy(); } catch (_) {} } });
          this._dashTrailLast.x = this.player.x; this._dashTrailLast.y = this.player.y;
        }
      } catch (_) {}
      this.player.setVelocity(this.dash.vx, this.dash.vy);
    } else {
      this.dash.active = false;
      this._dashTrailLast = null;
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
    const isLaser = !!weapon.isLaser;
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
      // Expand dummy interaction to a radius around it instead of strict sprite-bounds overlap
      const nearDummy = !!(this.dummy && (() => { const dx = this.player.x - this.dummy.x; const dy = this.player.y - this.dummy.y; const r = 72; return (dx * dx + dy * dy) <= (r * r); })());
      if (nearTerminal) this.prompt.setText('E: Open Terminal');
      else if (nearDummy) this.prompt.setText('E: Reset Dummy Damage/Effects');
      else if (nearPortal) this.prompt.setText('E: Return to Hub');
      else this.prompt.setText('Shooting Range');

      if (this.inputMgr.pressedInteract) {
        if (nearTerminal) this.openTerminalPanel?.();
        if (nearDummy) {
          this._dummyDamage = 0;
          if (this.dummy?.active) {
            const d = this.dummy;
            d._igniteValue = 0; d._toxinValue = 0; d._stunValue = 0;
            d._ignitedUntil = 0; d._toxinedUntil = 0; d._stunnedUntil = 0;
            d._toxinPartial = 0;
            try { if (d._igniteIndicator) { d._igniteIndicator.destroy(); } } catch (_) {}
            try { if (d._toxinIndicator) { d._toxinIndicator.destroy(); } } catch (_) {}
            try { if (d._stunIndicator) { d._stunIndicator.destroy(); } } catch (_) {}
            d._igniteIndicator = null; d._toxinIndicator = null; d._stunIndicator = null;
          }
        }
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
    if (this.inputMgr.isLMBDown && !weapon.singleFire && !isRail && !isLaser) {
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
    // Laser handling (continuous)
    if (isLaser) {
      this.handleLaser(this.time.now, weapon, ptr, dt);
    }
    const wantsShot = (!isRail && !isLaser) && (weapon.singleFire ? wantsClick : this.inputMgr.isLMBDown);
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
        // Auto-reload for rocket launcher (mag size 1)
        if (wid === 'rocket' && this.ammoByWeapon[wid] <= 0) {
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
    this._lmbWasDown = !!ptr.isDown;

    // Swap weapons with Q (only when two are equipped)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.q)) {
      const slots = this.gs.equippedWeapons || [];
      const a = this.gs.activeWeapon;
      if (slots[0] && slots[1]) {
        this.gs.activeWeapon = a === slots[0] ? slots[1] : slots[0];
        // Cancel any in-progress reload on weapon swap
        this.reload.active = false;
        this.reload.duration = 0;
        this.registry.set('reloadActive', false);
        // Cancel rail charging/aim if any
        try { if (this.rail?.charging) this.rail.charging = false; } catch (_) {}
        this.endRailAim?.();
        // Clear laser beam if present
        try { this.laser?.g?.clear?.(); } catch (_) {}
      }
    }

    // Manual reload (R)
    if (Phaser.Input.Keyboard.JustDown(this.inputMgr.keys.r)) {
      const cap = this.getActiveMagCapacity();
      const wid = this.gs.activeWeapon;
      this.ensureAmmoFor(wid, cap);
      if (!weapon.isLaser && !this.reload.active && (this.ammoByWeapon[wid] ?? 0) < cap) {
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = this.time.now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
      // For laser: allow manual cooldown cancel if overheated
      if (weapon.isLaser && this.laser?.overheat) {
        // no-op: keep forced cooldown
      }
    }

    // Ability activation (F)
    if (this.inputMgr.pressedAbility) {
      const nowT = this.time.now;
      if (nowT >= (this.ability.onCooldownUntil || 0)) {
        const abilityId = this.gs?.abilityId || 'ads';
        if (abilityId === 'ads') {
          this.deployADS();
          this.ability.cooldownMs = 10000;
          this.ability.onCooldownUntil = nowT + this.ability.cooldownMs;
        } else if (abilityId === 'bits') {
          this.deployBITs();
          this.ability.cooldownMs = 10000;
          this.ability.onCooldownUntil = nowT + this.ability.cooldownMs;
        } else if (abilityId === 'repulse') {
          this.deployRepulsionPulse();
          this.ability.cooldownMs = 5000; // 5s for Repulsion Pulse
          this.ability.onCooldownUntil = nowT + this.ability.cooldownMs;
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
          const arrB = this.enemyBullets?.getChildren?.() || [];
          const arrG = this.enemyGrenades?.getChildren?.() || [];
          for (let i = 0; i < arrB.length; i += 1) {
            const b = arrB[i]; if (!b?.active) continue;
            const dx = b.x - g.x; const dy = b.y - g.y; const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD2) { best = b; bestD2 = d2; }
          }
          for (let i = 0; i < arrG.length; i += 1) {
            const b = arrG[i]; if (!b?.active) continue;
            const dx = b.x - g.x; const dy = b.y - g.y; const d2 = dx * dx + dy * dy;
            if (d2 <= r2 && d2 < bestD2) { best = b; bestD2 = d2; }
          }
          if (best) {
            // Draw instant blue laser then destroy the projectile
            try {
              const lg = this.add.graphics();
              lg.setDepth(9000);
              lg.lineStyle(1, 0x66aaff, 1);
              const sx = g.x, sy = g.y - 4;
              lg.beginPath(); lg.moveTo(sx, sy); lg.lineTo(best.x, best.y); lg.strokePath();
              lg.setAlpha(1);
              try {
                this.tweens.add({ targets: lg, alpha: 0, duration: 320, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
              } catch (_) {
                this.time.delayedCall(320, () => { try { lg.destroy(); } catch (__ ) {} });
              }
              // Tiny blue particle at impact point
              try { impactBurst(this, best.x, best.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
              // Blue pixel spray at laser origin (shorter but much wider)
              try { const ang = Phaser.Math.Angle.Between(sx, sy, best.x, best.y); pixelSparks(this, sx, sy, { angleRad: ang, count: 6, spreadDeg: 60, speedMin: 90, speedMax: 140, lifeMs: 110, color: 0x66aaff, size: 2, alpha: 0.9 }); } catch (_) {}
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
      const denom = this.ability?.cooldownMs || 10000;
      const remaining = Math.max(0, until - nowT2);
      const prog = active ? (1 - Math.min(1, remaining / denom)) : 1;
      this.registry.set('abilityCooldownActive', active);
    this.registry.set('abilityCooldownProgress', prog);
    } catch (_) {}

    // Ignite burn ticking (global): apply burn DPS to ignited enemies
    this._igniteTickAccum = (this._igniteTickAccum || 0) + dt;
    const burnTick = 0.1; // 10 Hz for smoothness without perf hit
    if (this._igniteTickAccum >= burnTick) {
      const step = this._igniteTickAccum; // accumulate any leftover
      this._igniteTickAccum = 0;
      const enemies = this.enemies?.getChildren?.() || [];
      const burnDps = 30;
      const dmg = Math.max(0, Math.round(burnDps * step));
      const nowT = this.time.now;
      for (let i = 0; i < enemies.length; i += 1) {
        const e = enemies[i]; if (!e?.active) continue;
        if (e._ignitedUntil && nowT < e._ignitedUntil) {
          if (!e.isDummy) {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= dmg;
            if (e.hp <= 0) this.killEnemy(e);
          } else {
            this._dummyDamage = (this._dummyDamage || 0) + dmg;
          }
          // maintain indicator position
          if (e._igniteIndicator?.setPosition) {
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        } else {
          // hide indicator if present
          if (e._igniteIndicator) { try { e._igniteIndicator.destroy(); } catch (_) {} e._igniteIndicator = null; }
        }
      }
    }

    // Toxin ticking (global): apply 3 DPS and manage indicator/disorientation window
    this._toxinTickAccum = (this._toxinTickAccum || 0) + dt;
    const toxinTick = 0.1;
    if (this._toxinTickAccum >= toxinTick) {
      const step = this._toxinTickAccum; this._toxinTickAccum = 0;
      const dps = 3;
      const nowT = this.time.now;
      const enemies = this.enemies?.getChildren?.() || [];
      for (let i = 0; i < enemies.length; i += 1) {
        const e = enemies[i]; if (!e?.active) continue;
        if (e._toxinedUntil && nowT < e._toxinedUntil) {
          // Accumulate fractional toxin damage per-entity to avoid rounding-away low DPS
          const prev = (e._toxinPartial || 0);
          const inc = dps * step;
          const total = prev + inc;
          const dmgInt = Math.floor(total);
          e._toxinPartial = total - dmgInt;
          if (dmgInt > 0) {
            if (e.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + dmgInt;
            } else {
              if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
              e.hp -= dmgInt;
              if (e.hp <= 0) this.killEnemy(e);
            }
          }
          // Maintain indicator position
          if (e._toxinIndicator?.setPosition) { try { e._toxinIndicator.setPosition(e.x, e.y - 18); } catch (_) {} }
        } else {
          // Cleanup indicator
          if (e._toxinIndicator) { try { e._toxinIndicator.destroy(); } catch (_) {} e._toxinIndicator = null; }
          // Reset partial accumulator when effect ends
          e._toxinPartial = 0;
        }
      }
    }

    // Stun indicator maintenance (no DPS; ensures indicator position and cleanup)
    this._stunTickAccum = (this._stunTickAccum || 0) + dt;
    const stunTick = 0.1;
    if (this._stunTickAccum >= stunTick) {
      this._stunTickAccum = 0;
      const nowT = this.time.now;
      const enemies = this.enemies?.getChildren?.() || [];
      for (let i = 0; i < enemies.length; i += 1) {
        const e = enemies[i]; if (!e?.active) continue;
        if (e._stunnedUntil && nowT < e._stunnedUntil) {
          if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
          try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
        } else {
          if (e._stunIndicator) { try { e._stunIndicator.destroy(); } catch (_) {} e._stunIndicator = null; }
        }
      }
    }

    // Update fire fields (ignite zones)
    if (!this._ffTickAccum) this._ffTickAccum = 0;
    this._ffTickAccum += dt;
    const ffTick = 0.1;
    if (this._ffTickAccum >= ffTick) {
      const step = this._ffTickAccum; this._ffTickAccum = 0;
      const ignitePerSec = 10; const igniteAdd = ignitePerSec * step;
      const nowT = this.time.now;
      this._firefields = (this._firefields || []).filter((f) => {
        if (nowT >= f.until) { try { f.g?.destroy(); } catch (_) {} try { f.pm?.destroy(); } catch (_) {} return false; }
        // Visual flicker/pulse + redraw
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
        // Tick ignite within radius
        const r2 = f.r * f.r; const arr = this.enemies?.getChildren?.() || [];
        for (let i = 0; i < arr.length; i += 1) {
          const e = arr[i]; if (!e?.active) continue;
          const dx = e.x - f.x; const dy = e.y - f.y; if ((dx * dx + dy * dy) <= r2) {
            e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
            if ((e._igniteValue || 0) >= 10) {
              e._ignitedUntil = nowT + 2000; // refresh while inside
              e._igniteValue = 0; // reset on trigger
              if (!e._igniteIndicator) { e._igniteIndicator = this.add.graphics(); try { e._igniteIndicator.setDepth(9000); } catch (_) {} e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2); }
              try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
            }
          }
        }
        return true;
      });
    }

    // Update Repulsion Pulse effects (block enemy projectiles and push enemies)
    if (this._repulses && this._repulses.length) {
      const dt2 = (this.game?.loop?.delta || 16.7) / 1000;
      this._repulses = this._repulses.filter((rp) => {
        rp.r += rp.speed * dt2;
        try {
          rp.g.clear();
          rp.g.setBlendMode?.(Phaser.BlendModes.ADD);
          // Trail cache of previous radii for drag effect
          const now = this.time.now;
          if (rp._lastTrailR === undefined) rp._lastTrailR = 0;
          if (!rp._trail) rp._trail = [];
          if ((rp.r - rp._lastTrailR) > 10) { rp._trail.push({ r: rp.r, t: now }); rp._lastTrailR = rp.r; }
          // Keep last few rings
          while (rp._trail.length > 6) rp._trail.shift();
          // Draw trail rings (older = fainter)
          const colTrail = (rp.colTrail !== undefined ? rp.colTrail : 0xffaa33);
          const colOuter = (rp.colOuter !== undefined ? rp.colOuter : 0xffaa33);
          const colInner = (rp.colInner !== undefined ? rp.colInner : 0xffdd88);
          const colSpark = (rp.colSpark !== undefined ? rp.colSpark : 0xffaa66);
          const colPixel = (rp.colPixel !== undefined ? rp.colPixel : 0xffaa33);
          const colImpact = (rp.colImpact !== undefined ? rp.colImpact : 0xffaa33);
          for (let i = 0; i < rp._trail.length; i += 1) {
            const it = rp._trail[i];
            const age = (now - it.t) / 300; // 0..~
            const a = Math.max(0, 0.22 * (1 - Math.min(1, age)));
            if (a <= 0) continue;
            rp.g.lineStyle(6, colTrail, a).strokeCircle(0, 0, it.r);
          }
          // Current ring: bright thin edge + faint outer halo
          rp.g.lineStyle(8, colOuter, 0.20).strokeCircle(0, 0, rp.r);
          rp.g.lineStyle(3, colInner, 0.95).strokeCircle(0, 0, Math.max(1, rp.r - 1));
          // Periodic sparks along the band (denser for a lively pulse)
          if (!rp._nextSparkAt) rp._nextSparkAt = now;
          if (now >= rp._nextSparkAt) {
            const sparks = 8;
            for (let s = 0; s < sparks; s += 1) {
              const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const sx = rp.x + Math.cos(a) * rp.r;
              const sy = rp.y + Math.sin(a) * rp.r;
              try { pulseSpark(this, sx, sy, { color: colSpark, size: 2, life: 180 }); } catch (_) {}
              try { pixelSparks(this, sx, sy, { angleRad: a, count: 1, spreadDeg: 6, speedMin: 90, speedMax: 160, lifeMs: 160, color: colPixel, size: 2, alpha: 0.8 }); } catch (_) {}
            }
            rp._nextSparkAt = now + 28; // faster cadence
          }
        } catch (_) {}
        const band = rp.band;
        const r2min = (rp.r - band) * (rp.r - band);
        const r2max = (rp.r + band) * (rp.r + band);
        // Block enemy bullets in the band
        try {
          const arrB = this.enemyBullets?.getChildren?.() || [];
          for (let i = 0; i < arrB.length; i += 1) {
            const b = arrB[i]; if (!b?.active) continue; const dx = b.x - rp.x; const dy = b.y - rp.y; const d2 = dx * dx + dy * dy;
            if (d2 >= r2min && d2 <= r2max) { try { impactBurst(this, b.x, b.y, { color: colImpact, size: 'small' }); } catch (_) {} try { b.destroy(); } catch (_) {} }
          }
        } catch (_) {}
        // Push enemies and apply 5 dmg once per enemy per pulse
        try {
          if (!rp._hitSet) rp._hitSet = new Set();
          if (!rp._pushedSet) rp._pushedSet = new Set();
          const arrE = this.enemies?.getChildren?.() || [];
          for (let i = 0; i < arrE.length; i += 1) {
            const e = arrE[i]; if (!e?.active) continue;
            // If already pushed by this pulse, skip entirely; also skip while under any active knockback window
            const nowPush = this.time.now;
            if (rp._pushedSet.has(e)) continue;
            if (nowPush < (e._repulseUntil || 0)) continue;
            const dx = e.x - rp.x; const dy = e.y - rp.y; const d2 = dx * dx + dy * dy; if (d2 >= r2min && d2 <= r2max) {
              const d = Math.sqrt(d2) || 1; const nx = dx / d; const ny = dy / d; const power = 240;
              // Apply 1s knockback velocity; let physics/barricades handle collisions
              if (!e.isDummy) {
                e._repulseUntil = nowPush + 1000;
                e._repulseVX = nx * power; e._repulseVY = ny * power;
                try { e.body?.setVelocity?.(e._repulseVX, e._repulseVY); } catch (_) { try { e.setVelocity(e._repulseVX, e._repulseVY); } catch (_) {} }
              }
              // Mark this enemy as pushed for this pulse so re-contacts do not refresh/pile up
              rp._pushedSet.add(e);
              if (!rp._hitSet.has(e)) {
                rp._hitSet.add(e);
                if (e.isDummy) { this._dummyDamage = (this._dummyDamage || 0) + 5; }
                else {
                  if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
                  e.hp -= 5;
                  if (e.hp <= 0) { try { this.killEnemy(e); } catch (_) {} }
                }
              }
            }
          }
        } catch (_) {}
        if (rp.r >= rp.maxR) { try { rp.g.destroy(); } catch (_) {} return false; }
        return true;
      });
    }

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
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} try { bit._thr?.destroy?.(); } catch (_) {} return false; }
          const sp = 420;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;           try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // Smooth sprite rotation to reduce jitter while hovering
          try {
            const targetAng = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx));
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, targetAng, Phaser.Math.DegToRad(12)) : targetAng;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster draw
          try {
            const g = bit._thr; if (g) {
              const vx = bit.vx || 0, vy = bit.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear();
              if (spd > 40) {
                const tAng = Math.atan2(vy, vx);
                bit._thrAng = (typeof bit._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(bit._thrAng, tAng, Phaser.Math.DegToRad(10)) : tAng;
                const ux = Math.cos(bit._thrAng), uy = Math.sin(bit._thrAng);
                const tail = 8, stub = 4;
                const tx = bit.x - ux * tail, ty = bit.y - uy * tail;
                const sx2 = bit.x - ux * stub, sy2 = bit.y - uy * stub;
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
                // removed static blue thruster lines (use particles only)
                // Yellow compact thruster particles (smaller/shorter)
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              }
            }
          } catch (_) {}
          dx = this.player.x - bit.x; dy = this.player.y - bit.y; len = Math.hypot(dx, dy) || 1;
          if (len < 12) { try { bit.g.destroy(); } catch (_) {} try { bit._thr?.destroy?.(); } catch (_) {} return false; }
          return true;
        }
        // Spawn scatter animation: keep initial outward motion briefly before any idle/lock logic
        if (bit.spawnScatterUntil && now < bit.spawnScatterUntil) {
          bit.x += (bit.vx || 0) * dt; bit.y += (bit.vy || 0) * dt;           try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // Smooth rotation during scatter
          try {
            const targetAng = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2((bit.vy || 0), (bit.vx || 0)));
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, targetAng, Phaser.Math.DegToRad(14)) : targetAng;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster draw
          try {
            const g = bit._thr; if (g) {
              const vx = bit.vx || 0, vy = bit.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear();
              if (spd > 40) {
                const tAng = Math.atan2(vy, vx);
                bit._thrAng = (typeof bit._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(bit._thrAng, tAng, Phaser.Math.DegToRad(10)) : tAng;
                const ux = Math.cos(bit._thrAng), uy = Math.sin(bit._thrAng);
                // removed static blue thruster lines (use particles only)
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              }
            }
          } catch (_) {}
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
          if (bit._idleRadius === undefined) bit._idleRadius = Phaser.Math.Between(28, 48);
          if (bit._idleSpeed === undefined) bit._idleSpeed = Phaser.Math.FloatBetween(2.0, 3.2); // rad/s
          bit._idleAngle += bit._idleSpeed * dt;
          const px = this.player.x; const py = this.player.y;
          const tx = px + Math.cos(bit._idleAngle) * bit._idleRadius;
          const ty = py + Math.sin(bit._idleAngle) * bit._idleRadius;
          const dx = tx - bit.x; const dy = ty - bit.y; const len = Math.hypot(dx, dy) || 1;
          const sp = 260;
          bit.vx = (dx / len) * sp; bit.vy = (dy / len) * sp;
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;
          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          // In idle, face along orbit tangent to avoid jitter from small velocity changes
          try {
            const tangent = Math.atan2(ty - py, tx - px) + Math.PI / 2;
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, tangent, Phaser.Math.DegToRad(12)) : tangent;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster tail aligned with facing (single-sided)
          try {
            const g = bit._thr; if (g) {
              g.clear();
              const ux = Math.cos(bit._rot), uy = Math.sin(bit._rot);
              const tail = 8, stub = 4;
              const tx2 = bit.x - ux * tail, ty2 = bit.y - uy * tail;
              const sx2 = bit.x - ux * stub, sy2 = bit.y - uy * stub;
                try { const back = tAng + Math.PI; pixelSparks(this, bit.x, bit.y, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              // Only yellow compact thruster particles in idle orbit
              try { const back = bit._rot + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
            }
          } catch (_) {}
          return true;
        }
        // Firing hold
        if (now < (bit.holdUntil || 0)) {
          // stay still; face target if present
          if (trg) { try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {} }
          // emit compact yellow thruster while attacking (opposite the laser/enemy direction)
          try {
            const laserAng = trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) : Math.atan2(bit.vy || 0, bit.vx || 0);
            const back = laserAng + Math.PI;
            { const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); }
          } catch (_) {}
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
            // Blue pixel spray at bit laser origin (shorter, much wider, and more intense)
            try { const ang = Phaser.Math.Angle.Between(bit.x, bit.y, trg.x, trg.y); pixelSparks(this, bit.x, bit.y, { angleRad: ang, count: 12, spreadDeg: 70, speedMin: 110, speedMax: 200, lifeMs: 110, color: 0x66aaff, size: 2, alpha: 0.95 }); } catch (_) {}
            try { impactBurst(this, trg.x, trg.y, { color: 0x66aaff, size: 'small' }); } catch (_) {}
            try { bit.g.setRotation(Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI); } catch (_) {}
            // Apply damage (count on dummy instead of reducing HP)
            if (trg.isDummy) {
              this._dummyDamage = (this._dummyDamage || 0) + 7;
            } else {
              if (typeof trg.hp !== 'number') trg.hp = trg.maxHp || 20;
              trg.hp -= 7; if (trg.hp <= 0) { try { this.killEnemy(trg); } catch (_) {} }
            }
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
          bit.x += bit.vx * dt; bit.y += bit.vy * dt;          try { bit.g.setPosition(bit.x, bit.y); } catch (_) {}
          try {
            const targetAng = (trg ? Math.atan2(trg.y - bit.y, trg.x - bit.x) + Math.PI : Math.atan2(bit.vy, bit.vx));
            bit._rot = (typeof bit._rot === 'number') ? Phaser.Math.Angle.RotateTo(bit._rot, targetAng, Phaser.Math.DegToRad(12)) : targetAng;
            bit.g.setRotation(bit._rot);
          } catch (_) {}
          // Thruster draw
          try {
            const g = bit._thr; if (g) {
              const vx = bit.vx || 0, vy = bit.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear();
              if (spd > 40) {
                const tAng = Math.atan2(vy, vx);
                bit._thrAng = (typeof bit._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(bit._thrAng, tAng, Phaser.Math.DegToRad(10)) : tAng;
                const ux = Math.cos(bit._thrAng), uy = Math.sin(bit._thrAng);
                const tail = 8, stub = 4; const tx = bit.x - ux * tail, ty = bit.y - uy * tail; const sx2 = bit.x - ux * stub, sy2 = bit.y - uy * stub;
                try { const back = tAng + Math.PI; const ex = bit.x + Math.cos(back) * 6; const ey = bit.y + Math.sin(back) * 6; pixelSparks(this, ex, ey, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
                // particles-only thruster (remove static blue lines)\r
                try { const back = tAng + Math.PI; pixelSparks(this, bit.x, bit.y, { angleRad: back, count: 1, spreadDeg: 4, speedMin: 60, speedMax: 110, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 }); } catch (_) {}
              }
            }
          } catch (_) {}
        }
        return true;
      });
    }

    // Update WASP BITS (armour-driven, persistent)
    const hasWaspArmour = (this.gs?.armour?.id === 'wasp_bits');
    if (!hasWaspArmour) {
      // Clean up if armour unequipped
      if (this._wasps && this._wasps.length) {
        try { this._wasps.forEach((w) => { try { w?.g?.destroy?.(); } catch (_) {} try { w?._thr?.destroy?.(); } catch (_) {} }); } catch (_) {}
        this._wasps = [];
      }
    } else {
      if (!this._wasps) this._wasps = [];
      // Ensure exactly 2 wasps exist
      const need = 2 - this._wasps.length;
      for (let i = 0; i < need; i += 1) {
        const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
        try { g.setDepth(9000); g.setTint(0xffff66); } catch (_) {}
        const w = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g,
          state: 'idle', target: null,
          hoverUntil: 0, dashUntil: 0, lastDashAt: 0, dashHit: false, didFinalDash: false,
          _hoverAngle: Phaser.Math.FloatBetween(0, Math.PI * 2), _hoverR: Phaser.Math.Between(16, 36), _hoverChangeAt: 0 };
        try { w._thr = this.add.graphics(); w._thr.setDepth(8800); w._thr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
        this._wasps.push(w);
      }
      // Update each wasp
      if (this._wasps.length) {
        const dt = (this.game?.loop?.delta || 16.7) / 1000;
        const now = this.time.now;
        // Reduced detection radius per request
        const detectR = 200; const detectR2 = detectR * detectR;
        const enemiesArr = this.enemies?.getChildren?.() || [];
        this._wasps = this._wasps.filter((w) => {
          if (!w?.g?.active) { try { w?._thr?.destroy?.(); } catch (_) {} return false; }
          // Acquire/validate target based on player-centric radius
          if (!w.target || !w.target.active) {
            w.target = null; w.didFinalDash = false;
            let best = null; let bestD2 = Infinity;
            for (let i = 0; i < enemiesArr.length; i += 1) {
              const e = enemiesArr[i]; if (!e?.active) continue; if (e.isBoss) continue;
              const dxp = e.x - this.player.x; const dyp = e.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
              if (d2p <= detectR2) {
                const dx = e.x - w.x; const dy = e.y - w.y; const d2 = dx * dx + dy * dy;
                if (d2 < bestD2) { best = e; bestD2 = d2; }
              }
            }
            w.target = best;
          } else {
            const dxp = w.target.x - this.player.x; const dyp = w.target.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
            if (d2p > detectR2) {
              // Target left detection radius: mark for one final dash
              if (!w.didFinalDash) {
                // will be handled by dash planner below
              } else {
                w.target = null; w.state = 'idle'; w.didFinalDash = false;
              }
            }
          }

          const t = w.target;
          // Dash update when active (straight line)
          if (w.state === 'dashing') {
            const px = w.x; const py = w.y;
            w.x += (w.vx || 0) * dt; w.y += (w.vy || 0) * dt; try { w.g.setPosition(w.x, w.y); } catch (_) {}
            try { w.g.setRotation(Math.atan2(w.y - py, w.x - px) + Math.PI); } catch (_) {}
            // Thruster while dashing as well (subtle)
            try { const g = w._thr; if (g) { g.clear(); const vx = w.vx || 0, vy = w.vy || 0; const spd = Math.hypot(vx, vy) || 1; const ux = vx / spd, uy = vy / spd; const tail = 10; const stub = 5; const tx = w.x - ux * tail; const ty = w.y - uy * tail; const sx = w.x - ux * stub; const sy = w.y - uy * stub; try { const g = w._thr; if (g) { g.clear(); } } catch (_) {} } } catch (_) {}
            // Yellow compact thruster particles behind WASP bit while dashing (emit from rear with smoothing)
            try {
              const sp2 = (w.vx||0)*(w.vx||0) + (w.vy||0)*(w.vy||0);
              const desired = (sp2 > 1) ? (Math.atan2(w.vy || 0, w.vx || 0) + Math.PI) : ((w._rot || 0) + Math.PI);
              w._thrBackAng = (typeof w._thrBackAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrBackAng, desired, Phaser.Math.DegToRad(12)) : desired;
              const ex = w.x + Math.cos(w._thrBackAng) * 6;
              const ey = w.y + Math.sin(w._thrBackAng) * 6;
              pixelSparks(this, ex, ey, { angleRad: w._thrBackAng, count: 1, spreadDeg: 4, speedMin: 70, speedMax: 120, lifeMs: 50, color: 0xffee66, size: 1, alpha: 0.8 });
            } catch (_) {}
            // Ensure visible blue spark trail as fallback
            if (!w._lastSparkAt || (now - w._lastSparkAt) >= 20) {
              try { pulseSpark(this, w.x, w.y, { color: 0x66aaff, size: 2, life: 140 }); } catch (_) {}
              w._lastSparkAt = now;
            }
            // Fading blue line segment along dash path
            try {
              if (!w._lastLineAt || (now - w._lastLineAt) >= 16) {
                const lg = this.add.graphics();
                try { lg.setDepth(9850); lg.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
                lg.lineStyle(2, 0x66aaff, 0.95);
                lg.beginPath(); lg.moveTo(px, py); lg.lineTo(w.x, w.y); lg.strokePath();
                this.tweens.add({ targets: lg, alpha: 0, duration: 240, ease: 'Quad.easeOut', onComplete: () => { try { lg.destroy(); } catch (_) {} } });
                w._lastLineAt = now;
              }
            } catch (_) {}
            // Hit check
            if (t && t.active && !w.dashHit) {
              const dx = t.x - w.x; const dy = t.y - w.y; const len = Math.hypot(dx, dy) || 1;
              if (len < 14) {
              // Apply damage and stun
              if (t.isDummy) {
                  this._dummyDamage = (this._dummyDamage || 0) + 3.5;
                  // Stun build-up for dummy as well
                  t._stunValue = Math.min(10, (t._stunValue || 0) + 2.5);
                  if ((t._stunValue || 0) >= 10) {
                    t._stunnedUntil = now + 200;
                    t._stunValue = 0; // reset on trigger
                    if (!t._stunIndicator) { t._stunIndicator = this.add.graphics(); try { t._stunIndicator.setDepth(9000); } catch (_) {} t._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                    try { t._stunIndicator.setPosition(t.x, t.y - 22); } catch (_) {}
                  }
                } else {
                  if (typeof t.hp !== 'number') t.hp = t.maxHp || 20;
                  t.hp -= 3.5; if (t.hp <= 0) { this.killEnemy(t); }
                  // Stun build-up: +2.5 per hit, stun at 10 (0.2s), applies to all (boss too)
                  t._stunValue = Math.min(10, (t._stunValue || 0) + 2.5);
                  if ((t._stunValue || 0) >= 10) {
                    t._stunnedUntil = now + 200;
                    t._stunValue = 0; // reset on trigger
                    if (!t._stunIndicator) { t._stunIndicator = this.add.graphics(); try { t._stunIndicator.setDepth(9000); } catch (_) {} t._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                    try { t._stunIndicator.setPosition(t.x, t.y - 22); } catch (_) {}
                    // Interrupt actions
                    try { if (t.isSniper) { t.aiming = false; t._aimG?.clear?.(); t._aimG?.destroy?.(); t._aimG = null; } } catch (_) {}
                    try { t._burstLeft = 0; } catch (_) {}
                  }
                }
                w.dashHit = true;
              }
            }
            if (now >= (w.dashUntil || 0)) {
              // End dash
              w.state = (t && t.active && (!w.didFinalDash)) ? 'locked' : 'idle';
              if (t && t.active) {
                const dxp = t.x - this.player.x; const dyp = t.y - this.player.y; const d2p = dxp * dxp + dyp * dyp;
                if (d2p > detectR2) { w.target = null; w.didFinalDash = false; }
              } else { w.target = null; w.didFinalDash = false; }
              w.vx = 0; w.vy = 0; w.dashHit = false; w._dash = null; // do not snap back to original
              // Stop and cleanup trail shortly after dash ends
              try {
                if (w._trailEmitter) { w._trailEmitter.on = false; }
                if (w._trailMgr) {
                  this.time.delayedCall(260, () => { try { w._trailMgr.destroy(); } catch (_) {} w._trailMgr = null; w._trailEmitter = null; });
                }
              } catch (_) {}
              // Retain current offset around base to avoid snapping back
              const bx = (t && t.active) ? t.x : this.player.x;
              const by = (t && t.active) ? t.y : this.player.y;
              const ox = w.x - bx; const oy = w.y - by;
              const d = Math.hypot(ox, oy) || 1;
              w._hoverR = Phaser.Math.Clamp(d, (t && t.active) ? 28 : 22, (t && t.active) ? 52 : 42);
              w._hoverAngle = Math.atan2(oy, ox);
              w._hoverChangeAt = now + Phaser.Math.Between(280, 560);
            }
            return true;
          }

          // Hover behavior (wasp-like jitter) around target or player
          const baseX = t && t.active ? t.x : this.player.x;
          const baseY = t && t.active ? t.y : this.player.y;
          if (now >= (w._hoverChangeAt || 0)) {
            w._hoverChangeAt = now + Phaser.Math.Between(220, 520);
            // small random offset radius and angle step
            const addR = Phaser.Math.Between(-6, 6);
            w._hoverR = Phaser.Math.Clamp((w._hoverR || (t && t.active ? 32 : 26)) + addR, (t && t.active) ? 28 : 22, (t && t.active) ? 52 : 42);
            w._hoverAngle += Phaser.Math.FloatBetween(-0.9, 0.9);
          }
          // Use larger hover distance when around a target vs around player
          const baseR = t && t.active ? (w._hoverR || 32) : (w._hoverR || 26);
          const hx = baseX + Math.cos(w._hoverAngle) * baseR;
          const hy = baseY + Math.sin(w._hoverAngle) * baseR;
          const dxh = hx - w.x; const dyh = hy - w.y; const llen = Math.hypot(dxh, dyh) || 1;
          const hsp = t ? 320 : 280;
          w.vx = (dxh / llen) * hsp; w.vy = (dyh / llen) * hsp;
          w.x += w.vx * dt; w.y += w.vy * dt; try { w.g.setPosition(w.x, w.y); } catch (_) {}
          // Smooth hover rotation
          try { const tAng = Math.atan2(w.vy, w.vx); w._rot = (typeof w._rot === 'number') ? Phaser.Math.Angle.RotateTo(w._rot, tAng, Phaser.Math.DegToRad(12)) : tAng; w.g.setRotation(w._rot); } catch (_) {}
          // Thruster draw (yellowish) with smoothing and speed threshold
          try { const g = w._thr; if (g) { const vx = w.vx || 0, vy = w.vy || 0; const spd = Math.hypot(vx, vy) || 0; g.clear(); if (spd > 40) { const tAng2 = Math.atan2(vy, vx); w._thrAng = (typeof w._thrAng === 'number') ? Phaser.Math.Angle.RotateTo(w._thrAng, tAng2, Phaser.Math.DegToRad(10)) : tAng2; const ux = Math.cos(w._thrAng), uy = Math.sin(w._thrAng); const tail = 10, stub = 5; const tx = w.x - ux * tail, ty = w.y - uy * tail; const sx2 = w.x - ux * stub, sy2 = w.y - uy * stub; try { const g = w._thr; if (g) { g.clear(); } } catch (_) {} } } } catch (_) {}
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

          // Plan dash when locked
          if (t && t.active) {
            const dxp = t.x - this.player.x; const dyp = t.y - this.player.y; const outOfRadius = (dxp * dxp + dyp * dyp) > detectR2;
            // Increased dash cooldown
            const dashReady = (!w.lastDashAt || (now - w.lastDashAt >= 900));
            if (dashReady && (!outOfRadius || !w.didFinalDash)) {
              // Start straight dash toward target, from varied approach angles and shorter range
              const sx = w.x; const sy = w.y; const tx = t.x; const ty = t.y;
              const dx0 = tx - sx; const dy0 = ty - sy; const baseAng = Math.atan2(dy0, dx0);
              if (w._approachSign === undefined) w._approachSign = (Math.random() < 0.5 ? -1 : 1);
              w._approachSign *= -1; // alternate sides each dash (opposite angle)
              const angOff = Phaser.Math.FloatBetween(0.4, 0.7) * w._approachSign; // vary entry angle
              const rOff = Phaser.Math.Between(10, 24); // aim near enemy, not center
              let ex = tx + Math.cos(baseAng + angOff) * rOff;
              let ey = ty + Math.sin(baseAng + angOff) * rOff;
              // Randomize dash length and duration, with overall faster speed
              let dx = ex - sx; let dy = ey - sy; let len = Math.hypot(dx, dy) || 1;
              const minDashLen = 90; const maxDashLen = 140;
              const desired = Math.min(len, Phaser.Math.Between(minDashLen, maxDashLen));
              const ux = dx / len; const uy = dy / len; ex = sx + ux * desired; ey = sy + uy * desired; dx = ex - sx; dy = ey - sy; len = Math.hypot(dx, dy) || 1;
              const dur = Phaser.Math.Between(90, 130); // randomized duration
              const sp = ((len * 1000) / Math.max(1, dur)) * 1.2; // +20% speed boost
              w.vx = (dx / len) * sp; w.vy = (dy / len) * sp;
              w._dash = null;
              w.dashUntil = now + dur; w.lastDashAt = now; w.state = 'dashing'; w.dashHit = false;
              // Blue trail while dashing (more intense and visible)
              try {
                const texKey = 'bit_trail_particle_bold';
                if (!this.textures || !this.textures.exists(texKey)) {
                  const tg = this.make.graphics({ x: 0, y: 0, add: false });
                  tg.clear(); tg.fillStyle(0x66aaff, 1); tg.fillCircle(7, 7, 7);
                  tg.generateTexture(texKey, 14, 14); tg.destroy();
                }
                if (w._trailMgr) { try { w._trailMgr.destroy(); } catch (_) {} w._trailMgr = null; }
                w._trailMgr = this.add.particles(texKey);
                try { w._trailMgr.setDepth?.(9800); } catch (_) {}
                const emitter = w._trailMgr.createEmitter({
                  speed: { min: 0, max: 20 },
                  lifespan: { min: 260, max: 420 },
                  alpha: { start: 1.0, end: 0 },
                  scale: { start: 1.0, end: 0.1 },
                  quantity: 9,
                  frequency: 6,
                  tint: 0x66aaff,
                  blendMode: Phaser.BlendModes.ADD,
                });
                try { emitter.startFollow(w.g); } catch (_) {}
                w._trailEmitter = emitter;
              } catch (_) {}
              if (outOfRadius) w.didFinalDash = true; // one last dash then drop
            }
          }
          return true;
        });
      }
    }

    // Player melee: C key, 150�? 48px, 10 dmg
    try {
      if (this.inputMgr?.pressedMelee) this.performPlayerMelee?.();
    } catch (_) {}

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
      // Stun: freeze movement and actions during stun window
      if (e._stunnedUntil && now < e._stunnedUntil) {
        try { e.body?.setVelocity?.(0, 0); } catch (_) { try { e.setVelocity(0, 0); } catch (_) {} }
        return;
      }
      // If under repulsion knockback, override movement for 1s to respect barricade physics
      // Disorientation (toxin) overrides movement briefly
      if (!e.isBoss && e._toxinedUntil && now < e._toxinedUntil) {
        if (!e._wanderChangeAt || now >= e._wanderChangeAt) {
          e._wanderChangeAt = now + Phaser.Math.Between(300, 700);
          const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
          const mag = Phaser.Math.FloatBetween(0.3, 1.0);
          e._wanderVX = Math.cos(ang) * e.speed * mag;
          e._wanderVY = Math.sin(ang) * e.speed * mag;
        }
        const vx = e._wanderVX || 0; const vy = e._wanderVY || 0;
        try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
        // Do not return; allow shooter logic to run while disoriented
      }
      if (now < (e._repulseUntil || 0)) {
        const vx = e._repulseVX || 0; const vy = e._repulseVY || 0;
        try { e.body?.setVelocity?.(vx, vy); } catch (_) { try { e.setVelocity(vx, vy); } catch (_) {} }
        return;
      }
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
        // Rook: update and draw shield; turn slowly toward player (30°/s)
        if (e.isRook) {
          try {
            const targetAng = Math.atan2(dy, dx);
            const maxTurn = Phaser.Math.DegToRad(30) * dt; // rad/s * dt
            const cur = e._shieldAngle || 0;
            const delta = Phaser.Math.Angle.Wrap(targetAng - cur);
            const step = Phaser.Math.Clamp(delta, -maxTurn, maxTurn);
            e._shieldAngle = cur + step;
            if (!e._shieldG) { e._shieldG = this.add.graphics(); try { e._shieldG.setDepth(8500); e._shieldG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {} }
            const g = e._shieldG; const half = Phaser.Math.DegToRad(45);
            const r = (e._shieldRadius || 60);
          const gap = 35; const off = (gap - r);
            const baseR = r;
            const cx = e.x + Math.cos(e._shieldAngle) * off;
            const cy = e.y + Math.sin(e._shieldAngle) * off;
            // Match player shield VFX style: pulsing radius and alpha, two stroke layers
            const t = ((this.time?.now || 0) % 1000) / 1000;
            const radius = baseR + Math.sin(t * Math.PI * 2) * 1.0;
            const p = 1; // no shield HP for enemies; use full visual strength
            const alpha = (0.12 + 0.28 * p) + Math.sin(t * Math.PI * 2) * 0.04 * p;
            try {
              g.clear(); g.setPosition(cx, cy);
              // Exact player shield style but as an arc and red palette
              g.lineStyle(3, 0xff6666, 0.55 + 0.4 * p).beginPath(); g.arc(0, 0, radius, e._shieldAngle - half, e._shieldAngle + half, false); g.strokePath();
              g.lineStyle(2, 0xff9999, 0.3 + 0.4 * p).beginPath(); g.arc(0, 0, Math.max(11, radius - 2.5), e._shieldAngle - half, e._shieldAngle + half, false); g.strokePath();
              try { g.setAlpha(alpha); } catch (_) {}
            } catch (_) {}

            // Transparent red sector from Rook to arc (visual coverage area)
            // Connector lines from Rook center to arc endpoints (transparent red)
            try {
              const rx = e.x - cx, ry = e.y - cy; // rook center in shield local coords
              const a1 = e._shieldAngle - half; const a2 = e._shieldAngle + half;
              const ex1 = Math.cos(a1) * radius, ey1 = Math.sin(a1) * radius;
              const ex2 = Math.cos(a2) * radius, ey2 = Math.sin(a2) * radius;
              g.lineStyle(1, 0xff3333, 0.22).beginPath(); g.moveTo(rx, ry); g.lineTo(ex1, ey1); g.strokePath();
              g.lineStyle(1, 0xff3333, 0.22).beginPath(); g.moveTo(rx, ry); g.lineTo(ex2, ey2); g.strokePath();
            } catch (_) {}

                        try {
              const r = (e._shieldRadius || 60);
              const gap = 35; const off = (gap - r);
              const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
              const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
              const zoneR = Math.max(8, Math.floor(r));
              if (!e._shieldZone || !e._shieldZone.body) {
                const z = this.add.zone(cx, cy, Math.ceil(zoneR * 2), Math.ceil(zoneR * 2));
                this.physics.world.enable(z);
                z.body.setAllowGravity(false);
                z.body.setImmovable(true);
                try { z.body.setCircle(zoneR); } catch (_) { try { z.body.setSize(Math.ceil(zoneR * 2), Math.ceil(zoneR * 2)); } catch (_) {} }
                z._owner = e; e._shieldZone = z; this.rookShieldGroup.add(z);
              } else {
                const z = e._shieldZone; z.setPosition(cx, cy);
                try { z.body.setCircle(zoneR); } catch (_) { try { z.body.setSize(Math.ceil(zoneR * 2), Math.ceil(zoneR * 2)); } catch (_) {} }
              }
            } catch (_) {}
          } catch (_) {}
        }
        // Melee attack state machine (for base + runner + rook)
        if (e.isMelee && !e.isShooter && !e.isSniper && !e.isGrenadier) {
          // Align enemy melee FOV with player melee (150° total => 75° half-angle)
          // Shorter timings for snappier combat: reduced windup, sweep, and recovery
          let cfg = e.isRunner ? { range: 64, half: Phaser.Math.DegToRad(75), wind: 160, sweep: 90, recover: 260 } : { range: 56, half: Phaser.Math.DegToRad(75), wind: 260, sweep: 90, recover: 340 };
          if (e.isRook) { cfg = { range: 90, half: Phaser.Math.DegToRad(75), wind: 300, sweep: 90, recover: 480 }; }
          if (!e._mState) e._mState = 'idle';
          // Enter windup if player close
          if (e._mState === 'idle') {
            if (dist <= (cfg.range + 8)) {
              e._mState = 'windup'; e._meleeUntil = now + cfg.wind; e._meleeFacing = Math.atan2(dy, dx); e._meleeAlt = !e._meleeAlt;
            }
          }
          // Freeze during windup
          if (e._mState === 'windup') {
            vx = 0; vy = 0;
            if (now >= (e._meleeUntil || 0)) {
              // Start sweep (VFX matches player's 150° cone)
              e._mState = 'sweep'; e._meleeDidHit = false; e._meleeUntil = now + cfg.sweep;
              // Play slash VFX a bit faster than the full sweep
              try { this.spawnMeleeVfx(e, e._meleeFacing, 150, Math.min(90, Math.floor(cfg.sweep * 0.75)), 0xff3333, cfg.range, e._meleeAlt); } catch (_) {}
              // Damage tick at sweep start (0ms)
              this.time.delayedCall(0, () => {
                if (!e.active || e._mState !== 'sweep') return;
                const pdx = this.player.x - e.x; const pdy = this.player.y - e.y;
                const dd = Math.hypot(pdx, pdy) || 1;
                const angP = Math.atan2(pdy, pdx);
                const diff = Math.abs(Phaser.Math.Angle.Wrap(angP - (e._meleeFacing || 0)));
                if (dd <= cfg.range && diff <= cfg.half && !e._meleeDidHit) {
                  this.applyPlayerDamage((e.damage || 10));
                  this.player.iframesUntil = this.time.now + 600;
                  try { impactBurst(this, this.player.x, this.player.y, { color: 0xff3333, size: 'small' }); } catch (_) {}
                  e._meleeDidHit = true;
                  if (this.gs && this.gs.hp <= 0) {
                    try {
                      const eff = getPlayerEffects(this.gs);
                      this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
                      this.gs.nextScene = SceneKeys.Hub;
                      SaveManager.saveToLocal(this.gs);
                      this.scene.start(SceneKeys.Hub);
                    } catch (_) {}
                    return;
                  }
                }
              });
            }
          }
          // During sweep, stand still
          if (e._mState === 'sweep') {
            vx = 0; vy = 0;
            if (now >= (e._meleeUntil || 0)) {
              e._mState = 'recover'; e._meleeUntil = now + cfg.recover; e._meleeSlowUntil = now + 280;
            }
          }
          // Recovery: reduced movement speed, then back to idle
          if (e._mState === 'recover') {
            // Slowdown applied later to smoothed velocity
            if (now >= (e._meleeUntil || 0)) { e._mState = 'idle'; }
          }
        }
        // Pathfinding when LOS to player is blocked
        let usingPath = false;
        const losBlocked = this.isLineBlocked(e.x, e.y, this.player.x, this.player.y);
        if (losBlocked && this._nav?.grid) {
          const needRepath = (!e._path || (e._pathIdx == null) || (e._pathIdx >= e._path.length) || (now - (e._lastPathAt || 0) > ((e.isGrenadier && e._charging) ? 300 : 800)));
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
        // Snitch custom kiting movement
        if (e.isSnitch) {
          const desired = 280; const minD = 200; const maxD = 360;
          // Choose a retreat target when too close, or orbit when in band
          if (dist < minD) {
            // Find a point away from player within arena
            const backX = Phaser.Math.Clamp(e.x - nx * 180, 16, this.scale.width - 16);
            const backY = Phaser.Math.Clamp(e.y - ny * 180, 16, this.scale.height - 16);
            let tx = backX, ty = backY;
            // Use pathfinding if LOS blocked
            if (this._nav?.grid) {
              try {
                const [sgx, sgy] = worldToGrid(this._nav.grid, e.x, e.y);
                const [ggx, ggy] = worldToGrid(this._nav.grid, tx, ty);
                const path = findPath(this._nav.grid, sgx, sgy, ggx, ggy) || null;
                if (path && path.length) {
                  const wp = path[0];
                  const pdx = wp[0] - e.x; const pdy = wp[1] - e.y;
                  const pd = Math.hypot(pdx, pdy) || 1;
                  const px = pdx / pd; const py = pdy / pd;
                  vx = px * speed; vy = py * speed; usingPath = true;
                }
              } catch (_) {}
            }
            if (!usingPath) { vx = -nx * speed; vy = -ny * speed; }
          } else if (dist > maxD) {
            // Approach back into desired band
            vx = nx * speed * 0.8; vy = ny * speed * 0.8;
          } else {
            // Strafe/orbit around player
            const px = -ny, py = nx;
            const dir = (e._strafeDir === -1) ? -1 : 1; e._strafeDir = dir;
            vx = px * speed * 0.7 * dir; vy = py * speed * 0.7 * dir;
            if (!e._nextStrafeFlip || now - e._nextStrafeFlip > 1600) { e._strafeDir = (Math.random() < 0.5) ? -1 : 1; e._nextStrafeFlip = now + Phaser.Math.Between(1600, 2600); }
          }
        }
        // Treat snipers like shooters for movement behavior (exclude Snitch's custom logic)
        if (!usingPath && ((e.isShooter && !e.isSnitch) || e.isSniper)) {
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
        // If disoriented by toxin, override with wander velocity but still allow firing logic later
        if (!e.isBoss && e._toxinedUntil && now < e._toxinedUntil) {
          vx = (e._wanderVX || 0);
          vy = (e._wanderVY || 0);
        }
        // Grenadier enrage: charge player under 25% HP and explode on contact
        if (e.isGrenadier && !e._charging && (typeof e.hp === 'number') && (typeof e.maxHp === 'number') && e.hp <= 0.25 * e.maxHp) {
          e._charging = true;
        }
        if (e.isGrenadier && e._charging) {
          // Prefer pathing around obstacles while charging if a path exists
          const chargeMul = 4.0; // faster suicide run
          if (!usingPath) {
            const ang = Math.atan2(dy, dx);
            const sp = (e.speed || 40) * chargeMul;
            vx = Math.cos(ang) * sp; vy = Math.sin(ang) * sp;
          } else {
            // Scale the path-follow velocity up to match charge speed
            vx *= chargeMul; vy *= chargeMul;
          }
        }
        // Smooth velocity to avoid twitching (inertia/acceleration)
        const smooth = 0.12; // approaching target ~12% per frame
        if (e._svx === undefined) e._svx = 0;
        if (e._svy === undefined) e._svy = 0;
        e._svx += (vx - e._svx) * smooth;
        e._svy += (vy - e._svy) * smooth;
        // Post-sweep slow for melee enemies (reduced slowdown: 60% speed)
        if (e.isMelee && e._meleeSlowUntil && now < e._meleeSlowUntil) { e._svx *= 0.6; e._svy *= 0.6; }
        e.body.setVelocity(e._svx, e._svy);
        // Stuck detection triggers repath (more aggressive during Grenadier charge)
        if (e._lastPosT === undefined) { e._lastPosT = now; e._lx = e.x; e._ly = e.y; }
        if (now - e._lastPosT > 400) {
          const md = Math.hypot((e.x - (e._lx || e.x)), (e.y - (e._ly || e.y)));
          e._lx = e.x; e._ly = e.y; e._lastPosT = now;
          const stuckWhileCharging = (e.isGrenadier && e._charging && md < 3); if ((md < 2 && this.isLineBlocked(e.x, e.y, this.player.x, this.player.y)) || stuckWhileCharging) { e._path = null; e._pathIdx = 0; e._lastPathAt = 0; }
        }
      }
      // Grenadier: detonate if player within trigger radius while charging
      if (e.isGrenadier && e._charging) {
        const dxp = this.player.x - e.x; const dyp = this.player.y - e.y;
        const trig = (e.detonateTriggerRadius || 40);
        if ((dxp * dxp + dyp * dyp) <= (trig * trig)) {
          try { this.killEnemy(e); } catch (_) {}
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
        if (e.isPrism) {
          const nowT = this.time.now;
          // Prism: two behaviors �?sweeping beam, and special aim-then-beam
          // Freeze during aim/beam
          if (e._prismState === 'aim' || e._prismState === 'beam') {
            try { e.body?.setVelocity?.(0, 0); } catch (_) {}
            // Ensure sweep is cancelled while aiming or beaming
            if (e._sweepActive) { e._sweepActive = false; try { e._laserG?.clear(); } catch (_) {} }
          }
          // End aim -> start beam
          if (e._prismState === 'aim' && nowT >= (e._aimUntil || 0)) {
            e._prismState = 'beam';
            e._beamUntil = nowT + 1500; // 1.5s
            // Lock beam angle at start toward player
            e._beamAngle = Math.atan2((this.player.y - e.y), (this.player.x - e.x));
            try { e._aimG?.clear(); } catch (_) {}
            if (!e._laserG) { e._laserG = this.add.graphics(); try { e._laserG.setDepth(8000); e._laserG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {} }
            e._beamTickAccum = 0;
          }
          // Finish beam
          if (e._prismState === 'beam' && nowT >= (e._beamUntil || 0)) {
            e._prismState = 'idle';
            try { e._laserG?.clear(); } catch (_) {}
            // Reset sweep counter and delay next sweep so resuming isn't immediate
            e._sweepsSinceAbility = 0;
            e._nextSweepAt = nowT + Phaser.Math.Between(2500, 3500);
          }
          // Trigger special ability after 3 completed sweeps (not time-based)
          if (e._prismState !== 'aim' && e._prismState !== 'beam') {
            if ((e._sweepsSinceAbility || 0) >= 3 && !e._sweepActive) {
              // Cancel any ongoing sweep when starting aim
              if (e._sweepActive) { e._sweepActive = false; try { e._laserG?.clear(); } catch (_) {} }
              e._sweepsSinceAbility = 0;
              e._prismState = 'aim';
              e._aimUntil = nowT + 800; // lock for 0.8s
              if (!e._aimG) e._aimG = this.add.graphics();
              try { e._aimG.clear(); } catch (_) {}
              e._aimG.lineStyle(1, 0xff2222, 1);
              e._aimG.beginPath(); e._aimG.moveTo(e.x, e.y); e._aimG.lineTo(this.player.x, this.player.y); e._aimG.strokePath();
            }
          }
          // Update aim line
          if (e._prismState === 'aim') {
            if (e._aimG) {
              try { e._aimG.clear(); e._aimG.lineStyle(1, 0xff2222, 1); e._aimG.beginPath(); e._aimG.moveTo(e.x, e.y); e._aimG.lineTo(this.player.x, this.player.y); e._aimG.strokePath(); } catch (_) {}
            }
          }
          // Draw and apply beam damage (beam follows player during fire)
          if (e._prismState === 'beam') {
            // Continuously track player while firing
            e._beamAngle = Math.atan2((this.player.y - e.y), (this.player.x - e.x));
            this.renderPrismBeam(e, e._beamAngle, (this.game?.loop?.delta || 16.7)/1000, { applyDamage: true, damagePlayer: true, dps: 50, tick: 0.05 });
          }
          // Sweeping laser while idle
          if (e._prismState === 'idle' || !e._prismState) {
            if (!e._sweepActive && nowT >= (e._nextSweepAt || 0)) {
              e._sweepActive = true;
              const base = Math.atan2(this.player.y - e.y, this.player.x - e.x);
              // Narrower sweep: 80 degrees total, slower
              e._sweepFrom = base - Phaser.Math.DegToRad(40);
              e._sweepTo = base + Phaser.Math.DegToRad(40);
              e._sweepT = 0; e._sweepDuration = 1500; // ms
              // Alternate sweep direction each time: 1 then -1 then 1 ...
              e._sweepDir = (e._sweepDir === -1) ? 1 : -1;
              if (!e._laserG) { e._laserG = this.add.graphics(); try { e._laserG.setDepth(8000); e._laserG.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {} }
              e._sweepTickAccum = 0;
            }
            if (e._sweepActive) {
              const dtMs = (this.game?.loop?.delta || 16.7);
              e._sweepT += dtMs;
              const t = Phaser.Math.Clamp(e._sweepT / (e._sweepDuration || 900), 0, 1);
              const tt = (e._sweepDir === -1) ? (1 - t) : t;
              const ang = e._sweepFrom + (e._sweepTo - e._sweepFrom) * tt;
              // Sweeping beam now damages player; reduce DPS by 50%
              this.renderPrismBeam(e, ang, dtMs / 1000, { applyDamage: true, damagePlayer: true, dps: 50 * 27 * 0.5 });
              if (t >= 1) {
                e._sweepActive = false; try { e._laserG?.clear(); } catch (_) {}
                // Count completed sweep and schedule next unless ability will fire immediately
                e._sweepsSinceAbility = (e._sweepsSinceAbility || 0) + 1;
                if (e._sweepsSinceAbility >= 3) {
                  // Start aim immediately after third sweep
                  e._prismState = 'aim';
                  e._aimUntil = nowT + 800;
                  if (!e._aimG) e._aimG = this.add.graphics();
                  try { e._aimG.clear(); e._aimG.lineStyle(1, 0xff2222, 1); e._aimG.beginPath(); e._aimG.moveTo(e.x, e.y); e._aimG.lineTo(this.player.x, this.player.y); e._aimG.strokePath(); } catch (_) {}
                } else {
                  e._nextSweepAt = nowT + Phaser.Math.Between(1200, 1800);
                }
              }
            }
          }
        } else if (e.isSnitch) {
          const nowT = this.time.now;
          // Ability: call reinforcements every 8s
          if (nowT >= (e._callNextAt || 0)) {
            e._callNextAt = nowT + 8000;
            // Spawn 1 reinforcement near the Snitch
            const mods = (this.gs?.getDifficultyMods?.() || { enemyHp: 1, enemyDamage: 1 });
            for (let k = 0; k < 1; k += 1) {
              const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
              const r = Phaser.Math.Between(60, 120);
              const sx = Phaser.Math.Clamp(e.x + Math.cos(ang) * r, 16, this.scale.width - 16);
              const sy = Phaser.Math.Clamp(e.y + Math.sin(ang) * r, 16, this.scale.height - 16);
              const roll = Math.random();
              let spawnFn;
              if (roll < 0.15) spawnFn = (sc, x, y) => createSniperEnemy(sc, x, y, Math.floor(80 * mods.enemyHp), Math.floor(18 * mods.enemyDamage), 40);
              else if (roll < 0.35) spawnFn = (sc, x, y) => createShooterEnemy(sc, x, y, Math.floor(90 * mods.enemyHp), Math.floor(8 * mods.enemyDamage), 50, 900);
              else if (roll < 0.50) spawnFn = (sc, x, y) => createMachineGunnerEnemy(sc, x, y, Math.floor(140 * mods.enemyHp), Math.floor(7 * mods.enemyDamage), 35, 1100, 12, 24);
              else if (roll < 0.65) spawnFn = (sc, x, y) => createRocketeerEnemy(sc, x, y, Math.floor(80 * mods.enemyHp), Math.floor(12 * mods.enemyDamage), 40, 2000);
              else if (roll < 0.85) spawnFn = (sc, x, y) => { const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); return createRunnerEnemy(sc, x, y, Math.floor(60 * mods.enemyHp), meleeDmg, 120); };
              else spawnFn = (sc, x, y) => { const meleeDmg = Math.floor(Math.floor(10 * mods.enemyDamage) * 1.5); return createEnemy(sc, x, y, Math.floor(100 * mods.enemyHp), meleeDmg, 60); };
              try { const ally = spawnFn(this, sx, sy); if (ally) this.enemies.add(ally); } catch (_) {}
              // Teleport VFX for reinforcement spawn
              try { bitSpawnRing(this, sx, sy, { radius: 22, lineWidth: 3, duration: 420, scaleTarget: 2.1, color: 0xaa66ff }); } catch (_) {}
              try { impactBurst(this, sx, sy, { color: 0xaa66ff, size: 'small' }); } catch (_) {}
            }
          }
          // Shotgun: only when close
          const close = dist < 220;
          const canShoot = close && (nowT - e.lastShotAt > 1000);
          if (canShoot) {
            e.lastShotAt = nowT;
            const pellets = 3; const spreadDeg = 24;
            const base = Math.atan2(dy, dx);
            for (let pi = 0; pi < pellets; pi += 1) {
              const t = (pellets === 1) ? 0 : (pi / (pellets - 1) - 0.5);
              const ang = base + Phaser.Math.DegToRad(spreadDeg) * t;
              const speedB = 260;
              const vx = Math.cos(ang) * speedB; const vy = Math.sin(ang) * speedB;
              const b = this.enemyBullets.get(e.x, e.y, 'bullet');
              if (b) {
                b.setActive(true).setVisible(true);
                b.setCircle(2).setOffset(-2, -2);
                b.setVelocity(vx, vy);
                b.setTint(0xffcc00);
                b.damage = e.damage;
                b.update = () => { const view = this.cameras?.main?.worldView; if (view && !view.contains(b.x, b.y)) { b.destroy(); } };
              }
            }
          }
        } else if (e.isGrenadier) {
          const nowT = this.time.now;
          // On grenade mode unless charging; throw 3-grenade burst every 2s
          if (!e._charging) {
            if (!e._castingGrenades && nowT >= (e._grenadeNextAt || 0)) {
              e._castingGrenades = true;
              for (let i = 0; i < 3; i += 1) {
                this.time.delayedCall(i * 300, () => {
                  if (!e.active) return;
                  const tx = this.player.x; const ty = this.player.y;
                  this.throwEnemyGrenade(e, tx, ty);
                  if (i === 2) { e._castingGrenades = false; }
                });
              }
              e._grenadeNextAt = nowT + (e.burstCooldownMs || 2000);
            }
          }
        } else if (e.isMachineGunner) {
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
            if (e._toxinedUntil && now < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              ang += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
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
            let ang = Math.atan2(dy, dx);
            if (e._toxinedUntil && nowT < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              ang += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
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
            let ang = Math.atan2(dy, dx);
            if (e._toxinedUntil && nowT < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              ang += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
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
            let angle = Math.atan2(dy, dx);
            if (e._toxinedUntil && now < e._toxinedUntil) {
              const extra = Phaser.Math.DegToRad(50);
              angle += Phaser.Math.FloatBetween(-extra/2, extra/2);
            }
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
                      this.applyPlayerDamage(dmg);
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
      const useCeil = !!w._magRoundUp;
      const raw = (w.magSize || 1);
      const cap = Math.max(1, useCeil ? Math.ceil(raw) : Math.floor(raw));
      return cap;
    } catch (_) {
      return 1;
    }
  }

  // Enemy grenade helper (Grenadier)
  throwEnemyGrenade(e, targetX, targetY) {
    const b = this.enemyGrenades.get(e.x, e.y, 'bullet');
    if (!b) return;
    b.setActive(true).setVisible(true);
    // Visual: slightly larger red projectile
    b.setCircle(3).setOffset(-3, -3);
    try { b.setScale(1.2); } catch (_) {}
    b.setTint(0xff4444);
    const angle = Math.atan2(targetY - e.y, targetX - e.x);
    const speed = 280; // increased range and speed
    const vx = Math.cos(angle) * speed; const vy = Math.sin(angle) * speed;
    b.setVelocity(vx, vy);
    b._spawnAt = this.time.now;
    b._lifeMs = 1200; // longer flight lifetime for greater range
    b._targetX = targetX; b._targetY = targetY;
    b._grenade = true; b._grenadeRadius = 60; b.damage = (e?.damage || 14);
    b.update = () => {
      const now = this.time.now;
      const dx = b.x - b._targetX; const dy = b.y - b._targetY;
      const near = (dx * dx + dy * dy) <= 18 * 18;
      const expired = (now - (b._spawnAt || 0)) >= (b._lifeMs || 800);
      const view = this.cameras?.main?.worldView; const off = view && !view.contains(b.x, b.y);
      if (near || expired || off) {
        const ex = b.x; const ey = b.y; const radius = 60; // smaller radius vs boss
        try { impactBurst(this, ex, ey, { color: 0xff3333, size: 'large', radius }); } catch (_) {}
        // Player damage if within radius
        const r2 = radius * radius; const pdx = this.player.x - ex; const pdy = this.player.y - ey;
        if ((pdx * pdx + pdy * pdy) <= r2) {
          if (now >= (this.player.iframesUntil || 0)) {
            { let dmg=(e?.damage||14); try{ const eff=getPlayerEffects(this.gs)||{}; const mul=eff.enemyExplosionDmgMul||1; dmg=Math.ceil(dmg*mul);}catch(_){} this.applyPlayerDamage(dmg); }
            this.player.iframesUntil = now + 600;
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        // Also damage destructible barricades
        this.damageSoftBarricadesInRadius(ex, ey, radius, (e.damage || 14));
        try { b.destroy(); } catch (_) {}
      }
    };
  }

  // Prism beam renderer: draws thick laser and applies damage to player
  renderPrismBeam(e, angle, dt, opts = {}) {
    const applyDamage = opts.applyDamage !== undefined ? opts.applyDamage : true;
    const damagePlayer = opts.damagePlayer !== undefined ? opts.damagePlayer : true;
    const dps = (typeof opts.dps === 'number') ? opts.dps : 34;
    const tick = (typeof opts.tick === 'number' && opts.tick > 0) ? opts.tick : dt; // default to per-frame
    try { if (!e._laserG) { e._laserG = this.add.graphics(); e._laserG.setDepth(8000); e._laserG.setBlendMode(Phaser.BlendModes.ADD); } } catch (_) {}
    const g = e._laserG;
    try { g.clear(); } catch (_) {}
    // Compute end vs barricades, then render thicker dual-color beam
    const hit = this.computeEnemyLaserEnd(e.x, e.y, angle);
    const ex = hit.ex, ey = hit.ey;
    try {
      g.lineStyle(5, 0xff3333, 0.95).beginPath(); g.moveTo(e.x, e.y); g.lineTo(ex, ey); g.strokePath();
      g.lineStyle(2, 0x66aaff, 1).beginPath(); g.moveTo(e.x, e.y - 1); g.lineTo(ex, ey); g.strokePath();
    } catch (_) {}
    // Particles at endpoint
    try { impactBurst(this, ex, ey, { color: 0xff4455, size: 'small' }); } catch (_) {}
    // Damage ticking to player if intersecting beam
    if (applyDamage) {
      e._beamTickAccum = (e._beamTickAccum || 0) + dt;
      while (e._beamTickAccum >= tick) {
        e._beamTickAccum -= tick;
        // Check if beam line hits player's bounds
        const line = new Phaser.Geom.Line(e.x, e.y, ex, ey);
        const rect = this.player.getBounds?.() || new Phaser.Geom.Rectangle(this.player.x - 6, this.player.y - 6, 12, 12);
        if (damagePlayer && Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
          if (this.time.now >= (this.player.iframesUntil || 0)) {
            const dmg = Math.max(1, Math.round(dps * tick));
            this.applyPlayerDamage(dmg);
            this.player.iframesUntil = this.time.now + 250; // brief i-frames vs continuous laser
            if (this.gs.hp <= 0) {
              const eff = getPlayerEffects(this.gs);
              this.gs.hp = (this.gs.maxHp || 0) + (eff.bonusHp || 0);
              this.gs.nextScene = SceneKeys.Hub;
              SaveManager.saveToLocal(this.gs);
              this.scene.start(SceneKeys.Hub);
            }
          }
        }
        // Damage soft barricades intersecting the beam
        try {
          const arr = this.barricadesSoft?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const s = arr[i]; if (!s?.active) continue;
            if (!s.getData('destructible')) continue;
            const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
            if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
              const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
              const dmg = Math.max(1, Math.round(dps * tick));
              const hp1 = hp0 - dmg;
              if (hp1 <= 0) { try { s.destroy(); } catch (_) {} }
              else s.setData('hp', hp1);
            }
          }
        } catch (_) {}
      }
    }
  }

  // Compute enemy laser line clipped to barricades
  computeEnemyLaserEnd(sx, sy, angle) {
    const maxLen = 1000;
    const ex0 = sx + Math.cos(angle) * maxLen;
    const ey0 = sy + Math.sin(angle) * maxLen;
    const ray = new Phaser.Geom.Line(sx, sy, ex0, ey0);
    let ex = ex0; let ey = ey0; let bestD2 = Infinity;
    const testGroups = [this.barricadesHard, this.barricadesSoft];
    for (let gi = 0; gi < testGroups.length; gi += 1) {
      const g = testGroups[gi]; if (!g) continue;
      const arr = g.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
        const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
        if (pts && pts.length) {
          const p = pts[0]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; }
        }
      }
    }
    return { ex, ey };
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

  deployRepulsionPulse(colors) {
    if (!this._repulses) this._repulses = [];
    const x = this.player.x; const y = this.player.y;
    const g = this.add.graphics({ x, y });
    try { g.setDepth?.(9000); } catch (_) {}
    try { g.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
    const rect = this.arenaRect || new Phaser.Geom.Rectangle(0, 0, this.scale.width, this.scale.height);
    const corners = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
    let maxD = 0; for (let i = 0; i < corners.length; i += 1) { const dx = corners[i].x - x; const dy = corners[i].y - y; const d = Math.hypot(dx, dy); if (d > maxD) maxD = d; }
    const obj = { x, y, r: 0, band: 8, speed: 300, maxR: maxD + 24, g };
    // Optional color palette override
    if (colors && typeof colors === 'object') {
      obj.colTrail = colors.trail;
      obj.colOuter = colors.outer;
      obj.colInner = colors.inner;
      obj.colSpark = colors.spark;
      obj.colPixel = colors.pixel;
      obj.colImpact = colors.impact;
    }
    this._repulses.push(obj);
  }

  deployBITs() {
    if (!this._bits) this._bits = [];
    // Green spawn ring for visual parity with Boss room
    try { bitSpawnRing(this, this.player.x, this.player.y, { radius: 18, lineWidth: 3, duration: 420, scaleTarget: 2.0 }); } catch (_) {}
    // Green pixel burst around player on release
    try {
      const cx = this.player.x, cy = this.player.y;
      for (let i = 0; i < 18; i += 1) {
        const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
        pixelSparks(this, cx, cy, { angleRad: a, count: 1, spreadDeg: 6, speedMin: 80, speedMax: 180, lifeMs: 240, color: 0x33ff66, size: 2, alpha: 0.8 });
      }
    } catch (_) {}
    const count = 6;
    for (let i = 0; i < count; i += 1) {
      // Use asset sprite for BIT unit and fit to moderate height
      const g = createFittedImage(this, this.player.x, this.player.y, 'ability_bit', 14);
      try { g.setDepth(9000); } catch (_) {}
      const bit = { x: this.player.x, y: this.player.y, vx: 0, vy: 0, g, target: null, lastShotAt: 0, holdUntil: 0, moveUntil: 0, despawnAt: this.time.now + 7000, spawnScatterUntil: this.time.now + Phaser.Math.Between(260, 420) };
      // Thruster VFX (additive tiny tail like missiles)
      try { bit._thr = this.add.graphics(); bit._thr.setDepth(8800); bit._thr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
      // initial scatter velocity
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const sp = Phaser.Math.Between(180, 260);
      bit.vx = Math.cos(a) * sp; bit.vy = Math.sin(a) * sp; bit.moveUntil = this.time.now + Phaser.Math.Between(200, 400);
      this._bits.push(bit);
    }
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
          try {
            const key = ensurePixelParticle(this, 'rail_px', 0x66aaff, 1) || 'rail_px';
            this.rail._mgr = this.add.particles(key);
            try { this.rail._mgr.setDepth(9500); } catch (_) {}
            try { this.rail._mgr.setBlendMode?.(Phaser.BlendModes.ADD); } catch (_) {}
            this.rail._em = this.rail._mgr.createEmitter({
              speed: { min: 10, max: 60 },
              lifespan: { min: 180, max: 320 },
              alpha: { start: 1.0, end: 0 },
              scale: 1,
              gravityY: 0,
              quantity: 0,
            });
          } catch (_) {}
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
      // Full-screen length: use screen diagonal with small margin
      const diag = Math.hypot(this.scale.width, this.scale.height);
      const len = Math.ceil(diag + 32);
      // Thinner guide line
      g.lineStyle(0.5, 0xffffff, 0.9);
      const a1 = angle - spread / 2; const a2 = angle + spread / 2;
      const x = this.player.x; const y = this.player.y;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a1) * len, y + Math.sin(a1) * len); g.strokePath();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len); g.strokePath();
      // Blue pixel sparks from multiple points along barrel (very subtle while charging)
      try {
        const ts = [0.35, 0.55, 0.8];
        const pick = Phaser.Math.Between(0, ts.length - 1);
        const pt = getWeaponBarrelPoint(this, ts[pick], 3);
        const common = { spreadDeg: 10, speedMin: 40, speedMax: 90, lifeMs: 140, color: 0x66aaff, size: 1, alpha: 0.45 };
        pixelSparks(this, pt.x, pt.y, { angleRad: angle - Math.PI / 2, count: 1, ...common });
        pixelSparks(this, pt.x, pt.y, { angleRad: angle + Math.PI / 2, count: 1, ...common });
      } catch (_) {}
    } catch (_) {}
  }

  endRailAim() {
    try { this.rail?.aimG?.clear(); this.rail?.aimG?.destroy(); } catch (_) {}
    try { this.rail?._mgr?.destroy(); } catch (_) {}
    if (this.rail) { this.rail.aimG = null; this.rail._mgr = null; this.rail._em = null; }
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
    b._stunOnHit = weapon._stunOnHit || 0;
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
          if (e.isDummy) {
            // Railgun dummy recording: accumulate but do not change HP
            this._dummyDamage = (this._dummyDamage || 0) + (b.damage || 10);
            if (b._stunOnHit && b._stunOnHit > 0) {
              const nowS = this.time.now;
              e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
              if ((e._stunValue || 0) >= 10) {
                e._stunnedUntil = nowS + 200;
                e._stunValue = 0;
                if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
              }
            }
          } else {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= (b.damage || 10);
            if (b._stunOnHit && b._stunOnHit > 0) {
              const nowS = this.time.now;
              e._stunValue = Math.min(10, (e._stunValue || 0) + b._stunOnHit);
              if ((e._stunValue || 0) >= 10) {
                e._stunnedUntil = nowS + 200;
                e._stunValue = 0;
                if (!e._stunIndicator) { e._stunIndicator = this.add.graphics(); try { e._stunIndicator.setDepth(9000); } catch (_) {} e._stunIndicator.fillStyle(0xffff33, 1).fillCircle(0, 0, 2); }
                try { e._stunIndicator.setPosition(e.x, e.y - 22); } catch (_) {}
              }
            }
          }
            try { impactBurst(this, b.x, b.y, { color: 0xaaddff, size: 'small' }); } catch (_) {}
            b._hitSet.add(e);
            if (!e.isDummy && e.hp <= 0) { try { this.killEnemy ? this.killEnemy(e) : e.destroy(); } catch (_) {} }
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
    // Rail muzzle VFX: big blue split flash + particle burst
    try {
      const m = getWeaponMuzzleWorld(this, 3);
      muzzleFlashSplit(this, m.x, m.y, { angle, color: 0xaaddff, count: 4, spreadDeg: 30, length: 24, thickness: 5 });
      // Stronger pixel spark burst on fire
      const burst = { spreadDeg: 14, speedMin: 160, speedMax: 280, lifeMs: 280, color: 0x66aaff, size: 2, alpha: 0.9 };
      pixelSparks(this, m.x, m.y, { angleRad: angle - Math.PI / 2, count: 10, ...burst });
      pixelSparks(this, m.x, m.y, { angleRad: angle + Math.PI / 2, count: 10, ...burst });
      if (this.rail?._em) { try { this.rail._em.explode?.(60, m.x, m.y); } catch (_) {} }
      try { this.rail?._mgr?.destroy(); } catch (_) {}
      if (this.rail) { this.rail._mgr = null; this.rail._em = null; }
    } catch (_) {}
    // High recoil kick for railgun on fire
    try { this._weaponRecoil = Math.max(this._weaponRecoil || 0, 5.5); } catch (_) {}
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

  // Laser mechanics: continuous beam with heat/overheat and ignite buildup
  handleLaser(now, weapon, ptr, dt) {
    if (!this.laser) this.laser = { heat: 0, firing: false, overheat: false, startedAt: 0, coolDelayUntil: 0, g: null, lastTickAt: 0 };
    // Initialize graphics once
    if (!this.laser.g) {
      this.laser.g = this.add.graphics();
      try { this.laser.g.setDepth(8000); } catch (_) {}
      try { this.laser.g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    }
    if (!this.laser.mg) {
      this.laser.mg = this.add.graphics();
      try { this.laser.mg.setDepth(9000); } catch (_) {}
      try { this.laser.mg.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    }
    const lz = this.laser;
    const canPress = ptr?.isDown && ((ptr.buttons & 1) === 1);
    const canFire = canPress && !lz.overheat;
    const heatPerSec = 1 / 5; // overheat in 5s
    const coolDelay = 0.5; // start cooling after 0.5s when not firing
    const coolFastPerSec = 2.5; // fast cool
    const tickRate = 0.1; // damage tick 10 Hz

    // Update heat/overheat state
    if (canFire) {
      if (!lz.firing) { lz.firing = true; lz.startedAt = now; }
      lz.heat = Math.min(1, lz.heat + heatPerSec * dt);
      if (lz.heat >= 1 && !lz.overheat) {
        // Force cooldown using reload bar
        lz.overheat = true;
        this.reload.active = true;
        this.reload.duration = this.getActiveReloadMs();
        this.reload.until = now + this.reload.duration;
        this.registry.set('reloadActive', true);
        this.registry.set('reloadProgress', 0);
      }
    } else {
      if (lz.firing) { lz.firing = false; lz.coolDelayUntil = now + Math.floor(coolDelay * 1000); }
      // cooling
      if (!lz.overheat) {
        if (now >= lz.coolDelayUntil) {
          lz.heat = Math.max(0, lz.heat - coolFastPerSec * dt);
        }
      } else {
        // During overheat, rely on reload to finish
        if (!this.reload.active || now >= this.reload.until) {
          // finish cooldown
          lz.overheat = false;
          lz.heat = 0;
          this.reload.active = false;
          this.reload.duration = 0;
          this.registry.set('reloadActive', false);
          this.registry.set('reloadProgress', 1);
        } else {
          // keep UI reload progress updated
          const remaining = Math.max(0, this.reload.until - now);
          const dur = Math.max(1, this.reload.duration || this.getActiveReloadMs());
          const prog = 1 - Math.min(1, remaining / dur);
          this.registry.set('reloadActive', true);
          this.registry.set('reloadProgress', prog);
        }
      }
    }

    // Update UI registry for heat
    this.registry.set('laserHeat', lz.heat);
    this.registry.set('laserOverheated', !!lz.overheat);

    // Draw and apply damage while firing and not overheated
    lz.g.clear();
    try { lz.mg.clear(); } catch (_) {}
    if (canFire && !lz.overheat) {
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, ptr.worldX, ptr.worldY);
      // Start exactly at the barrel tip using weapon sprite + origin
      const muzzle = getWeaponMuzzleWorld(this, 2);
      const sx = muzzle.x;
      const sy = muzzle.y;
      const hit = this.computeLaserEnd(angle, sx, sy);
      const ex = hit.ex, ey = hit.ey; const line = hit.line;
      // Draw blue layered beam (player laser), under weapon layer
      try {
        lz.g.lineStyle(3, 0x66aaff, 0.95).beginPath(); lz.g.moveTo(sx, sy); lz.g.lineTo(ex, ey); lz.g.strokePath();
        lz.g.lineStyle(1, 0xaaddff, 1).beginPath(); lz.g.moveTo(sx, sy - 1); lz.g.lineTo(ex, ey); lz.g.strokePath();
      } catch (_) {}

      // Laser muzzle twitch: larger white split rays (5) with subtle jitter
      try {
        const base = angle + Phaser.Math.DegToRad(Phaser.Math.Between(-3, 3));
        const offs = [-28, -14, 0, 14, 28].map((d) => Phaser.Math.DegToRad(d + Phaser.Math.Between(-3, 3)));
        for (let i = 0; i < offs.length; i += 1) {
          const a = base + offs[i];
          const len = 12 + (i === 2 ? 1 : 0);
          const hx = sx + Math.cos(a) * len;
          const hy = sy + Math.sin(a) * len;
          const thick = (i === 2) ? 2 : 1;
          lz.mg.lineStyle(thick, 0xffffff, 0.55).beginPath(); lz.mg.moveTo(sx, sy); lz.mg.lineTo(hx, hy); lz.mg.strokePath();
        }
        // smaller bloom at muzzle
        lz.mg.fillStyle(0xffffff, 0.5).fillCircle(sx, sy, 1.5);
      } catch (_) {}

      // Shield block spark for laser (if recently blocked by a Rook)
      try {
        const lb = this._lastLaserBlockedAt;
        if (lb && (now - lb.t) <= 50) {
          impactBurst(this, lb.x, lb.y, { color: 0xff3333, size: 'small' });
          this._lastLaserBlockedAt = null;
        }
      } catch (_) {}

      // Damage ticking
      lz.lastTickAt = (lz.lastTickAt || 0);
      lz.lastTickAt += dt;
      if (lz.lastTickAt >= tickRate) {
        const step = lz.lastTickAt; lz.lastTickAt = 0;
        const dps = 30; const ignitePerSec = 8;
        const dmg = Math.max(0, Math.round(dps * step));
        const igniteAdd = ignitePerSec * step;
        // Only apply to the first hit enemy (no penetration)
        const e = hit.hitEnemy;
        if (e && e.active) {
          // Hit VFX on enemy at contact point
          try { impactBurst(this, ex, ey, { color: 0x66aaff, size: 'small' }); } catch (_) {}
          if (e.isDummy) {
            this._dummyDamage = (this._dummyDamage || 0) + dmg;
          } else {
            if (typeof e.hp !== 'number') e.hp = e.maxHp || 20;
            e.hp -= dmg;
            if (e.hp <= 0) { this.killEnemy(e); }
          }
          // Ignite buildup
          e._igniteValue = Math.min(10, (e._igniteValue || 0) + igniteAdd);
          if ((e._igniteValue || 0) >= 10) {
            e._ignitedUntil = this.time.now + 2000;
            e._igniteValue = 0; // reset on trigger
            if (!e._igniteIndicator) {
              e._igniteIndicator = this.add.graphics();
              try { e._igniteIndicator.setDepth(9000); } catch (_) {}
              e._igniteIndicator.fillStyle(0xff3333, 1).fillCircle(0, 0, 2);
            }
            try { e._igniteIndicator.setPosition(e.x, e.y - 14); } catch (_) {}
          }
        }
        // Barricade hit VFX at the beam endpoint (both hard and soft)
        try {
          if (hit.hitKind === 'soft' || hit.hitKind === 'hard') {
            const col = (hit.hitKind === 'soft') ? 0xC8A165 : 0xaaaaaa;
            impactBurst(this, ex, ey, { color: col, size: 'small' });
          }
        } catch (_) {}
        // Damage soft barricades intersecting the beam
        try {
          const arr = this.barricadesSoft?.getChildren?.() || [];
          for (let i = 0; i < arr.length; i += 1) {
            const s = arr[i]; if (!s?.active) continue;
            if (!s.getData('destructible')) continue;
            const sRect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
            if (Phaser.Geom.Intersects.LineToRectangle(line, sRect)) {
              const hp0 = (typeof s.getData('hp') === 'number') ? s.getData('hp') : 20;
              const bhp = hp0 - dmg;
              if (bhp <= 0) { try { s.destroy(); } catch (_) {} }
              else s.setData('hp', bhp);
            }
          }
        } catch (_) {}
      }
    } else {
      // not firing: clear beam and muzzle twitch
      lz.g.clear();
      try { lz.mg.clear(); } catch (_) {}
    }
  }

  computeLaserEnd(angle, sxOverride = null, syOverride = null) {
    // Ray from start point (weapon) towards angle; clip to nearest barricade
    const maxLen = 1000;
    const sx = (typeof sxOverride === 'number') ? sxOverride : this.player.x;
    const sy = (typeof syOverride === 'number') ? syOverride : this.player.y;
    const ex0 = sx + Math.cos(angle) * maxLen;
    const ey0 = sy + Math.sin(angle) * maxLen;
    const ray = new Phaser.Geom.Line(sx, sy, ex0, ey0);
    let ex = ex0; let ey = ey0; let bestD2 = Infinity; let hitEnemy = null; let hitKind = null; let hitBarricade = null;
    const testGroups = [this.barricadesHard, this.barricadesSoft];
    for (let gi = 0; gi < testGroups.length; gi += 1) {
      const g = testGroups[gi]; if (!g) continue;
      const arr = g.getChildren?.() || [];
      for (let i = 0; i < arr.length; i += 1) {
        const s = arr[i]; if (!s?.active) continue;
        const rect = s.getBounds?.() || new Phaser.Geom.Rectangle(s.x - 8, s.y - 8, 16, 16);
        const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
        if (pts && pts.length) {
          // Choose nearest intersection point to player
          for (let k = 0; k < pts.length; k += 1) {
            const p = pts[k]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; hitKind = (gi === 0) ? 'hard' : 'soft'; hitBarricade = s; hitEnemy = null; }
          }
        }
      }
    }
    // Also stop at first enemy before barricade; handle Rook shield as a blocker
    const enemies = this.enemies?.getChildren?.() || [];
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i]; if (!e?.active) continue;
      // Rook shield: treat 90° arc as obstacle if facing the beam source
      if (e.isRook) {
        try {
          const r = (e._shieldRadius || 60);
          const gap = 35; const off = (gap - r);
          const cx = e.x + Math.cos(e._shieldAngle || 0) * off;
          const cy = e.y + Math.sin(e._shieldAngle || 0) * off;
          const dirToSource = Math.atan2(sy - cy, sx - cx);
          const shieldAng = e._shieldAngle || 0;
          const diff = Math.abs(Phaser.Math.Angle.Wrap(dirToSource - shieldAng));
          const half = Phaser.Math.DegToRad(45);
          if (diff <= half) {
            // Intersect ray with shield radius circle around Rook
            // r from above
            const dxr = Math.cos(angle), dyr = Math.sin(angle);
            const fx = sx - cx, fy = sy - cy; // ray origin relative to shield center
            const a = dxr * dxr + dyr * dyr;
            const bq = 2 * (fx * dxr + fy * dyr);
            const c = fx * fx + fy * fy - r * r;
            const disc = bq * bq - 4 * a * c;
            if (disc >= 0) {
              const sqrtD = Math.sqrt(disc);
              const t1 = (-bq - sqrtD) / (2 * a);
              const t2 = (-bq + sqrtD) / (2 * a);
              const t = (t1 > 0) ? t1 : ((t2 > 0) ? t2 : null);
              if (t != null) {
                const bx = sx + dxr * t; const by = sy + dyr * t;
                const ddx = bx - sx; const ddy = by - sy; const d2 = ddx * ddx + ddy * ddy;
                if (d2 < bestD2) {
                  bestD2 = d2; ex = bx; ey = by; hitEnemy = null; hitKind = 'rook'; hitBarricade = null;
                  this._lastLaserBlockedAt = { x: ex, y: ey, t: this.time.now };
                }
              }
            }
          }
        } catch (_) {}
      }
      // Standard enemy rect hit if not blocked closer
      const rect = e.getBounds?.() || new Phaser.Geom.Rectangle(e.x - 6, e.y - 6, 12, 12);
      const pts = Phaser.Geom.Intersects.GetLineToRectangle(ray, rect);
      if (pts && pts.length) {
        for (let k = 0; k < pts.length; k += 1) {
          const p = pts[k]; const dx = p.x - sx; const dy = p.y - sy; const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; ex = p.x; ey = p.y; hitEnemy = e; hitKind = null; hitBarricade = null; }
        }
      }
    }
    return { ex, ey, line: new Phaser.Geom.Line(sx, sy, ex, ey), hitEnemy, hitKind, hitBarricade };
  }

  // Spawn a temporary fire field that applies ignite to enemies inside
  spawnFireField(x, y, radius, durationMs = 2000) {
    if (!this._firefields) this._firefields = [];
    // Additive glow
    const g = this.add.graphics();
    try { g.setDepth(7000); g.setBlendMode(Phaser.BlendModes.ADD); } catch (_) {}
    // Rising embers via particles
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
      g.fillStyle(0xff6622, 0.22).fillCircle(x, y, inner);
      g.fillStyle(0xffaa33, 0.14).fillCircle(x, y, Math.floor(radius * 0.85));
      g.lineStyle(2, 0xffaa33, 0.5).strokeCircle(x, y, radius);
    } catch (_) {}
    // Add an initial orange pixel spark burst (matches railgun/muzzle pixel effect)
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





































































