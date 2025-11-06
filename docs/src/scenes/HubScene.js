import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { drawPanel } from '../ui/Panels.js';
import { makeTextButton } from '../ui/Buttons.js';
import { getPlayerEffects } from '../core/Loadout.js';
import { weaponDefs } from '../core/Weapons.js';

export default class HubScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Hub); }

  create() {
    const { width, height } = this.scale;
    // Launch UI overlay for gameplay scenes
    this.scene.launch(SceneKeys.UI);
    this.gs = this.registry.get('gameState');
    this.inputMgr = new InputManager(this);

    // World bounds
    this.physics.world.setBounds(0, 0, width, height);

    // Player placeholder
    this.player = this.physics.add.sprite(width / 2, height / 2 + 60, 'player_square').setCollideWorldBounds(true);
    this.player.setSize(12, 12);
    // no graphics draw; use texture
    this.player.iframesUntil = 0;
    this.playerFacing = 0;
    this.dash = { active: false, until: 0, cooldownUntil: 0, vx: 0, vy: 0, charges: 0, regen: [] };
    this.dash.charges = this.gs.dashMaxCharges;
    this.registry.set('dashCharges', this.dash.charges);
    this.registry.set('dashRegenProgress', 1);

    // NPC vendor (static)
    this.npcZone = this.add.zone(width / 2, height / 2 - 20, 40, 40);
    this.physics.world.enable(this.npcZone);
    this.npcZone.body.setAllowGravity(false);
    this.npcZone.body.setImmovable(true);
    this.npcG = this.add.graphics();
    this.npcG.fillStyle(0x44aaff, 1).fillRect(this.npcZone.x - 10, this.npcZone.y - 10, 20, 20);

    // Mode-select NPC (upper-right)
    this.modeNpcZone = this.add.zone(width - 80, 60, 40, 40);
    this.physics.world.enable(this.modeNpcZone);
    this.modeNpcZone.body.setAllowGravity(false);
    this.modeNpcZone.body.setImmovable(true);
    this.modeNpcG = this.add.graphics();
    this.modeNpcG.fillStyle(0xff66cc, 1).fillRect(this.modeNpcZone.x - 10, this.modeNpcZone.y - 10, 20, 20);

    // Portal to Combat/Boss
    this.portalZone = this.add.zone(width - 60, height / 2, 40, 80);
    this.physics.world.enable(this.portalZone);
    this.portalZone.body.setAllowGravity(false);
    this.portalZone.body.setImmovable(true);
    this.portalG = this.add.graphics();
    this.portalG.fillStyle(0x22ff88, 1).fillRect(this.portalZone.x - 10, this.portalZone.y - 20, 20, 40);

    // Overlap detection
    this.physics.add.overlap(this.player, this.npcZone);
    this.physics.add.overlap(this.player, this.modeNpcZone);
    this.physics.add.overlap(this.player, this.portalZone);

    // UI prompt (top, consistent with Combat "Clear enemies")
    this.prompt = this.add.text(width / 2, 40, 'WASD move, E interact', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);
    // Keybinds hint (bottom-right, small font)
    const binds = [
      'W/A/S/D: Move',
      'Space: Dash',
      'E: Interact',
      'C: Melee',
      'F: Ability',
      'LMB: Shoot',
      'Q: Swap Weapon',
      'R: Reload',
      'Tab: Loadout',
    ].join('\n');
    this.add.text(width - 10, height - 10, binds, { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' })
      .setOrigin(1, 1)
      .setAlpha(0.9);

    // Dialogue/Shop panel hidden
    this.panel = null;

    // Save on enter
    if (this.gs) SaveManager.saveToLocal(this.gs);
  }

  openNpcPanel() {
    if (this.panel) return;
    const { width } = this.scale;
    this.panel = drawPanel(this, width / 2 - 140, 80, 280, 120);
    // Mark this panel as the lightweight conversation box (pre-shop)
    this.panel._type = 'npcPrompt';
    const t = this.add.text(width / 2, 110, 'Open Shop?', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const yes = makeTextButton(this, width / 2 - 50, 150, 'Yes', () => { this.openShop(); });
    const no = makeTextButton(this, width / 2 + 50, 150, 'No', () => { this.closePanel([t, yes, no]); });
    this.panel._extra = [t, yes, no];
  }

  openShop() {
    // Ensure any previous shop wheel handler is removed
    try { if (this._shopWheelHandler) { this.input.off('wheel', this._shopWheelHandler); this._shopWheelHandler = null; } } catch (_) {}
    this.closePanel();
    // Open a UI overlay version of the shop so it renders above all UI elements
    try { const ui = this.scene.get(SceneKeys.UI); if (ui && typeof ui.openShopOverlay === 'function') { ui.openShopOverlay(); return; } } catch (_) {}
    const { width } = this.scale;
    // Larger panel to host future category menu + scrollable content
    const panelX = width / 2 - 380;
    const panelY = 40;
    const panelW = 760;
    const panelH = 520;
    this.panel = drawPanel(this, panelX, panelY, panelW, panelH);
    const t = this.add.text(width / 2, panelY + 22, 'Shop', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5);
    const buy = makeTextButton(this, width / 2, panelY + 60, 'Buy potion for 20g (+30 HP)', () => {
      if (this.gs.gold >= 20) {
        this.gs.gold -= 20;
        const effMax = (this.gs.maxHp || 0) + ((getPlayerEffects(this.gs).bonusHp) || 0);
        this.gs.hp = Math.min(effMax, this.gs.hp + 30);
      }
    });
    const buyMax = makeTextButton(this, width / 2, panelY + 90, 'Increase Max HP +10 (40g)', () => {
      if (this.gs.gold >= 40) {
        this.gs.gold -= 40; this.gs.maxHp += 10;
        const effMax = (this.gs.maxHp || 0) + ((getPlayerEffects(this.gs).bonusHp) || 0);
        this.gs.hp = Math.min(effMax, this.gs.hp + 10);
      }
    });
    const dashUp = makeTextButton(this, width / 2, panelY + 120, `Dash Slot +1 (100g) [Now: ${this.gs.dashMaxCharges}]`, () => {
      if (this.gs.dashMaxCharges >= 5) { dashUp.setText(`Dash Slots Maxed [${this.gs.dashMaxCharges}]`); return; }
      if (this.gs.gold >= 100) {
        this.gs.gold -= 100; this.gs.dashMaxCharges = Math.min(5, this.gs.dashMaxCharges + 1);
        dashUp.setText(this.gs.dashMaxCharges >= 5 ? `Dash Slots Maxed [${this.gs.dashMaxCharges}]` : `Dash Slot +1 (100g) [Now: ${this.gs.dashMaxCharges}]`);
      }
    });
    // Scrollable list area for items (weapons / future cores/mods)
    const viewport = { x: panelX + 20, y: panelY + 160, w: panelW - 40, h: panelH - 210 };
    // Dark background behind the scroll area for readability
    const listBgG = this.add.graphics();
    listBgG.fillStyle(0x111111, 0.92).fillRect(viewport.x, viewport.y, viewport.w, viewport.h);
    // Geometry mask shape (hidden) used to clip the scroll list
    const listMaskG = this.add.graphics();
    listMaskG.fillStyle(0xffffff, 1).fillRect(viewport.x, viewport.y, viewport.w, viewport.h);
    const listMask = listMaskG.createGeometryMask();
    try { listMaskG.setVisible(false); } catch (_) {}
    const list = this.add.container(viewport.x, viewport.y);
    list.setMask(listMask);

    const nodes = [];
    // Section header
    const header = this.add.text(viewport.x + 8, viewport.y - 22, 'Weapons', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0, 0.5);
    nodes.push(header);

    // Populate weapons into the scroll container
    // Start slightly lower so the first line isn't clipped by the mask
    let ly = 8;
    const lineGap = 34;
    weaponDefs.forEach((w) => {
      if (!this.gs.ownedWeapons.includes(w.id) && w.price > 0) {
        const row = this.add.container(0, ly);
        const label = this.add.text(viewport.w / 2, 0, `Buy ${w.name} (${w.price}g)`, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5, 0);
        const border = this.add.graphics();
        const refreshBorder = () => {
          border.clear(); border.lineStyle(1, 0xffffff, 1);
          const b = label.getBounds();
          const bx = Math.floor(viewport.w / 2 - b.width / 2) - 6 + 0.5;
          const by = Math.floor(label.y) - 4 + 0.5;
          const bw = Math.ceil(b.width) + 12; const bh = Math.ceil(b.height) + 8;
          border.strokeRect(bx, by, bw, bh);
        };
        refreshBorder();
        row.add(border); row.add(label);
        label.setInteractive({ useHandCursor: true })
          .on('pointerover', () => { label.setStyle({ color: '#ffff66' }); refreshBorder(); })
          .on('pointerout', () => { label.setStyle({ color: '#ffffff' }); refreshBorder(); })
          .on('pointerdown', () => {
            if (this.gs.gold >= w.price) {
              this.gs.gold -= w.price; this.gs.ownedWeapons.push(w.id);
              label.setText(`${w.name} (Owned)`); refreshBorder();
            }
          });
        list.add(row);
        nodes.push(row);
        ly += lineGap;
      }
    });
    const listContentHeight = Math.max(ly, viewport.h);

    // Scroll behavior (mouse wheel within viewport)
    let minY = viewport.y - (listContentHeight - viewport.h);
    let maxY = viewport.y;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const onWheel = (pointer, gameObjects, dx, dy) => {
      const px = pointer.worldX ?? pointer.x; const py = pointer.worldY ?? pointer.y;
      if (px >= viewport.x && px <= viewport.x + viewport.w && py >= viewport.y && py <= viewport.y + viewport.h) {
        list.y = clamp(list.y - dy * 0.5, minY, maxY);
        drawScrollbar();
      }
    };
    this.input.on('wheel', onWheel);
    this._shopWheelHandler = onWheel;

    // Right-side scroll indicator (shows only when scrolling is possible)
    const scrollG = this.add.graphics();
    const drawScrollbar = () => {
      scrollG.clear();
      const canScroll = listContentHeight > viewport.h + 1;
      if (!canScroll) return;
      const trackX = viewport.x + viewport.w - 6; // slim bar near right edge
      const trackY = viewport.y + 4;
      const trackH = viewport.h - 8;
      scrollG.fillStyle(0xffffff, 0.14).fillRoundedRect(trackX, trackY, 3, trackH, 2);
      // Compute current scroll amount from list.y
      const total = listContentHeight - viewport.h;
      const scrolled = (viewport.y - list.y);
      const ratio = Math.max(0, Math.min(1, total > 0 ? (scrolled / total) : 0));
      const thumbH = Math.max(16, Math.floor((viewport.h / listContentHeight) * trackH));
      const thumbY = trackY + Math.floor((trackH - thumbH) * ratio);
      scrollG.fillStyle(0xffffff, 0.6).fillRoundedRect(trackX, thumbY, 3, thumbH, 2);
    };
    // Initial indicator state
    drawScrollbar();

    // Close button stays anchored to bottom of panel
    const close = makeTextButton(this, width / 2, panelY + panelH - 20, 'Close', () => {
      this.closePanel([t, buy, buyMax, dashUp, header, listBgG, list, listMaskG, scrollG, close]);
      try { this.input.off('wheel', onWheel); this._shopWheelHandler = null; } catch (_) {}
    });
    // Track all extras for cleanup on generic close
    this.panel._extra = [t, buy, buyMax, dashUp, header, listBgG, list, listMaskG, scrollG, close];
  }

  openModePanel() {
    if (this.panel) return;
    const { width } = this.scale;
    this.panel = drawPanel(this, width / 2 - 160, 80, 320, 230);
    this.panel._type = 'modeSelect';
    const title = this.add.text(width / 2, 105, 'Select Mode', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5);
    const normalBtn = makeTextButton(this, width / 2 - 70, 145, 'Normal', () => {
      try { this.gs.setGameMode('Normal'); SaveManager.saveToLocal(this.gs); } catch (_) {}
      this.closePanel([title, normalBtn, bossRushBtn, rangeBtn, closeBtn]);
    });
    const bossRushBtn = makeTextButton(this, width / 2 + 70, 145, 'Boss Rush', () => {
      try { this.gs.setGameMode('BossRush'); SaveManager.saveToLocal(this.gs); } catch (_) {}
      this.closePanel([title, normalBtn, bossRushBtn, rangeBtn, closeBtn]);
    });
    const rangeBtn = makeTextButton(this, width / 2, 175, 'Shooting Range', () => {
      try { this.gs.setGameMode('Normal'); this.gs.shootingRange = true; SaveManager.saveToLocal(this.gs); } catch (_) {}
      this.closePanel([title, normalBtn, bossRushBtn, rangeBtn, closeBtn]);
      this.gs.nextScene = SceneKeys.Combat;
      this.scene.start(SceneKeys.Combat);
    });
    const closeBtn = makeTextButton(this, width / 2, 205, 'Close', () => {
      this.closePanel([title, normalBtn, bossRushBtn, rangeBtn, closeBtn]);
    });
    this.panel._extra = [title, normalBtn, bossRushBtn, rangeBtn, closeBtn];
  }

  closePanel(extra = []) {
    // Detach shop wheel handler if active
    try { if (this._shopWheelHandler) { this.input.off('wheel', this._shopWheelHandler); this._shopWheelHandler = null; } } catch (_) {}
    // Always destroy any extras tracked on the current panel
    const extras = [
      ...(Array.isArray(extra) ? extra : []),
      ...(this.panel && Array.isArray(this.panel._extra) ? this.panel._extra : []),
    ];
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    extras.forEach((o) => o?.destroy());
  }

  update() {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);
    // Dash regen progress for UI (0..1) for next slot
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

    const mv = this.inputMgr.moveVec;
    const now = this.time.now;
    if (this.inputMgr.pressedDash && now >= this.dash.cooldownUntil && this.dash.charges > 0) {
      const angle = (mv.x !== 0 || mv.y !== 0) ? Math.atan2(mv.y, mv.x) : this.playerFacing;
      const dashSpeed = 520;
      const dur = 180;
      this.dash.active = true; this.dash.until = now + dur; this.dash.cooldownUntil = now + 600;
      this.dash.vx = Math.cos(angle) * dashSpeed; this.dash.vy = Math.sin(angle) * dashSpeed;
      this.player.iframesUntil = now + dur;
      // Initialize dash trail start
      this._dashTrailLast = { x: this.player.x, y: this.player.y };
      this.dash.charges -= 1; this.dash.regen.push(now + (eff.dashRegenMs || this.gs.dashRegenMs));
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
      const speed = 160 * (eff.moveSpeedMult || 1);
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

    // Interaction
    const nearNpc = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.npcZone.getBounds());
    const nearModeNpc = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.modeNpcZone.getBounds());
    const nearPortal = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.portalZone.getBounds());
    if (nearNpc) this.prompt.setText('E: Shop');
    else if (nearModeNpc) this.prompt.setText('E: Select Mode');
    else if (nearPortal) this.prompt.setText(this.gs?.gameMode === 'BossRush' ? 'E: Enter Boss' : 'E: Enter Combat');
    else this.prompt.setText('WASD move, E interact');

    // Auto-close the conversation box if player moves away from NPC
    if (this.panel && this.panel._type === 'npcPrompt') {
      const dx = this.player.x - this.npcZone.x;
      const dy = this.player.y - this.npcZone.y;
      const dist = Math.hypot(dx, dy);
      const closeDist = 100; // pixels threshold to auto-close
      if (dist > closeDist) {
        this.closePanel();
      }
    }

    if (this.inputMgr.pressedInteract) {
      if (nearNpc) this.openNpcPanel();
      if (nearModeNpc) this.openModePanel();
      if (nearPortal) {
        let next = (this.gs?.gameMode === 'BossRush') ? SceneKeys.Boss : SceneKeys.Combat;
        // Ensure Boss Rush queue is ready when entering boss portal
        try {
          if (next === SceneKeys.Boss && this.gs && (!Array.isArray(this.gs.bossRushQueue) || this.gs.bossRushQueue.length === 0)) {
            this.gs.setGameMode('BossRush');
          }
        } catch (_) {}
        this.gs.nextScene = next;
        SaveManager.saveToLocal(this.gs);
        this.scene.start(next);
      }
    }

    // Allow swapping weapons in the Hub with Q
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
    }
  }
}
