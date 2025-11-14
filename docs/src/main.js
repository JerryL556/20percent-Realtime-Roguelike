import BootScene from './scenes/BootScene.js';
import StartScene from './scenes/StartScene.js';
import MenuScene from './scenes/MenuScene.js';
import HubScene from './scenes/HubScene.js';
import CombatScene from './scenes/CombatScene.js';
import UIScene from './scenes/UIScene.js';
import { SceneKeys } from './core/SceneKeys.js';
import { Config } from './core/Config.js';

const gameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: Config.width,
  height: Config.height,
  backgroundColor: '#121212',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    StartScene,
    MenuScene,
    HubScene,
    CombatScene,
    UIScene,
  ],
};

// eslint-disable-next-line no-new
new Phaser.Game(gameConfig);
