import { SceneKeys } from '../core/SceneKeys.js';
import { HpBar } from '../ui/HpBar.js';
import { makeTextButton } from '../ui/Buttons.js';
import { SaveManager } from '../core/SaveManager.js';

export default class UIScene extends Phaser.Scene {
  constructor() { super(SceneKeys.UI); }

  create() {
    const { width } = this.scale;
    this.hpBar = new HpBar(this, 16, 12, 180, 16);
    this.goldText = this.add.text(210, 8, 'Gold: 0', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' });
    this.weaponText = this.add.text(310, 8, 'Weapon: -', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' });
    this.dashText = this.add.text(460, 8, 'Dash: -', { fontFamily: 'monospace', fontSize: 14, color: '#ffffff' });

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

    this.events.on('shutdown', () => { this.hpBar.destroy(); });
  }

  update() {
    const gs = this.registry.get('gameState');
    if (gs) {
      this.hpBar.draw(gs.hp, gs.maxHp);
      this.goldText.setText(`Gold: ${gs.gold}`);
      this.weaponText.setText(`Weapon: ${gs.activeWeapon}`);
      const charges = this.registry.get('dashCharges');
      const maxC = gs.dashMaxCharges ?? 3;
      const c = (charges === undefined || charges === null) ? maxC : charges;
      this.dashText.setText(`Dash: ${c}/${maxC}`);
    }
  }
}
