# 20percent Realtime Roguelike

Play in browser: https://jerryl556.github.io/20percent-Realtime-Roguelike/

## Overview
Fast, top‑down, realtime roguelike built with Phaser. Explore combat rooms, fight a boss, return to hub, upgrade, and loop deeper. The game runs entirely in the browser and uses simple ES modules with no build step.

## Project Layout
- `docs/` hosts the playable site (GitHub Pages): `index.html`, `assets/`, and `src/`.
- Scenes: Boot, Start, Menu, Hub, Combat, Boss; `UIScene` overlays HUD.

## Gameplay & Core Systems
- Game state & saving
  - `src/core/GameState.js`: run seed, difficulty, gold/HP, dash charges, weapon/armour builds, and scene routing (3 rooms → Boss → Hub). BossRush alternates boss types.
  - `src/core/SaveManager.js`: localStorage save/load and JSON import/export.
- Input
  - `src/core/Input.js`: WASD move, Space dash, E interact, LMB shoot, Q swap, Tab loadout editor.
- Weapons, Mods, Loadout
  - `src/core/Weapons.js`: base stats; `src/core/Mods.js`: three mod slots + one core; `src/core/Loadout.js`: applies modifiers and aggregates armour effects.
- Procedural generation
  - `src/systems/ProceduralGen.js`: seeded arenas with destructible/indestructible barricades and spawn points; path grid built per room.
- Pathfinding
  - `src/systems/Pathfinding.js`: lightweight A* on a tile grid. Enemies repath when LOS is blocked or on a timer.

## Rendering, Assets, and Hitboxes
- Weapon art
  - `src/systems/WeaponVisuals.js` preloads weapon PNGs, sizes them by desired on‑screen height, and tracks muzzle positions for effects.
- Enemy art overlays
  - Enemies render with PNG overlays that flip left/right toward the player. Base physics sprites are hidden.
  - Movement body: unified 12×12 for consistent navigation & barricade collision.
  - Bullet hitboxes: separate invisible Arcade bodies follow each overlay and match its display size so bullets collide on visual width/height.
  - Assets are preloaded in `BootScene`; missing textures are lazy‑loaded as a fallback.
- VFX lifecycle
  - Sniper aim lines, prism beams, melee lines, indicators, and boss dash hints are purged on death.

## Combat Model
- Bullets
  - Player bullets: pierce and explosive cores, particle tracers, barricade damage on splash.
  - Sniper enemy bullets: red tracer tail, +15% velocity, manual line‑to‑rect collision to avoid tunneling.
- Lasers
  - Player laser heat/overheat; prism aim‑then‑beam and sweeping beam use beam‑to‑rect intersection.
- Melee
  - Player melee: windup → sweep → recover with bright sweep line; melee enemies use similar cone checks.
- Rook shield
  - 90° frontal arc blocks non‑rail bullets via angular sector + outer arc radius test.

## Enemies (selection)
- Shredder (melee), Charger (runner), Shooter, MachineGunner, Rocketeer, Sniper.
- Elites: Prism (laser), Snitch (kite/call), Rook (shield), Bombardier (grenades + charge).
- Visual scaling (overlay only)
  - Charger slightly smaller; Shooter +15%; Snitch +30%; Prism +30%; Rook +15%; Bombardier +20%.
- Bombardier charge
  - Auto‑swaps art to BombardierSpecial while charging (preloaded swap; no blanking).

## Bosses
- Dasher and Shotgunner variants. Dash hint and other VFX are purged on death.

## Barricades & Cover
- Destructible (soft) and indestructible (hard) walls block movement and bullets. Explosions and some enemies/boss can break soft walls.

## GitHub Pages
- Source: `main` branch, folder `docs` (Settings → Pages → Deploy from a branch → `main` / `/docs`).
- Local dev: serve repo root (e.g., `npx http-server .`) and open `index.html`, or open `docs/index.html` to mirror Pages.

## Contributing
- Issues and PRs welcome. Please keep PRs focused; open an issue first for larger changes.


