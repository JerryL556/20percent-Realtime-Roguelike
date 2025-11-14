Play in browser: https://jerryl556.github.io/20percent-World-Down-Under/ - Mouse highly recommended

# 20percent – World Down Under

Top-down, real-time roguelike built with Phaser 3. You control a fast-moving pilot in a dense bullet sandbox: dodging enemy waves, breaking cover, and fighting bosses while tuning a build of weapons, armour, and abilities.

## Overall Structure

World Down Under is organized around a small set of scenes that layer over a single Phaser canvas:

- **Start / Menu** – choose New Run or Continue, tweak global settings like difficulty.
- **Hub** – safe zone, shop access, mode and difficulty terminals, and the portal into combat.
- **Combat** – procedural arenas with enemies and barricades, plus the Shooting Range variant.
- **Boss** – focused boss arenas (implemented via `CombatScene` running in boss mode).
- **UI** – persistent overlay for HP, shield, dash, ammo, boss HUD, and progression trackers.

On each frame the game:

- Reads input (WASD, mouse, dash, ability, interact, weapon swap).
- Steps arcade physics for player, enemies, bullets, grenades, and barricades.
- Updates AI state machines and pathfinding for all active enemies.
- Resolves combat: bullets, lasers, melee, explosions, shields, and damage events.
- Renders sprites, additive VFX, particles, and HUD on top.

The **GameState** object keeps everything tied together: resources, loadout, progression, difficulty, game mode, and which scene should come next. Scenes read and mutate this shared state, and it is saved/loaded via a simple local-storage save manager.

## Game Modes

World Down Under supports several modes built on the same combat systems:

- **Campaign (Normal)**  
  Progress through combat rooms in short cycles, fight bosses, and return to the Hub.  
  There are three replayable stages with progressive unlocks and a finite “campaign complete” state. This is the best mode for a structured run with time to shop, respec, and experiment.

- **Boss Rush**  
  Fight the three bosses (Bigwig → Dandelion → Hazel) back-to-back with minimal downtime.  
  Uses a dedicated boss queue and Boss Rush HUD labels to track progress. Good for practising boss patterns and testing single-target builds.

- **Deep Dive**  
  Endless gauntlet of rooms with level/stage loops that gradually raise baseline enemy counts.  
  Deep Dive tracks the best depth reached and shows it in Hub and Combat UI. Designed as an escalation mode: more drones, more elites, and higher pressure over time.

- **Shooting Range**  
  A special Combat variant flagged by `shootingRange` in GameState.  
  Contains:
  - A terminal to spawn any enemy type (mass-produced, elites, and prototype bosses).
  - A dummy that tracks damage dealt over time.
  - A portal back to Hub.
  - An invincibility toggle for safe testing.  
  Enemies spawned from the terminal respect global difficulty so you can feel how Easy/Normal/Hard behave.

**Difficulty (Easy / Normal / Hard)** globally scales enemy HP and damage. It is editable from both the main Menu and a dedicated terminal in the Hub:

- Easy – enemies have 20% less HP and deal 50% damage.
- Normal – standard enemy HP and damage (baseline).
- Hard – enemies have 40% more HP and deal 2× damage.

## Gameplay Style

World Down Under is tuned for fast, readable combat:

- **Movement** – the player accelerates quickly, can dash through danger, and is expected to kite and reposition aggressively.
- **Aiming** – mouse-aimed shooting with tight bullet patterns; railguns, lasers, and shot-based weapons all use clear, thin traces so hits feel precise.
- **Pacing** – rooms are short and focused, with small waves of enemies, destructible cover, and occasional elites; bosses lean on telegraphed abilities rather than pure bullet spam.
- **Build expression** – loadouts lean heavily on weapon mods and cores; armour and abilities introduce defensive and utility twists (dash/repulse, ADS, cluster grenades, etc.).

The Shooting Range exists to support this style: you can spawn specific enemy archetypes, watch how your build interacts with them, and then bring that knowledge into Campaign, Deep Dive, or Boss Rush.

## Core Loop

1. **Prepare in the Hub**  
   Restore HP and shield, browse the shop, tune your loadout, and pick a mode and difficulty.

2. **Enter Combat**  
   Use the portal to step into a procedural arena appropriate to your mode and depth.  
   Fight waves of enemies, use cover intelligently, and manage ammo/heat and cooldowns.

