// Exhaustive check for single-launch puzzles: tries every launch angle and
// power from the square's start position and reports which ones clear the
// level. Usage: node tools/sweep.js <challenge-id> [angleStep=0.25]
'use strict';
const { loadGame } = require('./harness');
const SQ = loadGame();

const id = process.argv[2] || 'one-shot';
const step = +process.argv[3] || 0.25;
const def = SQ.CHALLENGES.find((c) => c.id === id) || SQ.CHAPTERS.flatMap((c) => c.levels).find((l) => l.id === id);
if (!def) throw new Error('no level ' + id);

const wins = [];
for (let deg = 0; deg < 360; deg += step) {
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const w = new SQ.World(def, {});
    const K = w.K;
    const s = w.squares[0];
    const a = SQ.rad(deg);
    const d = K.range - t * (K.range - (K.pr + K.sr)) - 0.5;
    const p = w.player;
    p.x = s.x - Math.cos(a) * d;
    p.y = s.y - Math.sin(a) * d;
    if (p.x < p.r || p.y < p.r || p.x > SQ.W - p.r || p.y > SQ.H - p.r) continue;
    if (w.solids().some((so) => w.collide(p.x, p.y, p.r, so))) continue;
    w.tryLaunch();
    for (let i = 0; i < 20 * 60 && w.state === 'play'; i++) w.frame(1 / 60, null);
    if (w.state === 'clear') wins.push([deg, t]);
  }
}
const byAngle = {};
for (const [deg, t] of wins) (byAngle[deg.toFixed(2)] = byAngle[deg.toFixed(2)] || []).push(t.toFixed(1));
console.log(`${def.name}: ${wins.length} winning (angle, power) pairs`);
for (const [a, ts] of Object.entries(byAngle)) console.log(`  ${a}°  power ${ts.join(' ')}`);
