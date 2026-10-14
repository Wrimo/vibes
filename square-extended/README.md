# (square) extended

An extended version of [(square)](https://wrimor.itch.io/square)
([Steam](https://store.steampowered.com/app/2061630)), the top-down game
where your only weapon is as deadly to you as it is to your enemies.

You move a circle. When the square is near you, you can **launch** it away
from you, and the closer it is, the harder it flies. You can also
**recall** it: it speeds up toward you until it arrives, so you have to
launch it away again before it hits you. A fast square destroys enemies and
kills you. A slow one is harmless, and you can walk into it to nudge it.

## Playing

No build step. Open `index.html` in a browser, or serve the folder:

```sh
npx serve .            # or: python3 -m http.server
```

For itch.io, zip `index.html` and `src/` together and upload the zip as an
HTML5 game.

| Action  | Keyboard / mouse                  | Gamepad        |
|---------|-----------------------------------|----------------|
| Move    | WASD / arrows                     | left stick / d-pad |
| Launch  | left-click (toward the cursor) / Space, J or Z (straight away from you) | A, RB, RT |
| Recall  | Shift, K or X / right-click       | B, X, LB, LT   |
| Restart | R                                 | Y              |
| Pause   | Esc or P                          | Start          |

Progress, best times and settings are kept in `localStorage`. The game
still works when storage is blocked; it just doesn't remember anything.

## What's in it

**Campaign: six chapters, 60 levels, each chapter ending with a boss.**

| # | Chapter  | Introduces | Boss |
|---|----------|------------|------|
| 1 | LAUNCH   | launching, recall, bank shots, shields (fixed, spinning, tracking) | **Monolith**, a three-sided shield block that turns faster each hit |
| 2 | RECALL   | chasers, gravity wells, spinning light arms, orbiting targets | **Hive**, which keeps spawning chasers |
| 3 | AVOID    | linked cores and nodes, warden damping fields, turrets and bullets | **Lattice**, a core whose orbiting nodes grow back |
| 4 | PRESSURE | bumpers, portals, switches and doors, pistons, wind, lasers, rotating walls | **Engine**, rotating plates and bullet patterns |
| 5 | FRACTURE | armor (needs a point-blank launch), splitters, phantoms, dashers | **Prism**, armored and shedding splinters |
| 6 | CIRCLE   | everything at once, plus darkness and twin squares | **The Circle**, another circle with its own square, playing by your rules |

Each chapter unlocks when the previous boss falls.

**Challenges: 14 rule-twist levels plus 6 deathless chapter runs.** One
Shot, Out of Reach (no recall), Ricochet (the square must bounce before it
can kill), Glass (it shatters on its third bounce), Blackout, Frictionless,
Rush (10 targets in 12 s), Double Trouble (two squares), Three Strikes,
Bullet Hell, Swarm, Gravity Golf, Spinner Garden and Clock Tower. The
*Chapter N Deathless* runs unlock as you finish each chapter: one death
sends you back to that chapter's first level.

**Arenas: six endless wave arenas** (Open Floor, Four Pillars, Event
Horizon, Pinball Machine, Spinner Garden, The Void). New enemy types join as
the waves climb, every fifth wave brings a boss, and several kills from one
launch multiply your score. Best wave and score are saved.

**Settings** include the original's **Slow Mode** (a lower top speed, a
bigger launch buffer, slower enemies), a launch-range ring, screen shake,
sound and music toggles, a timer, and *Unlock Everything*.

## Code layout

Plain `<script>` files sharing one `SQ` namespace, so the game runs from
`file://` and needs no bundler.

| File | Contents |
|------|----------|
| `src/util.js` | math and collision helpers |
| `src/world.js` | the simulation: player, square physics (fixed 240 Hz step), walls, hazards, kills and deaths |
| `src/enemies.js` | every enemy type and boss (behaviour, hit rules, drawing) |
| `src/draw.js` | drawing primitives and the world renderer |
| `src/levels.js` | the campaign's level data and the small builders it uses |
| `src/modes.js` | challenges, arenas and the wave spawner |
| `src/ui.js` | menus, HUD, game flow and saving results |
| `src/audio.js` | synthesised sound effects and generative music (Web Audio) |
| `src/input.js`, `src/save.js`, `src/palettes.js`, `src/main.js` | input, persistence, colour palettes, main loop |

The tuning constants (launch range, speeds, friction, lethal and kill
thresholds, and the Slow Mode values) live in `SQ.makeConstants` in
`src/world.js`.

### Adding a level

Levels are plain objects in `src/levels.js`:

```js
L('Bank Shot', {
  p: [300, 450], s: [370, 450],          // player and square start
  walls: [R(800, 450, 40, 520)],          // R(cx, cy, w, h, angle), C(cx, cy, r), Dm(...), B(...) bumper
  enemies: [e('dummy', 1300, 250), e('shield', 1100, 450, { mode: 'track' })],
  hazards: [spin(600, 300, 70, 1.4)],     // spin, well, laser, portal, wind, sw (switch)
  hint: 'Shown at the bottom. {launch} and {recall} expand to the controls.',
  mods: { maxLaunches: 1 },               // optional challenge rules
}),
```

The arena is 1600×900. Walls take `move: { dx, dy, period }`, `spin` (in
degrees per second) or `door: 'id'`, which a switch hazard with the same id
toggles.

## Tools

```sh
node tools/validate.js         # every level: spawn sanity, nothing inside walls, 25 s idle sim
node tools/bot.js 16 60 [filter]   # autoplayer: attempts per level, seconds each; prints win rates
node tools/smoke.js [outDir]   # headless Chromium: menus + sample levels, screenshots, page errors
```

`validate.js` and `bot.js` run the simulation in Node with no browser. The
bot is crude (it lines up shots, banks off edges and dodges), so treat a
low win rate as "hard" or "needs a look", not as "impossible".
