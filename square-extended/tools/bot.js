// A crude autoplayer used to check that levels can be beaten. It is not
// smart: it lines the square up with a target (directly or off an edge),
// launches, dodges obvious threats and sometimes recalls. Many randomised
// attempts per level give a rough "is this beatable / how hard" signal.
//
// Usage: node tools/bot.js [attempts=24] [seconds=50] [filter]
'use strict';
const { loadGame, allLevels } = require('./harness');
const SQ = loadGame();

const ATTEMPTS = +process.argv[2] || 24;
const SECONDS = +process.argv[3] || 50;
const FILTER = process.argv[4] || '';

// Seeded RNG so failures can be replayed.
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// Coarse grid path-finding around static walls.
const CELL = 25;
function buildGrid(w) {
  const gw = Math.ceil(SQ.W / CELL);
  const gh = Math.ceil(SQ.H / CELL);
  const grid = new Uint8Array(gw * gh);
  const solids = w.solids().filter((s) => !s.shield);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const cx = x * CELL + CELL / 2;
      const cy = y * CELL + CELL / 2;
      if (cx < 26 || cy < 26 || cx > SQ.W - 26 || cy > SQ.H - 26) grid[y * gw + x] = 1;
      else if (solids.some((s) => w.collide(cx, cy, 28, s))) grid[y * gw + x] = 1;
    }
  return { grid, gw, gh };
}
function nextWaypoint(G, fx, fy, tx, ty) {
  const { grid, gw, gh } = G;
  const idx = (x, y) => y * gw + x;
  const sx = SQ.clamp(Math.floor(fx / CELL), 0, gw - 1);
  const sy = SQ.clamp(Math.floor(fy / CELL), 0, gh - 1);
  let ex = SQ.clamp(Math.floor(tx / CELL), 0, gw - 1);
  let ey = SQ.clamp(Math.floor(ty / CELL), 0, gh - 1);
  if (grid[idx(ex, ey)]) return [tx, ty];
  const prev = new Int32Array(gw * gh).fill(-1);
  const q = [idx(sx, sy)];
  prev[q[0]] = q[0];
  let found = false;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === idx(ex, ey)) {
      found = true;
      break;
    }
    const cx = c % gw;
    const cy = (c / gw) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const n = idx(nx, ny);
      if (prev[n] !== -1 || grid[n]) continue;
      if (dx && dy && (grid[idx(cx + dx, cy)] || grid[idx(cx, cy + dy)])) continue;
      prev[n] = c;
      q.push(n);
    }
  }
  if (!found) return [tx, ty];
  // Walk back to find the furthest cell still in a straight line... keep it
  // simple: step a few cells along the path.
  let c = idx(ex, ey);
  const path = [];
  while (c !== prev[c]) {
    path.push(c);
    c = prev[c];
  }
  path.reverse();
  const pick = path[Math.min(path.length - 1, 1)];
  if (pick == null) return [tx, ty];
  return [(pick % gw) * CELL + CELL / 2, ((pick / gw) | 0) * CELL + CELL / 2];
}

// Can the square travel from a to b without touching a solid?
function clearPath(w, ax, ay, bx, by, ignore) {
  const d = SQ.dist(ax, ay, bx, by);
  const n = Math.ceil(d / 12);
  const solids = w.solids();
  for (let i = 1; i < n; i++) {
    const x = SQ.lerp(ax, bx, i / n);
    const y = SQ.lerp(ay, by, i / n);
    if (x < 14 || y < 14 || x > SQ.W - 14 || y > SQ.H - 14) return false;
    for (const s of solids) if (s !== ignore && w.collide(x, y, 15, s)) return false;
  }
  return true;
}

