import { SceneKeys } from '../core/SceneKeys.js';
import { SaveManager } from '../core/SaveManager.js';
import { Difficulty } from '../core/GameState.js';
import { makeTextButton } from '../ui/Buttons.js';

export default class MenuScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Menu); }

  create() {
    // Ensure in-game UI is hidden while in the menu
    try { this.scene.stop(SceneKeys.UI); } catch (e) { /* ignore if not running */ }
    const { width, height } = this.scale;
    this.add.text(width / 2, 60, 'Menu - Customization & Settings', { fontFamily: 'monospace', fontSize: 20, color: '#ffffff' }).setOrigin(0.5);

    const gs = this.registry.get('gameState');
    const difficulties = [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard];
    let idx = gs ? difficulties.indexOf(gs.difficulty) : 1;
    const diffText = this.add.text(width / 2, 130, `Difficulty: ${difficulties[idx]}`, { fontFamily: 'monospace', fontSize: 16, color: '#ffffff' }).setOrigin(0.5);
    makeTextButton(this, width / 2, 170, 'Cycle Difficulty', () => {
      idx = (idx + 1) % difficulties.length;
      diffText.setText(`Difficulty: ${difficulties[idx]}`);
    });

    makeTextButton(this, width / 2, 230, 'Apply Settings', () => {
      let state = this.registry.get('gameState');
      if (!state) {
        // Create a lightweight state to persist difficulty preference
        state = SaveManager.loadFromLocal() || { difficulty: difficulties[idx] };
      }
      state.difficulty = difficulties[idx];
      this.registry.set('gameState', state);
      SaveManager.saveToLocal(state);
    });

    makeTextButton(this, width / 2, height - 80, 'Back', () => {
      this.scene.start(SceneKeys.Start);
    });

    // Keybinds (bottom-right, small font)
    const binds = [
      'W/A/S/D: Move',
      'Space: Dash',
      'E: Interact',
      'LMB: Shoot',
      'Q: Swap Weapon',
    ].join('\n');
    this.add.text(width - 10, height - 10, binds, { fontFamily: 'monospace', fontSize: 12, color: '#cccccc' })
      .setOrigin(1, 1)
      .setAlpha(0.9);
  }
}
