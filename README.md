Play in browser: https://jerryl556.github.io/20percent-World-Down-Under/ - Mouse highly recommended

# 20percent – World Down Under

Top-down, real-time roguelike built with Phaser 3. You control a fast-moving pilot in a dense bullet sandbox: dodging enemy waves, breaking cover, and fighting bosses while tuning a build of weapons, armour, and abilities.

## Architecture Overview

World Down Under is structured as a small set of Phaser scenes on top of a shared core state:

- **Start / Menu** – entry point, new game / continue, difficulty selection, save/load.
- **Hub** – safe zone with NPCs, mode/difficulty terminals, shop, and the portal into combat.
- **Combat** – procedural arenas, enemies, bosses, barricades, and the Shooting Range variant.
- **UI** – overlay scene for HUD (HP, shield, dash, ammo, ability, bosses) and loadout menus.
- **Boot** – preloads assets and wires up textures before handing off to Start/Hub.

Code is organised under `docs/src`:

- `core/` – `GameState`, `SaveManager`, weapons, mods, abilities, config, RNG, loadout, input.
- `systems/` – procedural generation, pathfinding, effects, enemy factory, weapon visuals.
- `scenes/` – Phaser scenes (`StartScene`, `MenuScene`, `HubScene`, `CombatScene`, `UIScene`, `BootScene`).
- `ui/` – HUD widgets (HP/Shield/Heat/Dash bars, panels, buttons).

The **GameState** object is the backbone: it tracks your build, resources, progression, difficulty, game mode, and the next scene. Scenes read and mutate the same `GameState` instance via the Phaser registry, and `SaveManager` serializes it to/from `localStorage` or JSON files.

## Game Modes

All modes share the same combat systems but differ in flow and pacing:

- **Campaign (Normal)** – short room chains with bosses, returning to Hub between segments. Good for structured runs, shopping, and experimenting with builds.
- **Boss Rush** – fights Bigwig, Dandelion, and Hazel back-to-back. Uses a dedicated boss queue and labels to track which boss is next.
- **Deep Dive** – endless level/stage loop with increasing baseline enemy counts. Tracks best depth (`deepDiveBest`) and shows it in Hub/Combat UI.
- **Shooting Range** – a special Combat variant (`shootingRange` flag in `GameState`):
  - Terminal to spawn any enemy type (mass-produced, elites, bosses).
  - Dummy that tracks and displays DPS.
  - Portal back to Hub.
  - Optional invincibility toggle for safe testing.

**Difficulty** (Easy / Normal / Hard) globally scales enemy HP and damage and applies everywhere, including the Shooting Range. It can be changed in the main menu or via a Hub terminal; changes save immediately.

## Core Loop

1. **Prepare in the Hub** – heal, restore shield, adjust difficulty/mode, spend currency in the shop, and tune your loadout (weapons, mods, cores, armour, ability).
2. **Enter Combat** – step through the portal into a procedural arena or boss room appropriate to the chosen mode and progression.
3. **Fight & Resolve** – clear all enemies, dodge attacks, use dashes and abilities, and manage heat/ammo. Boss rooms add scripted patterns and support enemies.
4. **Progress & Save** – after room/boss completion or player death, `GameState.progressAfterCombat` / `progressAfterBoss` updates progression, saves to disk, and either chains to the next scene or returns you to the Hub.

The Shooting Range fits into this loop as a side path: you can always return to the Hub, adjust builds, and then test again without affecting main progression.

## Controls

- Move – `W/A/S/D`
- Shoot – `Left Mouse Button`
- Dash – `Space`
- Ability – `F`
- Melee – `C`
- Interact – `E` (portals, NPCs, terminals, doors)
- Swap Weapon – `Q` (when two weapons are equipped)
- Loadout – `Tab` (open the weapon/armour/ability editor overlay)

Mouse is used for precise aiming and UI interactions (recommended).

## Weapons, Loadout, and Builds

Weapon definitions live in `core/Weapons.js`, while modifiers and armour live in `core/Mods.js` and `core/Abilities.js`. The loadout pipeline looks like this:

- `GameState` stores your equipped weapons, cores, mods, armour, and ability.
- `getEffectiveWeapon(gs)` merges base weapon stats with core and mods at runtime.
- `getPlayerEffects(gs)` exposes derived flags for the rest of the game (e.g. explosion multipliers, on-hit ignite/toxin amounts, shield behaviour).

Each run you can:

- Equip up to **two weapons**, each with **3 mods + 1 core**.
- Equip one **armour** piece that affects survivability and hooks into shield/HP events.
- Equip one **ability** (e.g., Repulsion Pulse, Caustic Cluster, Phase Bomb).

Weapon families include:

- **Ballistics** – pistols, SMGs, battle rifles, LMGs with mags, recoil, and reload timing.
- **Beams/Lasers** – continuous fire with heat/overheat and precise hitscan.
- **Explosives** – rockets, grenades, cluster bomblets, and mines with splash that also chips soft barricades.

The loadout screen (Tab) is implemented in `UIScene` and automatically saves any changes to the current `GameState`.

