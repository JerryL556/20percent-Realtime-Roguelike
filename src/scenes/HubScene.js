import { SceneKeys } from '../core/SceneKeys.js';
import { InputManager } from '../core/Input.js';
import { SaveManager } from '../core/SaveManager.js';
import { drawPanel } from '../ui/Panels.js';
import { makeTextButton } from '../ui/Buttons.js';
import { weaponDefs } from '../core/Weapons.js';

export default class HubScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Hub); }

  create() {
    const { width, height } = this.scale;
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

    // NPC vendor (static)
    this.npcZone = this.add.zone(width / 2, height / 2 - 20, 40, 40);
    this.physics.world.enable(this.npcZone);
    this.npcZone.body.setAllowGravity(false);
    this.npcZone.body.setImmovable(true);
    this.npcG = this.add.graphics();
    this.npcG.fillStyle(0x44aaff, 1).fillRect(this.npcZone.x - 10, this.npcZone.y - 10, 20, 20);

    // Portal to Combat
    this.portalZone = this.add.zone(width - 60, height / 2, 40, 80);
    this.physics.world.enable(this.portalZone);
    this.portalZone.body.setAllowGravity(false);
    this.portalZone.body.setImmovable(true);
    this.portalG = this.add.graphics();
    this.portalG.fillStyle(0x22ff88, 1).fillRect(this.portalZone.x - 10, this.portalZone.y - 20, 20, 40);

    // Overlap detection
    this.physics.add.overlap(this.player, this.npcZone);
    this.physics.add.overlap(this.player, this.portalZone);

    // UI prompt
    this.prompt = this.add.text(width / 2, height - 30, 'WASD move, E interact', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5);

    // Dialogue/Shop panel hidden
    this.panel = null;

    // Save on enter
    if (this.gs) SaveManager.saveToLocal(this.gs);
  }

  openNpcPanel() {
    if (this.panel) return;
    const { width } = this.scale;
    this.panel = drawPanel(this, width / 2 - 140, 80, 280, 120);
    const t = this.add.text(width / 2, 110, 'Open Shop?', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const yes = makeTextButton(this, width / 2 - 50, 150, 'Yes', () => { this.openShop(); });
    const no = makeTextButton(this, width / 2 + 50, 150, 'No', () => { this.closePanel([t, yes, no]); });
    this.panel._extra = [t, yes, no];
  }

  openShop() {
    this.closePanel();
    const { width } = this.scale;
    this.panel = drawPanel(this, width / 2 - 220, 70, 440, 260);
    const t = this.add.text(width / 2, 92, 'Shop', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    const buy = makeTextButton(this, width / 2, 130, 'Buy potion for 20g (+30 HP)', () => {
      if (this.gs.gold >= 20) { this.gs.gold -= 20; this.gs.hp = Math.min(this.gs.maxHp, this.gs.hp + 30); }
    });
    const buyMax = makeTextButton(this, width / 2, 160, 'Increase Max HP +10 (40g)', () => {
      if (this.gs.gold >= 40) { this.gs.gold -= 40; this.gs.maxHp += 10; this.gs.hp = Math.min(this.gs.maxHp, this.gs.hp + 10); }
    });
    const dashUp = makeTextButton(this, width / 2, 190, `Dash Slot +1 (100g) [Now: ${this.gs.dashMaxCharges}]`, () => {
      if (this.gs.dashMaxCharges >= 5) { dashUp.setText(`Dash Slots Maxed [${this.gs.dashMaxCharges}]`); return; }
      if (this.gs.gold >= 100) {
        this.gs.gold -= 100; this.gs.dashMaxCharges = Math.min(5, this.gs.dashMaxCharges + 1);
        dashUp.setText(this.gs.dashMaxCharges >= 5 ? `Dash Slots Maxed [${this.gs.dashMaxCharges}]` : `Dash Slot +1 (100g) [Now: ${this.gs.dashMaxCharges}]`);
      }
    });

    // Auto-list unowned weapons from config
    const startY = 220; let y = startY; const nodes = [];
    weaponDefs.forEach((w) => {
      if (!this.gs.ownedWeapons.includes(w.id) && w.price > 0) {
        const btn = makeTextButton(this, width / 2, y, `Buy ${w.name} (${w.price}g)`, () => {
          if (this.gs.gold >= w.price) { this.gs.gold -= w.price; this.gs.ownedWeapons.push(w.id); btn.setText(`${w.name} (Owned)`); }
        });
        nodes.push(btn); y += 28;
      }
    });

    const close = makeTextButton(this, width / 2, y + 10, 'Close', () => { this.closePanel([t, buy, buyMax, dashUp, ...nodes, close]); });
    this.panel._extra = [t, buy, buyMax, dashUp, ...nodes, close];
  }

  closePanel(extra = []) {
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    }
    extra.forEach((o) => o?.destroy());
  }

  update() {
    // Update dash charge display for UI
    this.registry.set('dashCharges', this.dash.charges);

    const mv = this.inputMgr.moveVec;
    const now = this.time.now;
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
      const speed = 160;
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
    const nearPortal = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.portalZone.getBounds());
    if (nearNpc) this.prompt.setText('E: Talk');
    else if (nearPortal) this.prompt.setText('E: Enter Combat');
    else this.prompt.setText('WASD move, E interact');

    if (this.inputMgr.pressedInteract) {
      if (nearNpc) this.openNpcPanel();
      if (nearPortal) {
        this.gs.nextScene = SceneKeys.Combat;
        SaveManager.saveToLocal(this.gs);
        this.scene.start(SceneKeys.Combat);
      }
    }
  }
}
