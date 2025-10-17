# 25percent-Project

## Current Status
Early prototype. Core scenes and systems are scaffolded (Boot, Start, Menu, Hub, Combat, Boss, UI) and placeholder graphics are generated at runtime. Expect incomplete features and occasional bugs while gameplay, art, and balance are still in progress.

## Systems Overview
- Game State & Saving
  - `src/core/GameState.js`: Tracks gold, HP, difficulty, dash charges, owned/equipped weapons, armour, and run seed. Handles scene progression (3 rooms → Boss → Hub) and provides difficulty modifiers.
  - `src/core/SaveManager.js`: Saves/loads to `localStorage`, plus export/import via JSON download/upload.
- Input
  - `src/core/Input.js`: WASD move, Space dash, E interact, LMB shoot, Q swap weapon, Tab open/close Loadout overlay.
- Weapons, Mods, and Loadout
  - `src/core/Weapons.js`: Defines base weapons (pistol, rifle, shotgun) with damage, fire rate, spread, etc.
  - `src/core/Mods.js`: Three weapon mod slots and one core slot (e.g., +damage, +fire rate, pierce/explosive core). Armour has 2 mod slots (e.g., bonus HP, faster dash regen).
  - `src/core/Loadout.js`: Computes effective weapon stats by applying selected mods/cores; aggregates player effects from armour.
- Procedural Generation
  - `src/systems/ProceduralGen.js`: Simple seeded room generator using `RNG` and depth to pick arena size and enemy spawn points.
- Enemies
  - `src/systems/EnemyFactory.js`: Spawns melee, shooter, and boss variants with basic stats. Shooters fire at intervals; boss has more HP and patterns.
- Combat Flow
  - `src/scenes/CombatScene.js`: Room combat, shooting, dash with charges and regen, exit portal after clear; death returns to Hub with restored HP.
  - `src/scenes/BossScene.js`: Single boss fight with burst patterns; portal to Hub on victory.
  - `src/scenes/HubScene.js`: Vendor/shop, basic upgrades (potions, max HP, dash slot), and portal to Combat.
- UI Overlay
  - `src/scenes/UIScene.js`: Draws HP bar, dash charges/regeneration, gold and weapon; includes Save/Download/Load buttons and Loadout editor (Tab) for weapons/mods/armour.
- Randomness
  - `src/core/RNG.js`: Mulberry32 seeded RNG for reproducible runs; used by generation and spawn selection.

## Scenes
- Boot → Start → Menu/Hub → Combat → Boss → Hub (loops). UI scene overlays gameplay scenes.