## Enemies & Bosses

Enemy creation and visuals are centralised in `systems/EnemyFactory.js`:

- **Mass-Produced Drones** (normal enemies):
  - **Shredder** – close-range melee that charges the player.
  - **Charger** – fast runner that punishes staying in open lanes.
  - **Gunner** – basic ranged shooter with short bursts.
  - **MachineGunner** – heavier shooter with long, tracking volleys.
  - **Rocketeer** – fires rockets that explode and chip soft cover.
  - **Sniper** – draws a red aim line, then fires a high-speed, high-damage shot.

- **Elite Drones**:
  - **Bombardier** – arcs grenades with timed/proximity detonations.
  - **Prism** – sweeping laser patterns and aim-then-beam specials.
  - **Commander** – mobile support drone that can call reinforcements.
  - **Rook** – tanky melee with a rotating shield that blocks bullets in a front arc.

- **Support Enemies / Drones**:
  - **Turrets** – anchored shooters spawned by bosses.
  - **HealDrones** – summoned by Dandelion at HP thresholds; orbit around the boss and periodically heal it with a yellow beam.
  - **LaserDrones** – summoned by Hazel; orbit the player and sweep short-range lasers with Prism-style beams, using Hazel’s purple VFX.

- **Bosses** (implemented inside `CombatScene`):
  - **Dandelion** – assault dashes, minefields, and HealDrone phases at HP thresholds (50% and 25%) with purple channel/teleport VFX.
  - **Bigwig** – machine-gun bursts, grenade bombardments with markers, and mine deployment using shared VFX helpers.
  - **Hazel** – shotgun volleys (purple bullets with short purple tracers), guided missile specials, Phase Bomb (aim-line + delayed explosions), teleport-away logic that can spawn LaserDrones, and a dedicated LaserDrone summoning ability.

Bosses and elites use explicit state machines (idle, channel, sweep, special, recover). Movement and targeting rely on `Pathfinding.js` where navigation is needed and direct vector math for tracking and orbiting behaviours.

## Combat Systems

`CombatScene.js` orchestrates all real-time combat:

- **Player** – Phaser physics body plus an invisible hitbox for consistent bullet collisions. Dashes consume charges (tracked by `DashBar` UI) and can be modified via upgrades and armour.
- **Bullets** – pooled Arcade images in `this.bullets` (player) and `this.enemyBullets` (enemies):
  - Collide with enemies, barricades, and shields, with specialised handling for rail, pierce, explosive, and caustic projectiles.
  - Use `impactBurst` and `pixelSparks` to show hits, colour-matched to bullet tint.
  - Enemy bullets spawn a small player-hit VFX (flash + sparks) when they hit the player; shots absorbed by shield only show shield VFX, not HP impact particles.
- **Guided Missiles** – Hazel missiles and player guided-missiles use time-based turn rates and proximity detonation:
  - Turn rates are frame-rate independent and clamped per second.
  - Missiles auto-explode when near enemies, dealing splash damage and chip to barricades.
- **Lasers / Beams** – Prism and LaserDrones share `renderPrismBeam`:
  - Beams are clipped against cover and the player so they stop at hit points.
  - Apply tick-based DPS and spawn small impact bursts at endpoints.
  - LaserDrone beams use Hazel-style purple colours; Prism uses a red/blue theme.
- **Repulsion Pulse** – expanding rings emitted by the player (as ability and via shield mod):
  - Block enemy bullets within a moving band and clean up any attached tracer graphics.
  - Push enemies (except anchored turrets) away from the player.
  - Clip enemy lasers at the ring and interrupt certain boss states (like Prism aiming).
- **Barricades** – generated by `ProceduralGen` as soft/hard tiles:
  - Soft barricades are destructible, chip down from bullets and splash.
  - Hard barricades block movement and most bullets but are indestructible.
  - Some enemies (e.g. Dandelion) explicitly break soft barricades they collide with.

All combat runs inside Phaser’s Arcade physics step, using overlaps/colliders and manual line checks for very fast projectiles (sniper shots, beams).

## Saving & Loading

Saving is event-driven via `core/SaveManager.js`:

- The game saves when:
  - Starting or loading a game in Start/Menu.
  - Entering or exiting the Hub.
  - Changing mode, difficulty, or stage selection in the Hub.
  - Buying/unlocking weapons, mods, cores, armour, abilities, dash upgrades.
  - Changing loadout (weapons, mods, cores, armour, ability).
  - Finishing a room or boss, or dying, when progression and HP are updated.

**Continue** and **Load Save** always spawn you back in the Hub, regardless of where you were saved, to avoid dropping players directly into combat on load.

## Running Locally

- Play in browser via the link at the top of this file.
- To run locally:
  - Serve the repository root or the `docs/` folder with any static web server.
  - Open `index.html` (for root) or `docs/index.html` (for GitHub Pages–style hosting).

GitHub Pages is configured to publish from the `docs/` folder on the `main` branch, so the live version is always built from the same codebase described above.