// Aim points for hitting e from the square: direct, or off one arena edge.
function aimOptions(w, s, e0) {
  const opts = [];
  // Lead moving targets by roughly the square's travel time.
  const tt = SQ.dist(s.x, s.y, e0.x, e0.y) / 1000;
  const e = { x: SQ.clamp(e0.x + (e0.vx || 0) * tt, 20, SQ.W - 20), y: SQ.clamp(e0.y + (e0.vy || 0) * tt, 20, SQ.H - 20) };
  const tryAim = (tx, ty, rx, ry) => {
    if (rx == null) {
      if (clearPath(w, s.x, s.y, e.x, e.y)) opts.push([tx, ty, 0]);
    } else if (clearPath(w, s.x, s.y, rx, ry) && clearPath(w, rx, ry, e.x, e.y)) opts.push([tx, ty, 1]);
  };
  tryAim(e.x, e.y);
  const mirrors = [
    [-e.x, e.y, 'x', 0],
    [2 * SQ.W - e.x, e.y, 'x', SQ.W],
    [e.x, -e.y, 'y', 0],
    [e.x, 2 * SQ.H - e.y, 'y', SQ.H],
  ];
  for (const [tx, ty, axis, edge] of mirrors) {
    let rx;
    let ry;
    if (axis === 'x') {
      const t = (edge - s.x) / (tx - s.x);
      if (!(t > 0 && t < 1)) continue;
      rx = edge + (edge ? -16 : 16);
      ry = s.y + (ty - s.y) * t;
    } else {
      const t = (edge - s.y) / (ty - s.y);
      if (!(t > 0 && t < 1)) continue;
      ry = edge + (edge ? -16 : 16);
      rx = s.x + (tx - s.x) * t;
    }
    tryAim(tx, ty, rx, ry);
  }
  return opts;
}

function vulnerable(w, e) {
  if (e.sw) return true;
  if (!e.alive || e.spawnT > 0 || e.ghost || e.inv > 0.3) return false;
  if (e.t === 'core' && SQ.ENEMY.core.protected(e)) return false;
  if (e.t === 'lattice' && SQ.ENEMY.lattice.nodesAlive(e, w)) return false;
  return true;
}

