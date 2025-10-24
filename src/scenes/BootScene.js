import { SceneKeys } from '../core/SceneKeys.js';
import { preloadWeaponAssets } from '../systems/WeaponVisuals.js';

export default class BootScene extends Phaser.Scene {
  constructor() { super(SceneKeys.Boot); }
  preload() {
    // Load external PNG assets for weapons
    try { preloadWeaponAssets(this); } catch (_) {}
    // Generate simple textures used by bullets and optional sprites
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 4, 4);
    g.generateTexture('bullet', 4, 4);
    g.clear(); g.fillStyle(0xffffff, 1); g.fillRect(0, 0, 12, 12);
    g.generateTexture('player_square', 12, 12);
    g.clear(); g.fillStyle(0xff4444, 1); g.fillRect(0, 0, 12, 12);
    g.generateTexture('enemy_square', 12, 12);
    // Portal (simple ring)
    g.clear();
    g.fillStyle(0x00ffcc, 0.25); g.fillCircle(12, 12, 12);
    g.lineStyle(2, 0x22ff88, 1).strokeCircle(12, 12, 10);
    g.generateTexture('portal', 24, 24);
    // Wall tile
    g.clear(); g.fillStyle(0x666666, 1); g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x999999, 1).strokeRect(0, 0, 16, 16);
    g.generateTexture('wall_tile', 16, 16);
    // Barricade tiles
    // Destructible (light brown)
    g.clear(); g.fillStyle(0xC8A165, 1); g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x9c7b4a, 1).strokeRect(0, 0, 16, 16);
    g.generateTexture('barricade_soft', 16, 16);
    // Indestructible (light grey)
    g.clear(); g.fillStyle(0xBBBBBB, 1); g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0x8f8f8f, 1).strokeRect(0, 0, 16, 16);
    g.generateTexture('barricade_hard', 16, 16);
    g.destroy();
  }
  create() {
    this.scene.start(SceneKeys.Start);
  }
}

