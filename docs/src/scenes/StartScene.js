import { SceneKeys } from '../core/SceneKeys.js';
import { SaveManager } from '../core/SaveManager.js';
import { GameState, Difficulty } from '../core/GameState.js';
import { makeTextButton } from '../ui/Buttons.js';

export default class StartScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Start); }

  create() {
    // Ensure in-game UI is not visible on the start menu
    try { this.scene.stop(SceneKeys.UI); } catch (e) { /* ignore if not running */ }
    const { width, height } = this.scale;
    // Title logo image (scaled down)
    try {
      const logo = this.add.image(width / 2, height / 2 - 80, 'title_logo');
      logo.setOrigin(0.5);
      const desiredWidth = Math.min(width * 0.6, logo.width);
      const scale = desiredWidth / logo.width;
      logo.setScale(scale);
    } catch (e) {
      // Fallback to text if texture missing
      this.add.text(width / 2, height / 2 - 80, 'Roguelike Action', { fontFamily: 'monospace', fontSize: 28, color: '#ffffff' }).setOrigin(0.5);
    }

    makeTextButton(this, width / 2, height / 2, 'New Run', () => {
      // Respect previously chosen difficulty from registry or saved data
      const saved = SaveManager.loadFromLocal();
      const prev = saved || this.registry.get('gameState');
      const chosenDiff = prev?.difficulty || Difficulty.Normal;
      const gs = new GameState();
      gs.startNewRun(undefined, chosenDiff);
      // Default weapon loadout
      gs.ownedWeapons = ['pistol'];
      gs.activeWeapon = 'pistol';
      this.registry.set('gameState', gs);
      SaveManager.saveToLocal(gs);
      this.scene.start(SceneKeys.Hub);
    });

    makeTextButton(this, width / 2, height / 2 + 40, 'Continue', () => {
      const loaded = SaveManager.loadFromLocal();
      if (loaded) {
        this.registry.set('gameState', loaded);
        const next = loaded.nextScene || SceneKeys.Hub;
        this.scene.start(next);
      } else {
        this.add.text(width / 2, height / 2 + 100, 'No save found', { fontFamily: 'monospace', fontSize: 14, color: '#ff6666' }).setOrigin(0.5);
      }
    });

    makeTextButton(this, width / 2, height / 2 + 80, 'Menu', () => {
      this.scene.start(SceneKeys.Menu);
    });

    // Manual save management at title screen
    const baseX = width - 240;
    const topY = 20;
    const getState = () => this.registry.get('gameState') || SaveManager.loadFromLocal();
    makeTextButton(this, baseX, topY, 'Save', () => {
      const gs = this.registry.get('gameState');
      if (gs) SaveManager.saveToLocal(gs);
    }).setOrigin(0, 0);
    makeTextButton(this, baseX + 70, topY, 'Download', () => {
      const gs = getState();
      if (gs) SaveManager.download(gs);
    }).setOrigin(0, 0);
    makeTextButton(this, baseX + 170, topY, 'Load', async () => {
      const gs = await SaveManager.uploadFromFile();
      if (gs) {
        this.registry.set('gameState', gs);
        SaveManager.saveToLocal(gs);
      }
    }).setOrigin(0, 0);
  }
}