function play(def, seed, opts = {}) {
  const R = rng(seed);
  const w = new SQ.World(def, opts.worldOpts || {});
  const G = buildGrid(w);
  const K = w.K;
  const style = { bank: R() * 0.6, recallRate: R() * 0.5, dist: 0.25 + R() * 0.6, care: 0.6 + R() * 0.8 };
  let pressed = new Set();
  let mv = { x: 0, y: 0 };
  const input = {
    move: () => mv,
    pressed: (a) => pressed.has(a),
  };
  let target = null;
  let aimPt = null;
  let aimMode = 0;
  let retarget = 0;
  let farTime = 0;
  const dt = 1 / 60;
  for (let f = 0; f < SECONDS * 60; f++) {
    pressed = new Set();
    const p = w.player;
    if (w.state !== 'play') {
      w.frame(dt, input);
      if (w.state === 'clear') return { win: true, t: w.clearTime };
      if (w.state === 'dead' && w.stateT > 0.2) return { win: false, t: w.t, why: w.failReason };
      continue;
    }
    // --- threats
    let ax = 0;
    let ay = 0;
    const push = (fx, fy, wgt) => {
      ax += fx * wgt;
      ay += fy * wgt;
    };
    for (const e of w.enemies) {
      if (!e.alive || e.ghost) continue;
      const d = SQ.dist(p.x, p.y, e.x, e.y);
      const reach = (e.r + p.r + 90 + Math.hypot(e.vx, e.vy) * 0.4) * style.care;
      if (d < reach && e.lethal) push((p.x - e.x) / d, (p.y - e.y) / d, (reach - d) / reach * 3);
      if (e.t === 'dasher' && e.mode === 'aim') {
        const ex = Math.cos(e.aimA);
        const ey = Math.sin(e.aimA);
        const side = -ey * (p.x - e.x) + ex * (p.y - e.y);
        if (Math.abs(side) < 70) push(-ey * Math.sign(side || 1), ex * Math.sign(side || 1), 3);
      }
    }
    for (const b of w.bullets) {
      const d = SQ.dist(p.x, p.y, b.x, b.y);
      if (d < 160) {
        const bs = Math.hypot(b.vx, b.vy) || 1;
        const side = -b.vy / bs * (p.x - b.x) + b.vx / bs * (p.y - b.y);
        const ahead = (b.vx * (p.x - b.x) + b.vy * (p.y - b.y)) > 0;
        if (ahead && Math.abs(side) < 50) push((-b.vy / bs) * Math.sign(side || 1), (b.vx / bs) * Math.sign(side || 1), 3);
      }
    }
    for (const h of w.hazards) {
      if (h.t === 'spinner') {
        const d = SQ.dist(p.x, p.y, h.x, h.y);
        const reach = (h.len || 60) + p.r + 40;
        if (d < reach) push((p.x - h.x) / d, (p.y - h.y) / d, (reach - d) / reach * 4);
      }
      if (h.t === 'laser' && SQ.laserOn(h, w.t + 0.3) > 0) {
        const d = SQ.segDist(p.x, p.y, h.x1, h.y1, h.x2, h.y2);
        if (d < p.r + 40) {
          // Step away from the beam.
          const lx = h.x2 - h.x1;
          const ly = h.y2 - h.y1;
          const l = Math.hypot(lx, ly);
          const side = Math.sign(-ly / l * (p.x - h.x1) + lx / l * (p.y - h.y1)) || 1;
          push((-ly / l) * side, (lx / l) * side, 4);
        }
      }
    }
    const sqs = w.squares.concat(w.foeSquares);
    let launchNow = false;
    for (const s of sqs) {
      const sp = Math.hypot(s.vx, s.vy);
      const d = SQ.dist(p.x, p.y, s.x, s.y);
      if (sp < K.lethal * 0.9) continue;
      const toward = (s.vx * (p.x - s.x) + s.vy * (p.y - s.y)) / (sp * d || 1);
      if (toward > 0.5 && d < 360) {
        if (s.own === 'player' && d < K.range + sp * 0.06) launchNow = true;
        else {
          const side = Math.sign(-s.vy * (p.x - s.x) + s.vx * (p.y - s.y)) || 1;
          push((-s.vy / sp) * side, (s.vx / sp) * side, 4 * (1 - d / 360) + 1);
        }
      }
    }
    // --- plan with the (first) square
    const s = w.squares[0];
    const sSp = Math.hypot(s.vx, s.vy);
    const dSq = SQ.dist(p.x, p.y, s.x, s.y);
    retarget -= dt;
    if (target && target.sw && retarget > 0) {
      /* keep aiming at the switch */
    } else if (!target || !vulnerable(w, target) || retarget <= 0) {
      const cands = w.enemies.filter((e) => vulnerable(w, e));
      // Prefer enemies near the square, with some randomness.
      cands.sort((a, b) => SQ.dist(a.x, a.y, s.x, s.y) - SQ.dist(b.x, b.y, s.x, s.y));
      // Prefer targets with a clear shot.
      const shots = [];
      for (const e of cands) for (const a of aimOptions(w, s, e)) shots.push([e, a]);
      // Nothing to shoot at directly: try the switches.
      if (!shots.length)
        for (const h of w.hazards)
          if (h.t === 'switch') {
            const pseudo = { x: h.x, y: h.y, r: 20, sw: true };
            for (const a of aimOptions(w, s, pseudo)) shots.push([pseudo, a]);
          }
      if (shots.length && R() < 0.9) {
        const direct = shots.filter((x) => x[1][2] === 0);
        const pool = direct.length && R() > style.bank ? direct : shots;
        const pick = pool[Math.floor(R() * pool.length)];
        target = pick[0];
        aimPt = pick[1];
      } else {
        target = cands.length ? cands[Math.min(cands.length - 1, Math.floor(Math.pow(R(), 2) * cands.length))] : null;
        aimPt = target ? [target.x + SQ.rand(-80, 80), target.y + SQ.rand(-80, 80)] : null;
      }
      aimMode = 0;
      retarget = 1.2 + R() * 2;
    }
    let goal = null;
    if (target && sSp < 260 && !s.recall) {
      let tx = aimPt ? aimPt[0] : target.x;
      let ty = aimPt ? aimPt[1] : target.y;
      // Track moving targets when aiming straight at them.
      if (aimPt && aimPt[2] === 0 && !target.sw) {
        const lead = SQ.dist(s.x, s.y, target.x, target.y) / 1000;
        tx = target.x + (target.vx || 0) * lead;
        ty = target.y + (target.vy || 0) * lead;
      }
      const d = SQ.dist(s.x, s.y, tx, ty) || 1;
      const ux = (tx - s.x) / d;
      const uy = (ty - s.y) / d;
      const armored = target.t === 'armored' || target.armor || target.t === 'prism' || target.field;
      const back = armored ? K.pr + K.sr + 6 : K.pr + K.sr + 10 + (K.range - K.pr - K.sr - 20) * style.dist;
      const gx = s.x - ux * back;
      const gy = s.y - uy * back;
      const err = SQ.dist(p.x, p.y, gx, gy);
      // Lined up: launch.
      if (dSq <= K.range && sSp < 200 && dSq > K.pr + K.sr) {
        const aErr = Math.abs(SQ.wrapAngle(SQ.angleTo(p.x, p.y, s.x, s.y) - Math.atan2(uy, ux)));
        const tol = Math.min(0.12, ((target.r + K.sr) * 0.6) / d);
        if (aErr < tol && (err < 40 || dSq < back + 20)) launchNow = true;
      }
      // Approach, swinging around the square instead of through it.
      const ds = SQ.segDist(s.x, s.y, p.x, p.y, gx, gy);
      if (ds < K.pr + K.sr + 8 && dSq > back - 4) {
        const a = SQ.angleTo(s.x, s.y, p.x, p.y);
        const side = Math.sign(SQ.wrapAngle(SQ.angleTo(s.x, s.y, gx, gy) - a)) || 1;
        goal = [s.x + Math.cos(a + side * 0.9) * (back + 30), s.y + Math.sin(a + side * 0.9) * (back + 30)];
      } else goal = [gx, gy];
      farTime = dSq > 500 ? farTime + dt : 0;
      if (farTime > 2.5 + style.recallRate * 4 && !w.mods.noRecall) {
        pressed.add('recall');
        farTime = 0;
      }
    } else if (s.recall) {
      goal = null;
    } else if (sSp >= 260) {
      goal = null;
    }
    if (target && sSp < 30 && R() < dt * style.recallRate * 0.3 && !w.mods.noRecall && dSq > 300) pressed.add('recall');
    // --- move
    let mx = 0;
    let my = 0;
    if (goal) {
      const [wx, wy] = nextWaypoint(G, p.x, p.y, goal[0], goal[1]);
      const d = SQ.dist(p.x, p.y, wx, wy);
      if (d > 3) {
        const sp = Math.min(1, d / 40);
        mx = ((wx - p.x) / d) * sp;
        my = ((wy - p.y) / d) * sp;
      }
    }
    mx += ax;
    my += ay;
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    mv = { x: mx, y: my };
    if (launchNow) pressed.add('launch');
    w.frame(dt, input);
    if (opts.trace && f % 30 === 0) opts.trace(w, { target, aimPt, goal, launchNow });
    if (w.state === 'clear') return { win: true, t: w.clearTime };
  }
  return { win: false, t: SECONDS, why: 'timeout (' + w.enemies.filter((e) => e.alive && e.required).length + ' left)' };
}

if (require.main === module) {
  const rows = [];
  for (const { label, def } of allLevels(SQ)) {
    if (FILTER && !label.includes(FILTER)) continue;
    let wins = 0;
    let best = null;
    const why = {};
    for (let i = 0; i < ATTEMPTS; i++) {
      const r = play(def, 1000 + i * 7919, process.env.INVINCIBLE ? { worldOpts: { invincible: true } } : {});
      if (r.win) {
        wins++;
        best = best == null ? r.t : Math.min(best, r.t);
      } else {
        const k = r.why.replace(/\(\d+ left\)/, '').trim();
        why[k] = (why[k] || 0) + 1;
      }
    }
    const reasons = Object.entries(why).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(', ');
    const line = `${label.padEnd(34)} ${String(wins).padStart(3)}/${ATTEMPTS}  best ${best == null ? '  -  ' : best.toFixed(1).padStart(5)}  ${reasons}`;
    rows.push(line);
    console.log(line);
  }
}

module.exports = { play, SQ };
