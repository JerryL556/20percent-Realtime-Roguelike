# 20percent Realtime Roguelike

Play in browser: https://jerryl556.github.io/20percent-Realtime-Roguelike/

## GitHub Pages
- Source: `main` branch, folder `docs` (GitHub Pages settings → Build and deployment → Source: Deploy from a branch → Branch: `main` / `/docs`).
- Deployed files live under `docs/` and include `index.html`, `assets/`, and a copy of `src/` for ES module loading.
- Local dev: open `index.html` at repo root when serving the repo root (e.g., `npx http-server .`) or open `docs/index.html` to mirror the Pages layout.

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
  - `src/systems/ProceduralGen.js`: Seeded room generator using `RNG` and depth to pick arena size, enemy spawn points, and barricade layouts. Normal rooms build small "apartment" perimeters, corridors, and soft clutter. About 50% of wall segments are destructible for flexible routing.
- Enemies
  - `src/systems/EnemyFactory.js`: Spawns melee, shooter, and boss variants with basic stats. Shooters fire at intervals; boss has more HP and patterns. Enemies (and the boss) can break destructible barricades by pushing into them.
- Combat Flow
  - `src/scenes/CombatScene.js`: Room combat, shooting, dash with charges and regen, exit portal after clear; death returns to Hub with restored HP.
  - `src/scenes/BossScene.js`: Single boss fight with burst patterns; portal to Hub on victory.
  - `src/scenes/HubScene.js`: Vendor/shop, basic upgrades (potions, max HP, dash slot), and portal to Combat.
- UI Overlay
  - `src/scenes/UIScene.js`: Draws HP bar, dash charges/regeneration, gold and weapon; includes Save/Download/Load buttons and Loadout editor (Tab) for weapons/mods/armour.
- Randomness
  - `src/core/RNG.js`: Mulberry32 seeded RNG for reproducible runs; used by generation and spawn selection.

### Barricades & Cover
- Types: Destructible (light brown) and Indestructible (light grey).
- Both types block movement and bullets.
- Destructible tiles have HP, take damage from bullets and explosions, and disappear when destroyed.
- Enemies and the boss can also destroy destructible tiles by pushing into them.
- Normal rooms: mix of hard/soft walls with roughly 50% soft segments on perimeters and corridors; extra soft clutter creates cover.
- Boss room: simpler layout but denser and fully destructible.

### Pathfinding & Rerouting
- `src/systems/Pathfinding.js`: Lightweight 4-neighbor A* on a grid built from the current arena and barricade blockers.
- Enemies re-route along waypoints when line of sight to the player is blocked, and periodically rebuild their nav grid to reflect destroyed tiles.

### Explosions
- Explosive projectiles (e.g., rockets, grenades) damage enemies and also damage nearby destructible barricades within the blast radius.
- Rocket reload is 1.0s by default (unless overridden by weapon definition).

## Scenes
- Boot → Start → Menu/Hub → Combat → Boss → Hub (loops). UI scene overlays gameplay scenes.
