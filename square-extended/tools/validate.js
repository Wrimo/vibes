// Static + short-simulation checks for every level:
//  - player, square and enemies start inside the arena and not inside walls
//  - nothing lethal starts on top of the player
//  - 25 seconds of idle simulation run without throwing
// Usage: node tools/validate.js
'use strict';
const { loadGame, allLevels } = require('./harness');
const SQ = loadGame();

let problems = 0;
const bad = (label, msg) => {
  problems++;
  console.log(`  ✗ ${label}: ${msg}`);
};

for (const { label, def } of allLevels(SQ)) {
  let w;
  try {
    w = new SQ.World(def, {});
  } catch (e) {
    bad(label, 'failed to build: ' + e.stack);
    continue;
  }
  const solids = w.solids();
  const inside = (x, y, r) => x - r >= 0 && y - r >= 0 && x + r <= SQ.W && y + r <= SQ.H;
  const p = w.player;
  if (!inside(p.x, p.y, p.r)) bad(label, 'player starts outside arena');
  for (const s of solids) {
    if (w.collide(p.x, p.y, p.r, s)) bad(label, `player starts inside a wall at ${s.x},${s.y}`);
  }
  for (const sq of w.squares) {
    if (!inside(sq.x, sq.y, sq.r)) bad(label, 'square starts outside arena');
    for (const s of solids) if (w.collide(sq.x, sq.y, sq.r, s)) bad(label, `square starts inside a wall at ${s.x},${s.y}`);
  }
  for (const e of w.enemies) {
    if (e.orbit) continue;
    if (!inside(e.x, e.y, e.r)) bad(label, `${e.t} at ${e.x},${e.y} outside arena`);
    for (const s of solids) {
      if (e.shields && e.shields.includes(s)) continue;
      if (w.collide(e.x, e.y, e.r, s)) bad(label, `${e.t} at ${e.x},${e.y} inside a wall`);
    }
    const d = SQ.dist(e.x, e.y, p.x, p.y);
    if (d < 260) bad(label, `${e.t} starts only ${d.toFixed(0)}px from the player`);
  }
  for (const h of w.hazards) {
    if (h.t === 'spinner' && SQ.dist(h.x, h.y, p.x, p.y) < (h.len || 60) + p.r + 40) bad(label, 'spinner next to spawn');
    if (h.t === 'laser' && SQ.segDist(p.x, p.y, h.x1, h.y1, h.x2, h.y2) < p.r + 30) bad(label, 'laser next to spawn');
  }
  // Idle run: the level should not crash, and an idle player may die but
  // should not die in the first second.
  try {
    let diedAt = null;
    for (let i = 0; i < 25 * 60; i++) {
      w.frame(1 / 60, null);
      if (w.state === 'dead' && diedAt == null) diedAt = w.t;
    }
    if (diedAt != null && diedAt < 1) bad(label, `idle player dies at ${diedAt.toFixed(2)}s (${w.failReason})`);
  } catch (e) {
    bad(label, 'simulation threw: ' + e.stack);
  }
}

// Arenas: run the wave spawner with an invincible player for a while.
for (const a of SQ.ARENAS) {
  try {
    const def = { name: a.name, palette: a.palette, p: [800, 450], s: [870, 450], walls: a.walls, hazards: a.hazards, enemies: [], mods: a.mods };
    const w = new SQ.World(def, { spawner: SQ.makeWaveSpawner(a), invincible: true });
    // Kill everything periodically so waves advance.
    for (let i = 0; i < 120 * 60; i++) {
      w.frame(1 / 60, null);
      if (i % 120 === 0) for (const e of w.enemies) if (e.alive && e.spawnT <= 0 && e.required) w.killEnemy(e, null);
    }
    if (w.spawner.wave < 10) bad('arena ' + a.name, 'only reached wave ' + w.spawner.wave);
  } catch (e) {
    bad('arena ' + a.name, 'threw: ' + e.stack);
  }
}

console.log(problems ? `${problems} problem(s)` : 'all levels OK');
process.exit(problems ? 1 : 0);
