Play in browser: https://jerryl556.github.io/20percent-World-Down-Under/ ！ Mouse highly recommended

# 20percent ！ World Down Under

Top?down, real?time roguelike built with Phaser 3. Fast movement, tight shooting, readable VFX, and a simple scene/frame model that keeps everything responsive in the browser.

## How The Game Is Framed
The game runs as a set of Phaser scenes layered over a single canvas. At 60 FPS (or your display refresh), each frame the engine:
- Steps input: reads WASD, mouse, dash/ability/interaction.
- Simulates physics: player, enemies, bullets, grenades, and barricade collisions.
- Advances AI: pathfinding, state machines (idle, windup, sweep, recover, kite), and targeting.
- Resolves combat: bullet/laser/melee hits, damage, shield regen/delay.
- Renders: sprites, additive VFX, particles, UI overlay.

The primary scenes are:
- Hub (safe zone): shop, choose mode, enter portal.
- Combat (rooms): procedural arenas with enemies, cover, and pickups.
- Boss (encounters): focused arenas with choreographed bosses.
- UI (overlay): HP/shield/dash/ammo/ability; persists on top of gameplay scenes.

## Game Modes
- Campaign: Progress through combat rooms, periodic bosses, return to hub, upgrade, and repeat.
- Boss Rush: Face bosses consecutively with minimal downtime.
- Deep Dive: Endless sequence of escalating rooms with staged intensity per level.
- Shooting Range: Safe test arena with a terminal to spawn enemies and toggle invincibility.

## Controls
- Move: WASD
- Shoot: Left Mouse Button
- Dash: Space
- Interact: E (shop, mode select, portal, terminal)
- Swap Weapon: Q (when two are equipped)
- Ability: F
- Melee: C
- Loadout: Tab (open weapon/armour/build editor)

## Core Gameplay Loop
1. Prepare in the Hub (restore shield/HP, edit loadout, buy gear, choose a mode).
2. Enter the portal to fight enemies in procedural rooms with destructible/indestructible cover.
3. Clear waves, collect resources, and either advance to the next room/level or fight a boss.
4. Return to the Hub to re?equip, upgrade, and push further.

## Weapons, Loadout, and Builds
- Two weapon slots; swap with Q. Each weapon supports 3 mods + 1 core.
- Armour slot affects survivability and unique interactions (e.g., reflect, regen, utility).
- Laser weapons have heat/overheat; ballistics use mags/reload; explosives splash and chip cover.
- The Loadout overlay (Tab) edits your build without pausing the game.

## Enemies & AI
- Mass?Produced Drones: Melee, Runner, Shooter, Machine Gunner, Rocketeer, Sniper.
- Elite Drones: Grenadier (grenades), Prism (aim?then?beam and sweep), Snitch (kite/call), Rook (front shield).
- State machines drive windups, sweeps, kiting, strafing, or charges; pathfinding reroutes around cover.

## Combat Systems
- Bullets: hitscan lines + pooled physics images; pierce/rail/explosive cores with muzzle flashes and sparks.
- Lasers: beam clipped against cover, continuous damage ticks, overheat/cooldown dynamics.
- Melee: wide acuity cone with synchronized VFX and hit timing.
- Barricades: soft (destructible) and hard (indestructible) tiles block shots and movement; splash damages soft.
- Shield: delayed regen and break effects; optional on?break responses from armour or builds.

## Highlights
- Responsive feel: low?latency input, generous animation timing, additive VFX for clarity.
- Readable battlefields: thin hitscan overlays on bullets and lasers ensure what you see is what you hit.
- Light but robust AI: simple state machines + grid pathfinding keep behavior dynamic without being opaque.
- Browser?native: ES modules, no build step; runs on desktop browsers via a single index.html.

## Running & Building
- Play via GitHub Pages or any static server. Locally: 
px http-server . and open the root index.html.
- The playable app lives under docs/ for GitHub Pages (Settings ★ Pages ★ Deploy from branch: main /docs).

## Repository Layout
- docs/index.html ！ entry point used by Pages and local dev.
- docs/src/scenes ！ Hub, Combat, Boss, UI, Start, Menu, Boot.
- docs/src/core ！ GameState, SaveManager, weapons, mods, abilities, config, RNG, input.
- docs/src/systems ！ ProceduralGen, Pathfinding, Effects, WeaponVisuals, EnemyFactory.
- docs/src/ui ！ Bars, buttons, panels.