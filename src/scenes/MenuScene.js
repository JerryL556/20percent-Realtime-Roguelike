import { SceneKeys } from '../core/SceneKeys.js';
import { SaveManager } from '../core/SaveManager.js';
import { Difficulty } from '../core/GameState.js';
import { makeTextButton } from '../ui/Buttons.js';

export default class MenuScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Menu); }

  create() {
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
      const state = this.registry.get('gameState');
      if (state) {
        state.difficulty = difficulties[idx];
        SaveManager.saveToLocal(state);
      }
    });

    makeTextButton(this, width / 2, height - 80, 'Back', () => {
      this.scene.start(SceneKeys.Start);
    });
  }
}

