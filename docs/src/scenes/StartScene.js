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
    this.add.text(width / 2, height / 2 - 80, 'Roguelike Action', { fontFamily: 'monospace', fontSize: 28, color: '#ffffff' }).setOrigin(0.5);

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
  }
}
