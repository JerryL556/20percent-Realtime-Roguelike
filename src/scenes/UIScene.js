import { SceneKeys } from '../core/SceneKeys.js';
import { HpBar } from '../ui/HpBar.js';
import { DashBar } from '../ui/DashBar.js';
import { makeTextButton } from '../ui/Buttons.js';
import { SaveManager } from '../core/SaveManager.js';
import { getPlayerEffects } from '../core/Loadout.js';
import { weaponMods, weaponCores, armourMods, armourDefs } from '../core/Mods.js';
import { getWeaponById } from '../core/Weapons.js';

export default class UIScene extends Phaser.Scene {
  constructor() { super(SceneKeys.UI); }

  create() {
    const { width, height } = this.scale;
    // Place combat UI along the bottom
    this.hpBar = new HpBar(this, 16, Math.max(12, height - 28), 180, 16);
    this.goldText = this.add.text(210, 8, 'Gold: 0', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' });
    this.weaponText = this.add.text(width / 2, Math.max(8, height - 32), 'Weapon: -', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' }).setOrigin(0.5, 0);
    this.dashBar = new DashBar(this, 16 + 180 + 20, Math.max(8, height - 22), 14, 4);
    // Hint to open loadout with Tab (left side)
    this.loadoutHint = this.add.text(12, height * 0.5, 'Loadout (TAB)', { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' }).setOrigin(0, 0.5).setAlpha(0.9);
    

    let x = width - 240;
    makeTextButton(this, x, 16, 'Save', () => {
      const gs = this.registry.get('gameState');
      if (gs) SaveManager.saveToLocal(gs);
    }).setOrigin(0, 0);
    makeTextButton(this, x + 70, 16, 'Download', () => {
      const gs = this.registry.get('gameState');
      if (gs) SaveManager.download(gs);
    }).setOrigin(0, 0);
    makeTextButton(this, x + 170, 16, 'Load', async () => {
      const gs = await SaveManager.uploadFromFile();
      if (gs) {
        this.registry.set('gameState', gs);
        SaveManager.saveToLocal(gs);
      }
    }).setOrigin(0, 0);

    // Loadout overlay state and keybind
    this.loadout = { panel: null, nodes: [] };
    this.choicePopup = null;
    this.keys = this.input.keyboard.addKeys({ tab: 'TAB' });

    this.events.on('shutdown', () => {
      this.hpBar.destroy();
      this.dashBar.destroy();
      this.closeLoadout();
      this.closeChoicePopup();
    });
  }

  update() {
    const gs = this.registry.get('gameState');
    if (gs) {
      const eff = getPlayerEffects(gs);
      const effectiveMax = (gs.maxHp || 0) + (eff.bonusHp || 0);
      this.hpBar.draw(gs.hp, effectiveMax);
      this.goldText.setText(`Gold: ${gs.gold}`);
      this.weaponText.setText(`Weapon: ${gs.activeWeapon}`);
      const charges = this.registry.get('dashCharges');
      const progress = this.registry.get('dashRegenProgress') ?? 0;
      const maxC = gs.dashMaxCharges ?? 3;
      const c = (charges === undefined || charges === null) ? maxC : charges;
      this.dashBar.draw(c, maxC, progress);
      // Keep highlights in sync: each mod line yellow if that slot has a mod; core line if core equipped;
      // weapon slots if equipped; armour equip + armour mods similarly.
      if (this.loadout?.panel && (this.loadout.modLabels || this.loadout.weaponLabels || this.loadout.armourLabel || this.loadout.armourModLabels)) {
        try {
          const wb = gs.weaponBuilds && gs.weaponBuilds[gs.activeWeapon];
          const hasCore = !!(wb && wb.core);
          (this.loadout.modLabels || []).forEach((lbl, i) => {
            const hasMod = !!(wb && wb.mods && wb.mods[i]);
            lbl?.setStyle({ color: hasMod ? '#ffff33' : '#cccccc' });
          });
          if (this.loadout.coreLabel) this.loadout.coreLabel.setStyle({ color: hasCore ? '#ffff33' : '#cccccc' });
          // Weapon slots
          const slots = gs.equippedWeapons || [];
          (this.loadout.weaponLabels || []).forEach((lbl, i) => {
            const hasW = !!slots[i];
            lbl?.setStyle({ color: hasW ? '#ffff33' : '#cccccc' });
          });
          // Armour equip + mods
          if (this.loadout.armourLabel) this.loadout.armourLabel.setStyle({ color: (gs.armour && gs.armour.id) ? '#ffff33' : '#cccccc' });
          (this.loadout.armourModLabels || []).forEach((lbl, i) => {
            const hasAm = !!(gs.armour && gs.armour.mods && gs.armour.mods[i]);
            lbl?.setStyle({ color: hasAm ? '#ffff33' : '#cccccc' });
          });
        } catch (e) { /* no-op */ }
      }
    }

    

    // Toggle loadout overlay with Tab
    if (Phaser.Input.Keyboard.JustDown(this.keys.tab)) {
      if (this.loadout.panel) this.closeLoadout(); else this.openLoadout();
    }
  }

  openLoadout() {
    const gs = this.registry.get('gameState');
    if (!gs || this.loadout.panel) return;
    const { width, height } = this.scale;
    const nodes = [];
    const panel = this.add.graphics();

    // 3-column layout panel
    const panelW = 780; const panelH = 520; const top = 40;
    const left = width / 2 - panelW / 2;
    panel.fillStyle(0x111111, 0.92).fillRect(left, top, panelW, panelH);
    panel.lineStyle(2, 0xffffff, 1).strokeRect(left, top, panelW, panelH);
    nodes.push(this.add.text(width / 2, top + 12, 'Loadout & Stats (Tab to close)', { fontFamily: 'monospace', fontSize: 18, color: '#ffffff' }).setOrigin(0.5));

    // Columns (Stats removed)
    const col2X = left + 40;    // Weapons + Mods/Core (wider)
    const col3X = left + 420;   // Armour

    // Weapons (Column 2)
    let y2 = top + 56;
    nodes.push(this.add.text(col2X, y2, 'Weapons', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y2 += 28;
    const slotLine = (slotIdx) => {
      const wy = y2; y2 += 32;
      const getName = () => {
        const id = gs.equippedWeapons[slotIdx];
        return id ? (getWeaponById(id)?.name || id) : '-';
      };
      const label = this.add.text(col2X, wy, `Slot ${slotIdx + 1}: ${getName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' });
      nodes.push(label);
      try { this.loadout.weaponLabels[slotIdx] = label; label.setStyle({ color: (gs.equippedWeapons && gs.equippedWeapons[slotIdx]) ? '#ffff33' : '#cccccc' }); } catch (e) {}
      const btn = makeTextButton(this, col2X + 210, wy + 8, 'Choose…', () => {
        const list = (gs.ownedWeapons || []).map((id) => ({ id, name: getWeaponById(id)?.name || id }));
        if (!list.length) return;
        const current = gs.equippedWeapons[slotIdx] || null;
        this.openChoicePopup(`Choose Weapon (Slot ${slotIdx + 1})`, list, current, (chosenId) => {
          const prev = gs.equippedWeapons[slotIdx];
          gs.equippedWeapons[slotIdx] = chosenId;
          if (gs.activeWeapon === prev) gs.activeWeapon = chosenId;
          label.setText(`Slot ${slotIdx + 1}: ${getName()}`);
          try { label.setStyle({ color: chosenId ? '#ffff33' : '#cccccc' }); } catch (e) {}
          SaveManager.saveToLocal(gs);
        });
      }).setOrigin(0, 0.5);
      nodes.push(btn);
    };
    slotLine(0);
    slotLine(1);
    y2 += 16;
    const makeActive = makeTextButton(this, col2X, y2, `Active: ${(getWeaponById(gs.activeWeapon)?.name || gs.activeWeapon)}`, () => {
      const opts = (gs.equippedWeapons || []).filter(Boolean).map((id) => ({ id, name: getWeaponById(id)?.name || id }));
      if (!opts.length) return;
      this.openChoicePopup('Set Active Weapon', opts, gs.activeWeapon, (chosenId) => {
        gs.activeWeapon = chosenId;
        makeActive.setText(`Active: ${(getWeaponById(gs.activeWeapon)?.name || gs.activeWeapon)}`);
        SaveManager.saveToLocal(gs);
        // Rebuild mods/core section to reflect the newly active weapon
        try { this.time.delayedCall(0, () => { this.reopenLoadout?.(); }); } catch (e) { try { this.reopenLoadout?.(); } catch (_) {} }
      });
    }).setOrigin(0, 0.5);
    nodes.push(makeActive);
    y2 += 40;

    // Mods/Core for Active Weapon (Column 2)
    if (!gs.weaponBuilds[gs.activeWeapon]) gs.weaponBuilds[gs.activeWeapon] = { mods: [null, null, null], core: null };
    nodes.push(this.add.text(col2X, y2, `Mods for ${gs.activeWeapon}`, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y2 += 28;
    const ensureBuild = () => { if (!gs.weaponBuilds[gs.activeWeapon]) gs.weaponBuilds[gs.activeWeapon] = { mods: [null, null, null], core: null }; };
    this.loadout.modLabels = [];
    const modLine = (idx) => {
      const wy = y2; y2 += 30;
      const getName = () => {
        const id = gs.weaponBuilds[gs.activeWeapon].mods[idx];
        const m = weaponMods.find((x) => x.id === id) || weaponMods[0];
        return m.name;
      };
      const hasMod = !!(gs.weaponBuilds[gs.activeWeapon].mods[idx]);
      const label = this.add.text(col2X, wy, `Mod ${idx + 1}: ${getName()}`, { fontFamily: 'monospace', fontSize: 14, color: hasMod ? '#ffff33' : '#cccccc' });
      nodes.push(label);
      this.loadout.modLabels.push(label);
      const btn = makeTextButton(this, col2X + 210, wy + 8, 'Choose…', () => {
        ensureBuild();
        const opts = weaponMods.map((m) => ({ id: m.id, name: m.name, desc: m.desc }));
        this.openChoicePopup('Choose Mod', opts, gs.weaponBuilds[gs.activeWeapon].mods[idx], (chosenId) => {
          gs.weaponBuilds[gs.activeWeapon].mods[idx] = chosenId;
          label.setText(`Mod ${idx + 1}: ${(weaponMods.find((m) => m.id === chosenId) || weaponMods[0]).name}`);
          const hasModNow = !!chosenId;
          label.setStyle({ color: hasModNow ? '#ffff33' : '#cccccc' });
          SaveManager.saveToLocal(gs);
        });
      }).setOrigin(0, 0.5);
      nodes.push(btn);
    };
    modLine(0); modLine(1); modLine(2);
    const coreWy = y2; y2 += 34;
    const coreLabel = this.add.text(col2X, coreWy, `Core: ${(weaponCores.find((c) => c.id === (gs.weaponBuilds[gs.activeWeapon].core || null)) || weaponCores[0]).name}`, { fontFamily: 'monospace', fontSize: 14, color: (!!gs.weaponBuilds[gs.activeWeapon].core) ? '#ffff33' : '#cccccc' }); nodes.push(coreLabel); this.loadout.coreLabel = coreLabel;
    const coreBtn = makeTextButton(this, col2X + 210, coreWy + 8, 'Choose…', () => {
      ensureBuild();
      const activeId = gs.activeWeapon;
      const opts = weaponCores
        .filter((c) => !c.onlyFor || c.onlyFor === activeId)
        .map((c) => ({ id: c.id, name: c.name, desc: c.desc }));
      this.openChoicePopup('Choose Core', opts, gs.weaponBuilds[gs.activeWeapon].core, (chosenId) => {
        gs.weaponBuilds[gs.activeWeapon].core = chosenId;
        const picked = (weaponCores.find((c) => c.id === chosenId) || weaponCores[0]);
        coreLabel.setText(`Core: ${picked.name}`);
        const isOn = !!chosenId;
        coreLabel.setStyle({ color: isOn ? '#ffff33' : '#cccccc' });
        SaveManager.saveToLocal(gs);
      });
    }).setOrigin(0, 0.5);
    nodes.push(coreBtn);

    // Armour (Column 3)
    let y3 = top + 56;
    nodes.push(this.add.text(col3X, y3, 'Armour', { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' })); y3 += 28;
    const armourName = () => (armourDefs.find((a) => a.id === (gs.armour?.id || null)) || armourDefs[0]).name;
    const armourLabel = this.add.text(col3X, y3, `Equipped: ${armourName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' }); nodes.push(armourLabel);
    try { this.loadout.armourLabel = armourLabel; armourLabel.setStyle({ color: (gs.armour && gs.armour.id) ? '#ffff33' : '#cccccc' }); } catch (e) {}
    const armourBtn = makeTextButton(this, col3X + 210, y3 + 8, 'Choose…', () => {
      const opts = armourDefs.map((a) => ({ id: a.id, name: a.name }));
      const cur = gs.armour?.id || null;
      this.openChoicePopup('Choose Armour', opts, cur, (chosenId) => {
        gs.armour = gs.armour || { id: null, mods: [null, null] };
        gs.armour.id = chosenId;
      armourLabel.setText(`Equipped: ${armourName()}`);
      try { armourLabel.setStyle({ color: (gs.armour && gs.armour.id) ? '#ffff33' : '#cccccc' }); } catch (e) {}
      SaveManager.saveToLocal(gs);
      });
    }).setOrigin(0, 0.5); nodes.push(armourBtn); y3 += 36;
    const armourModLine = (idx) => {
      const wy = y3; y3 += 30;
      const getName = () => (armourMods.find((m) => m.id === (gs.armour?.mods?.[idx] ?? null)) || armourMods[0]).name;
      const lab = this.add.text(col3X, wy, `Mod ${idx + 1}: ${getName()}`, { fontFamily: 'monospace', fontSize: 14, color: '#cccccc' }); nodes.push(lab);
      try { this.loadout.armourModLabels[idx] = lab; lab.setStyle({ color: (gs.armour && gs.armour.mods && gs.armour.mods[idx]) ? '#ffff33' : '#cccccc' }); } catch (e) {}
      const btn = makeTextButton(this, col3X + 210, wy + 8, 'Choose…', () => {
        gs.armour = gs.armour || { id: null, mods: [null, null] };
        const opts = armourMods.map((m) => ({ id: m.id, name: m.name, desc: m.desc }));
        const cur = gs.armour.mods[idx] || null;
        this.openChoicePopup(`Choose Armour Mod ${idx + 1}`, opts, cur, (chosenId) => {
          gs.armour.mods[idx] = chosenId;
          lab.setText(`Mod ${idx + 1}: ${(armourMods.find((m) => m.id === chosenId) || armourMods[0]).name}`);
          try { lab.setStyle({ color: chosenId ? '#ffff33' : '#cccccc' }); } catch (e) {}
          SaveManager.saveToLocal(gs);
        });
      }).setOrigin(0, 0.5);
      nodes.push(btn);
    };
    armourModLine(0); armourModLine(1);

    // Close hint
    nodes.push(this.add.text(width / 2, top + panelH + 30, 'Press Tab to close', { fontFamily: 'monospace', fontSize: 12, color: '#999999' }).setOrigin(0.5));

    this.loadout.panel = panel; this.loadout.nodes = nodes;
  }

  closeLoadout() {
    if (this.loadout.panel) { this.loadout.panel.destroy(); this.loadout.panel = null; }
    (this.loadout.nodes || []).forEach((n) => n?.destroy());
    this.loadout.nodes = [];
    this.loadout.modLabels = [];
    this.loadout.coreLabel = null;
    this.closeChoicePopup();
  }

  // Helper to refresh the loadout overlay without the user having to toggle Tab
  reopenLoadout() {
    this.closeLoadout();
    this.openLoadout();
  }

  openChoicePopup(title, options, currentId, onChoose) {
    // Prevent multiple popups
    this.closeChoicePopup();
    const { width, height } = this.scale;
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.5).fillRect(0, 0, width, height);
    const panel = this.add.graphics();
    const w = 420;
    // Compute dynamic height based on options and their descriptions (with extra spacing)
    let contentHeight = 0;
    options.forEach((opt) => {
      const desc = (opt.desc || '').split('\n').filter((s) => s.trim().length > 0);
      const nameH = 26; // taller name row
      const lineH = 20; // more spacing per description line
      const afterGap = desc.length ? 10 : 8; // extra gap between options
      const block = nameH + (desc.length * lineH) + afterGap;
      contentHeight += block;
    });
    const maxH = Math.min(520, Math.max(120, 60 + contentHeight));
    const x = (width - w) / 2; const y = (height - maxH) / 2;
    panel.fillStyle(0x1a1a1a, 0.96).fillRect(x, y, w, maxH);
    panel.lineStyle(2, 0xffffff, 1).strokeRect(x, y, w, maxH);
    const nodes = [];
    nodes.push(this.add.text(x + w / 2, y + 12, title, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5));
    let yy = y + 48;
    options.forEach((opt) => {
      const isCurrent = opt.id === currentId;
      const name = opt.name + (isCurrent ? ' (current)' : '');
      const btn = makeTextButton(this, x + 16, yy, name, () => {
        try { onChoose?.(opt.id); } finally { this.closeChoicePopup(); }
      }).setOrigin(0, 0.5);
      nodes.push(btn);
      yy += 26;
      if (opt.desc) {
        const lines = opt.desc.split('\n');
        lines.forEach((ln) => {
          const t = ln.trim(); if (!t) return;
          let color = '#cccccc';
          const lower = t.toLowerCase();
          const positiveHints = ['increase', 'faster', 'higher', 'improve', 'improved', 'boost', 'bonus', 'gain'];
          const negativeHints = ['decrease', 'slower', 'lower', 'worse', 'penalty'];
          const beneficialNegTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
          const harmfulPosTerms = ['spread', 'recoil', 'cooldown', 'reload', 'heat', 'delay', 'cost', 'consumption'];
          if (t.startsWith('+')) {
            const isHarmfulPos = harmfulPosTerms.some((term) => lower.includes(term));
            color = isHarmfulPos ? '#ff6666' : '#66ff66';
          } else if (t.startsWith('-')) {
            // Some negatives are beneficial (e.g., -spread)
            const isBeneficialNeg = beneficialNegTerms.some((term) => lower.includes(term)) || lower.includes('less') || lower.includes('reduced');
            color = isBeneficialNeg ? '#66ff66' : '#ff6666';
          } else if (positiveHints.some((k) => lower.includes(k))) {
            color = '#66ff66';
          } else if (negativeHints.some((k) => lower.includes(k))) {
            color = '#ff6666';
          }
          nodes.push(this.add.text(x + 24, yy, t, { fontFamily: 'monospace', fontSize: 12, color }).setOrigin(0, 0.5));
          yy += 20;
        });
        yy += 10;
      } else {
        yy += 8;
      }
    });
    // Footer close button
    const closeBtn = makeTextButton(this, x + w - 16, y + maxH - 16, 'Close', () => this.closeChoicePopup()).setOrigin(1, 1);
    nodes.push(closeBtn);
    this.choicePopup = { overlay, panel, nodes };
  }

  closeChoicePopup() {
    if (!this.choicePopup) return;
    this.choicePopup.overlay?.destroy();
    this.choicePopup.panel?.destroy();
    (this.choicePopup.nodes || []).forEach((n) => n?.destroy());
    this.choicePopup = null;
  }
}