3. **Resolve the Room**  
   Clear all enemies to open the exit; pick up drops and resources along the way.  
   Depending on mode, progress to another room, a boss, or back to the Hub.

4. **Upgrade and Repeat**  
   Spend resources on weapons, armour, and upgrades, then push deeper, change mode, or test a new build in the Shooting Range.

## Controls

- Move: WASD  
- Shoot: Left Mouse Button  
- Dash: Space  
- Interact: E (shop, mode select, portal, terminals)  
- Swap Weapon: Q (when two are equipped)  
- Ability: F  
- Melee: C  
- Loadout: Tab (open weapon/armour/build editor)

## Weapons, Loadout, and Builds

- Two weapon slots; swap with **Q**. Each weapon supports **3 mods + 1 core**.  
- Armour slot affects survivability and introduces unique hooks (regen, reflect, utility, etc.).  
- Weapon families include:
  - Ballistics (pistols/SMG/AR/LMG): finite mags + reload timing and recoil.
  - Beams/lasers: continuous fire, heat/overheat, and precise hitscan.
  - Explosives (rockets, grenades, cluster bombs): splash damage that also chips soft cover.
- The Loadout overlay (Tab) lets you adjust weapons, armour, and mods mid-run without leaving the current scene.

## Enemies & AI

- **Mass-Produced Drones**  
  - Melee (Shredder) – closes distance and sweeps at close range.  
  - Runner (Charger) – fast melee that punishes staying in open lanes.  
  - Shooter (Gunner) – basic ranged threat, fires 2-shot bursts.  
  - Machine Gunner – heavier shooter with long, sustained volleys.  
  - Rocketeer – lobs explosive rockets that damage in a radius and chip soft cover.  
  - Sniper – aims with a red laser, then fires a high-speed, high-damage shot.

- **Elite Drones**  
  - Grenadier (Bombardier) – volleys of grenades with proximity detonation and charge/explode stages.  
  - Prism – sweeping laser beams and aim-then-beam specials.  
  - Snitch (Commander) – kiting, calls reinforcements, and shotgun-style bursts when close.  
  - Rook – slow melee tank with a rotating frontal shield that blocks bullets.

Enemies are driven by small state machines (idle, windup, sweep, recover, kite, strafe, charge) and a grid-based pathfinding layer that routes them around barricades and walls.

## Combat Systems

- Bullets – hitscan-style traces plus pooled physics images; pierce/rail/explosive cores with muzzle flashes and sparks.
- Lasers – beams clipped against cover with continuous damage ticks and overheat/cooldown dynamics.
- Melee – wide acuity cone with synchronized VFX and hit timing.
- Barricades – soft (destructible) and hard (indestructible) tiles block shots and movement; splash damage chips soft tiles.
- Shields – delayed regen and break effects; armour or builds can hook into break/regen events.

## Highlights

- **Responsive feel** – low-latency input, quick acceleration, and dashes that cut through tight spaces.  
- **Readable battlefields** – clear, additive VFX and thin trace lines on bullets/lasers so you can see what’s happening even in heavy fights.  
- **Lightweight but robust AI** – simple, inspectable state machines plus pathfinding instead of opaque “black-box” behaviour.  
- **Difficulty knobs that matter** – Easy/Normal/Hard use the same content but significantly change enemy HP and damage, including for enemies spawned in the Shooting Range terminal.  
- **Browser-native** – ES modules, no bundler required; the game runs as a static site backed by `index.html` and `docs/index.html` for GitHub Pages.

## Running & Building

- Play via GitHub Pages (link above) or any static file server.  
- Locally, serve the root or `docs/` directory and open the corresponding `index.html`.  
- GitHub Pages uses the `docs/` directory as the published site (`main` branch, `/docs` folder).

## Repository Layout

- `docs/index.html` – entry point used by GitHub Pages and local development.  
- `docs/src/scenes` – Hub, Combat, UI, Start, Menu, Boot, and scene wiring.  
- `docs/src/core` – GameState, SaveManager, weapons, mods, abilities, config, RNG, input.  
- `docs/src/systems` – ProceduralGen, Pathfinding, Effects, WeaponVisuals, EnemyFactory.  
- `docs/src/ui` – Bars, buttons, panels, and other HUD elements.

