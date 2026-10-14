// The simulation: one level (or arena) with the player circle, the square,
// walls, hazards and enemies. Runs at a fixed 240 Hz step so a fast square
// can't tunnel through thin walls.
'use strict';

SQ.makeConstants = (slow, mods = {}) => {
  const k = {
    pr: 24, // player radius
    sr: 16, // square collision radius (drawn as a 30px square)
    pSpeed: 330,
    range: 165, // launch range, centre to centre
    vMin: 520, // launch speed at the edge of the range
    vMax: 1550, // launch speed point-blank
    friction: 0.55,
    decel: 40,
    lethal: 150, // square hurts you at or above this speed
    kill: 250, // square destroys enemies at or above this speed
    armor: 1050, // ...armored ones only at or above this
    recallAcc: 2000,
    recallMax: 1100,
    buffer: 0.12, // launch press is remembered this long
    enemySpeed: 1,
  };
  if (slow)
    Object.assign(k, {
      range: 205,
      vMin: 420,
      vMax: 1050,
      armor: 760,
      recallAcc: 1400,
      recallMax: 760,
      buffer: 0.3,
      enemySpeed: 0.85,
    });
  if (mods.hyper) {
    k.friction = 0;
    k.decel = 0;
    k.vMax *= 1.2;
    k.recallMax *= 1.25;
    k.recallAcc *= 1.3;
  }
  k.dragScale = k.vMax / 1550;
  return k;
};

SQ.World = class World {
  constructor(def, opts = {}) {
    this.def = def;
    this.opts = opts;
    this.palKey = opts.palette || def.palette || 'sand';
    this.pal = SQ.PALETTES[this.palKey];
    this.mods = Object.assign({}, def.mods || {}, opts.mods || {});
    this.K = SQ.makeConstants(SQ.save.settings.slowMode, this.mods);
    this.reset();
  }

  reset() {
    const d = this.def;
    const K = this.K;
    this.t = 0;
    this.state = 'play';
    this.stateT = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.timeScale = 1;
    this.acc = 0;
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.bullets = [];
    this.launches = 0;
    this.kills = 0;
    this.failReason = '';
    this.launchBuf = 0;
    this.rangeGlow = 0;
    this.nextId = 1;
    const p = d.p || [200, 450];
    this.player = { x: p[0], y: p[1], vx: 0, vy: 0, r: K.pr, alive: true, face: 0 };
    const sqs = d.squares || [d.s || [p[0] + 70, p[1]]];
    const n = this.mods.twin ? Math.max(2, sqs.length) : sqs.length;
    this.squares = [];
    this.foeSquares = [];
    for (let i = 0; i < n; i++) {
      const s = sqs[i] || [p[0] - 70, p[1]];
      this.squares.push(this.makeSquare(s[0], s[1]));
    }
    this.walls = (d.walls || []).map((w) => this.makeWall(w));
    this.hazards = (d.hazards || []).map((h) => Object.assign({ phase: 0 }, h));
    this.enemies = [];
    for (const e of d.enemies || []) this.spawnEnemy(e);
    for (const e of this.enemies) {
      const def = SQ.ENEMY[e.t];
      if (def.link) def.link(e, this);
    }
    this.spawner = this.opts.spawner ? this.opts.spawner(this) : null;
    this.updateWalls(0);
  }

  makeSquare(x, y) {
    return {
      x, y, vx: 0, vy: 0, r: this.K.sr, recall: false, ang: 0.3, trail: [],
      bounces: 0, armed: false, chain: 0, portalCd: 0, hits: new Map(), own: 'player',
    };
  }

  makeWall(w) {
    const o = {
      k: w.k || 'r', x: w.x, y: w.y, w: w.w || 0, h: w.h || 0, r: w.r || 0,
      a0: SQ.rad(w.a || 0), a: SQ.rad(w.a || 0), bx: w.x, by: w.y,
      move: w.move || null, spin: w.spin ? SQ.rad(w.spin) : 0,
      door: w.door || null, open: !!w.open, bumper: w.bumper || 0, pulse: 0,
      vx: 0, vy: 0, omega: 0,
    };
    return o;
  }

  spawnEnemy(spec, extra = {}) {
    const def = SQ.ENEMY[spec.t];
    if (!def) throw new Error('Unknown enemy type ' + spec.t);
    const e = Object.assign(
      { id: this.nextId++, alive: true, required: true, lethal: true, solid: true, inv: 0, flash: 0, vx: 0, vy: 0, a: 0, t0: this.t, spawnT: 0 },
      def.defaults ? def.defaults() : {},
      spec,
      extra
    );
    e.x0 = e.x;
    e.y0 = e.y;
    if (def.init) def.init(e, this);
    this.enemies.push(e);
    return e;
  }

  // ---------------------------------------------------------------- update
  frame(dt, input) {
    // Input is read once per rendered frame; the simulation sub-steps.
    if (this.state === 'play' && input) this.handleInput(input);
    this.rangeGlow = SQ.lerp(this.rangeGlow, this.squareInRange() ? 1 : 0, Math.min(1, dt * 18));
    this.updateFx(dt);
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    const step = 1 / 240;
    this.acc += Math.min(dt, 0.05) * this.timeScale;
    while (this.acc >= step) {
      this.acc -= step;
      this.step(step);
    }
    for (const s of this.squares.concat(this.foeSquares)) {
      s.trail.push([s.x, s.y]);
      if (s.trail.length > 18) s.trail.shift();
    }
  }

  handleInput(input) {
    const m = input.move();
    this.moveIn = m;
    if (input.pressed('launch')) this.launchBuf = this.K.buffer;
    if (input.pressed('recall')) this.recall();
  }

  squareInRange() {
    const p = this.player;
    return this.squares.some((s) => SQ.dist(p.x, p.y, s.x, s.y) <= this.K.range);
  }

  recall() {
    if (this.mods.noRecall) {
      this.toast('no recall', this.player.x, this.player.y - 40);
      SQ.audio.play('denied');
      return;
    }
    let any = false;
    for (const s of this.squares) {
      if (!s.recall) {
        s.recall = true;
        any = true;
      }
    }
    if (any) SQ.audio.play('recall');
  }

  tryLaunch() {
    const K = this.K;
    const p = this.player;
    let did = false;
    for (const s of this.squares) {
      const d = SQ.dist(p.x, p.y, s.x, s.y);
      if (d > K.range) continue;
      if (this.mods.maxLaunches != null && this.launches >= this.mods.maxLaunches) {
        this.toast('out of launches', p.x, p.y - 40);
        SQ.audio.play('denied');
        return true;
      }
      let nx = (s.x - p.x) / (d || 1);
      let ny = (s.y - p.y) / (d || 1);
      if (d < 1) {
        nx = Math.cos(p.face);
        ny = Math.sin(p.face);
      }
      const t = SQ.clamp((K.range - d) / (K.range - (K.pr + K.sr)), 0, 1);
      const sp = K.vMin + (K.vMax - K.vMin) * t;
      // Push the square clear of the player so it doesn't clip us on frame one.
      const minD = K.pr + K.sr + 2;
      if (d < minD) {
        s.x = p.x + nx * minD;
        s.y = p.y + ny * minD;
      }
      s.vx = nx * sp;
      s.vy = ny * sp;
      s.recall = false;
      s.bounces = 0;
      s.armed = false;
      s.chain = 0;
      s.hits.clear();
      did = true;
      SQ.audio.play('launch', t);
      this.ring(s.x, s.y, 10 + t * 40, this.pal.square, 0.25);
      this.shake = Math.max(this.shake, 2 + t * 5);
      for (let i = 0; i < 6; i++)
        this.particle(p.x + nx * K.pr, p.y + ny * K.pr, -nx * 120 + SQ.rand(-80, 80), -ny * 120 + SQ.rand(-80, 80), this.pal.playerHot, 0.3, 4);
    }
    if (did) this.launches++;
    return did;
  }

  step(dt) {
    this.t += dt;
    if (this.state === 'play') {
      if (this.launchBuf > 0) {
        if (this.tryLaunch()) this.launchBuf = 0;
        else this.launchBuf -= dt;
      }
    }
    this.updateWalls(dt);
    this._solids = null;
    if (this.player.alive) this.updatePlayer(dt);
    for (const s of this.squares) this.updateSquare(s, dt);
    for (const s of this.foeSquares) this.updateSquare(s, dt);
    if (this.squares.length + this.foeSquares.length > 1) this.squarePairs();
    for (const e of this.enemies) if (e.alive) this.updateEnemy(e, dt);
    this.updateBullets(dt);
    if (this.spawner) this.spawner.update(dt);
    if (this.state === 'play') {
      this.checkPlayerHazards();
      if (this.mods.timeLimit && this.t > this.mods.timeLimit) this.fail('out of time');
      this.checkClear();
      if (this.mods.maxLaunches != null && this.launches >= this.mods.maxLaunches && this.state === 'play') {
        if (this.squares.every((s) => Math.hypot(s.vx, s.vy) < 25 && !s.recall)) this.fail('out of launches');
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive || e.keep);
  }

  updateWalls(dt) {
    for (const w of this.walls) {
      const ox = w.x;
      const oy = w.y;
      const oa = w.a;
      if (w.move) {
        const m = w.move;
        const ph = (this.t / m.period) * Math.PI * 2 + (m.phase || 0) * Math.PI * 2;
        const f = m.linear ? Math.abs(((this.t / m.period + (m.phase || 0)) % 1) * 2 - 1) : 0.5 - 0.5 * Math.cos(ph);
        w.x = w.bx + m.dx * f;
        w.y = w.by + m.dy * f;
      }
      if (w.spin) w.a = w.a0 + w.spin * this.t;
      if (dt > 0) {
        w.vx = (w.x - ox) / dt;
        w.vy = (w.y - oy) / dt;
        w.omega = w.spin;
      }
      if (w.pulse > 0) w.pulse = Math.max(0, w.pulse - dt * 4);
      void oa;
    }
  }

  // All solid things the square and player collide with this step.
  solids() {
    if (this._solids) return this._solids;
    const out = (this._solids = []);
    for (const w of this.walls) if (!w.open) out.push(w);
    for (const h of this.hazards) {
      if (h.t === 'well') out.push({ k: 'c', x: h.x, y: h.y, r: h.core || 50, vx: 0, vy: 0, well: true });
    }
    for (const e of this.enemies) if (e.alive && e.shields && e.spawnT <= 0) for (const s of e.shields) out.push(s);
    return out;
  }

  collide(x, y, r, w) {
    if (w.k === 'c') return SQ.circleCircle(x, y, r, w.x, w.y, w.r);
    return SQ.circleRect(x, y, r, w);
  }

  // Velocity of a wall's surface at a point (moving + spinning walls).
  wallVel(w, px, py) {
    let vx = w.vx || 0;
    let vy = w.vy || 0;
    if (w.omega) {
      const cx = w.px != null ? w.px : w.x;
      const cy = w.py != null ? w.py : w.y;
      vx += -w.omega * (py - cy);
      vy += w.omega * (px - cx);
    }
    return [vx, vy];
  }

  updatePlayer(dt) {
    const K = this.K;
    const p = this.player;
    const m = this.state === 'play' && this.moveIn ? this.moveIn : { x: 0, y: 0 };
    const sp = K.pSpeed * (this.mods.playerSpeed || 1);
    const k = Math.min(1, dt * 16);
    p.vx += (m.x * sp - p.vx) * k;
    p.vy += (m.y * sp - p.vy) * k;
    if (Math.hypot(m.x, m.y) > 0.1) p.face = Math.atan2(m.y, m.x);
    for (const h of this.hazards) {
      if (h.t === 'wind' && Math.abs(p.x - h.x) < h.w / 2 && Math.abs(p.y - h.y) < h.h / 2) {
        p.x += h.fx * 0.18 * dt;
        p.y += h.fy * 0.18 * dt;
      }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const solids = this.solids();
    for (let iter = 0; iter < 2; iter++) {
      for (const w of solids) {
        const c = this.collide(p.x, p.y, p.r, w);
        if (!c) continue;
        p.x += c.nx * c.depth;
        p.y += c.ny * c.depth;
        const vn = p.vx * c.nx + p.vy * c.ny;
        if (vn < 0) {
          p.vx -= vn * c.nx;
          p.vy -= vn * c.ny;
        }
      }
      p.x = SQ.clamp(p.x, p.r, SQ.W - p.r);
      p.y = SQ.clamp(p.y, p.r, SQ.H - p.r);
    }
    // Crushed between a moving wall and something else.
    if (this.state === 'play') {
      for (const w of solids) {
        const c = this.collide(p.x, p.y, p.r, w);
        if (c && c.depth > 9) {
          this.killPlayer('crushed');
          break;
        }
      }
    }
  }

  updateSquare(s, dt) {
    const K = this.K;
    const p = this.player;
    if (s.portalCd > 0) s.portalCd -= dt;
    for (const [id, t] of s.hits) {
      if (t - dt <= 0) s.hits.delete(id);
      else s.hits.set(id, t - dt);
    }
    let speed = Math.hypot(s.vx, s.vy);
    const target = s.target || p;
    if (s.recall && (target.alive !== false)) {
      const dx = target.x - s.x;
      const dy = target.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d;
      const ny = dy / d;
      // Accelerate toward the player and bleed off sideways drift so the
      // square actually arrives instead of orbiting.
      const along = s.vx * nx + s.vy * ny;
      let tx = s.vx - along * nx;
      let ty = s.vy - along * ny;
      const damp = Math.exp(-3.2 * dt);
      tx *= damp;
      ty *= damp;
      const acc = s.recallAcc || K.recallAcc;
      const nv = along + acc * dt;
      s.vx = tx + nx * nv;
      s.vy = ty + ny * nv;
      speed = Math.hypot(s.vx, s.vy);
      const mx = s.recallMax || K.recallMax;
      if (speed > mx) {
        s.vx *= mx / speed;
        s.vy *= mx / speed;
        speed = mx;
      }
    } else if (speed > 0) {
      const ns = Math.max(0, speed * Math.exp(-K.friction * dt) - K.decel * dt);
      s.vx *= ns / speed;
      s.vy *= ns / speed;
      speed = ns;
    }
    // Field effects.
    for (const h of this.hazards) {
      if (h.t === 'well') {
        const dx = h.x - s.x;
        const dy = h.y - s.y;
        const d = Math.hypot(dx, dy);
        const R = h.R || 320;
        if (d < R && d > 1) {
          const a = (h.str || 1500) * (1 - d / R);
          s.vx += (dx / d) * a * dt;
          s.vy += (dy / d) * a * dt;
        }
      } else if (h.t === 'wind') {
        if (Math.abs(s.x - h.x) < h.w / 2 && Math.abs(s.y - h.y) < h.h / 2) {
          s.vx += h.fx * dt;
          s.vy += h.fy * dt;
        }
      }
    }
    for (const e of this.enemies) {
      if (e.alive && e.field && e.spawnT <= 0) {
        if (SQ.dist(s.x, s.y, e.x, e.y) < e.field) {
          const ss = Math.hypot(s.vx, s.vy);
          if (ss > 0) {
            const ns = Math.max(0, ss - e.drag * K.dragScale * ss * dt);
            s.vx *= ns / ss;
            s.vy *= ns / ss;
          }
        }
      }
    }
    // Integrate in small slices so even max speed never skips a wall.
    this.capSpeed(s);
    speed = Math.hypot(s.vx, s.vy);
    const slices = Math.max(1, Math.ceil((speed * dt) / 5));
    const sdt = dt / slices;
    for (let i = 0; i < slices; i++) {
      s.x += s.vx * sdt;
      s.y += s.vy * sdt;
      this.squareWalls(s);
    }
    s.ang += (Math.hypot(s.vx, s.vy) / 60) * dt * (s.spinDir || 1);
    // Portals.
    for (const h of this.hazards) {
      if (h.t !== 'portal' || s.portalCd > 0) continue;
      const r = h.r || 36;
      let from = null;
      let to = null;
      if (SQ.dist(s.x, s.y, h.ax, h.ay) < r) {
        from = [h.ax, h.ay];
        to = [h.bx, h.by];
      } else if (SQ.dist(s.x, s.y, h.bx, h.by) < r) {
        from = [h.bx, h.by];
        to = [h.ax, h.ay];
      }
      if (from) {
        const sp = Math.hypot(s.vx, s.vy) || 1;
        const ox = s.x - from[0];
        const oy = s.y - from[1];
        s.x = to[0] + ox * 0.2 + (s.vx / sp) * 4;
        s.y = to[1] + oy * 0.2 + (s.vy / sp) * 4;
        s.trail.length = 0;
        s.portalCd = 0.35;
        this.ring(from[0], from[1], 40, this.pal.hazard, 0.4);
        this.ring(to[0], to[1], 40, this.pal.hazard, 0.4);
        SQ.audio.play('portal');
      }
    }
    // Switches.
    speed = Math.hypot(s.vx, s.vy);
    for (const h of this.hazards) {
      if (h.t !== 'switch') continue;
      h.cd = (h.cd || 0) - dt;
      if (h.cd <= 0 && speed >= K.kill && SQ.dist(s.x, s.y, h.x, h.y) < (h.r || 20) + s.r) {
        h.cd = 0.5;
        if (h.once && h.on) continue;
        h.on = !h.on;
        for (const w of this.walls) if (w.door === h.door) w.open = !w.open;
        this._solids = null;
        SQ.audio.play('switch');
        this.ring(h.x, h.y, 50, this.pal.hazard, 0.4);
      }
    }
    // Enemies.
    if (s.own === 'player' && speed > 1)
      for (const e of this.enemies) {
        if (!e.alive || e.spawnT > 0 || !e.solid || e === s.ownerEnemy) continue;
        if (s.hits.has(e.id)) continue;
        if (SQ.dist(s.x, s.y, e.x, e.y) < e.r + s.r) this.squareHitsEnemy(s, e);
      }
    // Bullets are swept away by a dangerous square.
    if (speed >= K.lethal)
      for (const b of this.bullets) {
        if (b.alive && SQ.dist(s.x, s.y, b.x, b.y) < b.r + s.r + 4) {
          b.alive = false;
          this.burst(b.x, b.y, this.pal.enemy, 5, 140);
        }
      }
    // The player.
    this.squareVsCircle(s, p, true);
    if (s.extraTargets) for (const c of s.extraTargets) if (c.alive) this.squareVsCircle(s, c, false);
  }

  squareVsCircle(s, p, isPlayer) {
    const K = this.K;
    if (!p.alive) return;
    const c = SQ.circleCircle(s.x, s.y, s.r, p.x, p.y, p.r);
    if (!c) return;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed >= K.lethal) {
      if (isPlayer) {
        if (this.state === 'play') this.killPlayer(s.own === 'player' ? 'hit by your own square' : 'hit by its square');
      } else if (p.onSquareHit) p.onSquareHit(s);
      return;
    }
    // A slow square is just nudged out of the way, but never out of the
    // arena or into a wall: if it is wedged, the circle gives way instead.
    const ox = s.x;
    const oy = s.y;
    s.x += c.nx * c.depth;
    s.y += c.ny * c.depth;
    s.x = SQ.clamp(s.x, s.r, SQ.W - s.r);
    s.y = SQ.clamp(s.y, s.r, SQ.H - s.r);
    for (const w of this.solids()) {
      const cw = this.collide(s.x, s.y, s.r, w);
      if (cw) {
        s.x += cw.nx * cw.depth;
        s.y += cw.ny * cw.depth;
      }
    }
    const still = SQ.circleCircle(s.x, s.y, s.r, p.x, p.y, p.r);
    if (still && SQ.dist(ox, oy, s.x, s.y) < c.depth * 0.5) {
      p.x -= still.nx * still.depth;
      p.y -= still.ny * still.depth;
    }
    const pvn = (p.vx || 0) * -c.nx + (p.vy || 0) * -c.ny;
    const svn = s.vx * -c.nx + s.vy * -c.ny;
    const push = Math.min(130, Math.max(0, pvn - svn));
    s.vx += c.nx * push;
    s.vy += c.ny * push;
    if (s.recall && (s.target || this.player) === p) {
      // Caught gently: the recall ends.
      s.recall = false;
      s.vx *= 0.2;
      s.vy *= 0.2;
    }
  }

  squareWalls(s) {
    const solids = this.solids();
    for (const w of solids) {
      const c = this.collide(s.x, s.y, s.r, w);
      if (!c) continue;
      s.x += c.nx * c.depth;
      s.y += c.ny * c.depth;
      const [wvx, wvy] = this.wallVel(w, s.x - c.nx * s.r, s.y - c.ny * s.r);
      const rvx = s.vx - wvx;
      const rvy = s.vy - wvy;
      const vn = rvx * c.nx + rvy * c.ny;
      if (vn < 0) {
        // Reflect relative to the wall, so moving walls bat the square along.
        s.vx -= 2 * vn * c.nx;
        s.vy -= 2 * vn * c.ny;
        this.onSquareBounce(s, -vn, c, w);
        this.capSpeed(s);
      }
    }
    // Arena edges.
    const r = s.r;
    let hit = null;
    if (s.x < r) {
      s.x = r;
      if (s.vx < 0) hit = [1, 0, -s.vx];
    } else if (s.x > SQ.W - r) {
      s.x = SQ.W - r;
      if (s.vx > 0) hit = [-1, 0, s.vx];
    }
    if (hit) {
      s.vx = -s.vx;
      this.onSquareBounce(s, hit[2], { nx: hit[0], ny: hit[1] }, null);
    }
    hit = null;
    if (s.y < r) {
      s.y = r;
      if (s.vy < 0) hit = [0, 1, -s.vy];
    } else if (s.y > SQ.H - r) {
      s.y = SQ.H - r;
      if (s.vy > 0) hit = [0, -1, s.vy];
    }
    if (hit) {
      s.vy = -s.vy;
      this.onSquareBounce(s, hit[2], { nx: hit[0], ny: hit[1] }, null);
    }
  }

  // A square pinned between a moving wall and something else would otherwise
  // gain speed on every contact.
  capSpeed(s) {
    const sp = Math.hypot(s.vx, s.vy);
    const max = 1900;
    if (sp > max) {
      s.vx *= max / sp;
      s.vy *= max / sp;
    }
  }

  onSquareBounce(s, vn, c, w) {
    s.bounces++;
    s.armed = true;
    s.spinDir = -(s.spinDir || 1);
    if (w && w.bumper) {
      const sp = Math.hypot(s.vx, s.vy) || 1;
      const ns = Math.min(1900, sp * w.bumper + 160);
      s.vx *= ns / sp;
      s.vy *= ns / sp;
      w.pulse = 1;
      SQ.audio.play('bump');
      this.ring(w.x, w.y, w.r + 30, this.pal.hazard, 0.35);
    } else if (vn > 120) {
      SQ.audio.play('bounce', vn);
      if (vn > 400) {
        for (let i = 0; i < 3; i++)
          this.particle(s.x - c.nx * s.r, s.y - c.ny * s.r, c.nx * 160 + SQ.rand(-120, 120), c.ny * 160 + SQ.rand(-120, 120), this.pal.square, 0.25, 3);
      }
    }
    if (this.mods.maxBounces != null && s.own === 'player' && this.state === 'play' && s.bounces > this.mods.maxBounces) {
      this.shatterSquare(s);
    }
  }

  shatterSquare(s) {
    this.burst(s.x, s.y, this.pal.square, 18, 300);
    SQ.audio.play('death');
    this.fail('the square shattered');
  }

  squarePairs() {
    const all = this.squares.concat(this.foeSquares);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) this.squarePair(all[i], all[j]);
  }

  squarePair(a, b) {
    const c = SQ.circleCircle(a.x, a.y, a.r, b.x, b.y, b.r);
    if (!c) return;
    a.x += (c.nx * c.depth) / 2;
    a.y += (c.ny * c.depth) / 2;
    b.x -= (c.nx * c.depth) / 2;
    b.y -= (c.ny * c.depth) / 2;
    const va = a.vx * c.nx + a.vy * c.ny;
    const vb = b.vx * c.nx + b.vy * c.ny;
    if (va - vb >= 0) return;
    a.vx += (vb - va) * c.nx;
    a.vy += (vb - va) * c.ny;
    b.vx += (va - vb) * c.nx;
    b.vy += (va - vb) * c.ny;
    SQ.audio.play('bounce', Math.abs(va - vb));
  }

  squareHitsEnemy(s, e) {
    const K = this.K;
    const def = SQ.ENEMY[e.t];
    const speed = Math.hypot(s.vx, s.vy);
    let res;
    if (s.own === 'player' && this.mods.ricochet && !s.armed && speed >= K.kill) res = 'bounce';
    else if (def.onHit) res = def.onHit(e, this, s, speed);
    else res = speed >= K.kill ? 'kill' : 'bounce';
    if (res === 'kill') {
      s.hits.set(e.id, 0.2);
      this.killEnemy(e, s);
      // Plough through, losing a little speed.
      s.vx *= 0.92;
      s.vy *= 0.92;
    } else if (res === 'damage') {
      s.hits.set(e.id, 0.3);
      this.damageEnemy(e, s);
      this.bounceOff(s, e);
    } else if (res === 'bounce') {
      s.hits.set(e.id, 0.08);
      this.bounceOff(s, e);
      if (speed >= K.kill) {
        SQ.audio.play('clank');
        e.flash = 0.15;
        this.ring(e.x, e.y, e.r + 14, this.pal.hazard, 0.2);
      }
    }
  }

  bounceOff(s, e) {
    const c = SQ.circleCircle(s.x, s.y, s.r, e.x, e.y, e.r);
    if (!c) return;
    s.x += c.nx * c.depth;
    s.y += c.ny * c.depth;
    const rvx = s.vx - (e.vx || 0);
    const rvy = s.vy - (e.vy || 0);
    const vn = rvx * c.nx + rvy * c.ny;
    if (vn < 0) {
      s.vx -= 2 * vn * c.nx;
      s.vy -= 2 * vn * c.ny;
      s.bounces++;
      s.armed = true;
    }
  }

  damageEnemy(e, s) {
    e.hp--;
    e.inv = e.invTime || 0.8;
    e.flash = 0.3;
    this.hitstop = 0.06;
    this.shake = Math.max(this.shake, 10);
    SQ.audio.play('hurt');
    this.burst(s.x, s.y, this.pal.enemy, 14, 380);
    this.ring(e.x, e.y, e.r + 40, this.pal.enemy, 0.35);
    const def = SQ.ENEMY[e.t];
    if (def.onDamage) def.onDamage(e, this, s);
    if (e.hp <= 0) this.killEnemy(e, s);
  }

  killEnemy(e, s) {
    if (!e.alive) return;
    e.alive = false;
    this.kills++;
    const def = SQ.ENEMY[e.t];
    if (s) {
      s.chain = (s.chain || 0) + 1;
      if (s.chain > 1) this.toast('x' + s.chain, e.x, e.y - e.r - 14);
    }
    this.hitstop = Math.max(this.hitstop, e.boss ? 0.25 : 0.045);
    this.shake = Math.max(this.shake, e.boss ? 22 : 7);
    SQ.audio.play('kill', s ? s.chain : 1);
    this.burst(e.x, e.y, e.color ? this.pal[e.color] : this.pal.enemy, e.boss ? 60 : 22, e.boss ? 600 : 380);
    this.ring(e.x, e.y, e.r + 30, this.pal.enemy, 0.3);
    if (def.onDeath) def.onDeath(e, this, s);
    if (this.spawner && this.spawner.onKill) this.spawner.onKill(e, s);
    if (e.boss) {
      // Minions die with their master.
      for (const o of this.enemies) if (o.alive && o.minionOf === e.id) this.killEnemy(o, null);
      this.bullets.forEach((b) => (b.alive = false));
    }
  }

  updateEnemy(e, dt) {
    const def = SQ.ENEMY[e.t];
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      if (e.spawnT <= 0) SQ.audio.play('spawn');
      return;
    }
    if (e.inv > 0) e.inv -= dt;
    if (e.flash > 0) e.flash -= dt;
    SQ.moveGeneric(e, this, dt);
    if (def.update) def.update(e, this, dt);
    if (this.state === 'play' && this.player.alive && e.lethal && e.solid && !e.ghost) {
      const p = this.player;
      if (SQ.dist(p.x, p.y, e.x, e.y) < p.r + e.r - 3) this.killPlayer(e.deathMsg || 'touched an enemy');
    }
  }

  // Enemy body vs walls. Returns the last contact normal, if any.
  enemyWalls(e, bounce) {
    let hit = null;
    for (const w of this.solids()) {
      if (e.shields && e.shields.includes(w)) continue;
      const c = this.collide(e.x, e.y, e.r, w);
      if (!c) continue;
      e.x += c.nx * c.depth;
      e.y += c.ny * c.depth;
      const vn = e.vx * c.nx + e.vy * c.ny;
      if (vn < 0) {
        if (bounce) {
          e.vx -= 2 * vn * c.nx;
          e.vy -= 2 * vn * c.ny;
        } else {
          e.vx -= vn * c.nx;
          e.vy -= vn * c.ny;
        }
      }
      hit = c;
    }
    const r = e.r;
    if (e.x < r || e.x > SQ.W - r) {
      e.x = SQ.clamp(e.x, r, SQ.W - r);
      e.vx = bounce ? -e.vx : 0;
      hit = hit || { nx: e.x < SQ.W / 2 ? 1 : -1, ny: 0 };
    }
    if (e.y < r || e.y > SQ.H - r) {
      e.y = SQ.clamp(e.y, r, SQ.H - r);
      e.vy = bounce ? -e.vy : 0;
      hit = hit || { nx: 0, ny: e.y < SQ.H / 2 ? 1 : -1 };
    }
    return hit;
  }

  fireBullet(x, y, ang, speed, opts = {}) {
    this.bullets.push(Object.assign({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 7, alive: true, life: 12 }, opts));
  }

  updateBullets(dt) {
    const solids = this.solids();
    for (const b of this.bullets) {
      if (!b.alive) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.y < -20 || b.x > SQ.W + 20 || b.y > SQ.H + 20) {
        b.alive = false;
        continue;
      }
      for (const w of solids) {
        if (this.collide(b.x, b.y, b.r, w)) {
          b.alive = false;
          this.burst(b.x, b.y, this.pal.enemy, 3, 80);
          break;
        }
      }
      const p = this.player;
      if (b.alive && this.state === 'play' && p.alive && SQ.dist(b.x, b.y, p.x, p.y) < b.r + p.r - 2) this.killPlayer('shot');
    }
    this.bullets = this.bullets.filter((b) => b.alive);
  }

  checkPlayerHazards() {
    const p = this.player;
    if (!p.alive) return;
    for (const h of this.hazards) {
      if (h.t === 'spinner') {
        for (const [ax, ay, bx, by] of SQ.spinnerArms(h, this.t)) {
          if (SQ.segDist(p.x, p.y, ax, ay, bx, by) < p.r + 5) return this.killPlayer('cut by a spinner');
        }
      } else if (h.t === 'laser') {
        if (SQ.laserOn(h, this.t) > 0.99 && SQ.segDist(p.x, p.y, h.x1, h.y1, h.x2, h.y2) < p.r + 3)
          return this.killPlayer('burned by a laser');
      }
    }
  }

  checkClear() {
    if (this.spawner) {
      if (this.spawner.done && this.spawner.done()) this.win();
      return;
    }
    if (!this.enemies.some((e) => e.alive && e.required)) this.win();
  }

  win() {
    if (this.state !== 'play') return;
    this.state = 'clear';
    this.stateT = 0;
    this.clearTime = this.t;
    SQ.audio.play('clear');
    for (const s of this.squares) {
      s.recall = false;
    }
    this.ring(this.player.x, this.player.y, 160, this.pal.playerHot, 0.7);
  }

  killPlayer(reason) {
    if (this.state !== 'play' || !this.player.alive || this.opts.invincible) return;
    const p = this.player;
    p.alive = false;
    this.state = 'dead';
    this.stateT = 0;
    this.failReason = reason;
    this.shake = 18;
    this.hitstop = 0.12;
    this.timeScale = 0.35;
    SQ.audio.play('death');
    this.burst(p.x, p.y, this.pal.player, 40, 420);
    this.ring(p.x, p.y, 120, this.pal.player, 0.6);
  }

  fail(reason) {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.stateT = 0;
    this.failReason = reason;
    this.shake = 10;
    this.timeScale = 0.35;
    SQ.audio.play('death');
  }

  // ---------------------------------------------------------------- effects
  particle(x, y, vx, vy, color, life, size, shape) {
    if (this.particles.length > 900) return;
    this.particles.push({ x, y, vx, vy, color, life, max: life, size, rot: Math.random() * 6, vr: SQ.rand(-8, 8), shape });
  }
  burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.25 + Math.random() * 0.75);
      this.particle(x, y, Math.cos(a) * v, Math.sin(a) * v, color, SQ.rand(0.5, 1.1), SQ.rand(5, 11));
    }
  }
  ring(x, y, r, color, life) {
    this.rings.push({ x, y, r, color, life, max: life });
  }
  toast(text, x, y) {
    this.texts.push({ text, x, y, life: 0.9, max: 0.9 });
  }
  updateFx(dt) {
    this.stateT += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 50);
    for (const q of this.particles) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const f = Math.exp(-3.5 * dt);
      q.vx *= f;
      q.vy *= f;
      q.rot += q.vr * dt;
      q.life -= dt;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 30 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);
    if (this.state === 'dead') this.timeScale = SQ.lerp(this.timeScale, 0.15, dt * 3);
  }
};

// Generic movement any enemy can have: orbit a point, follow a path, bob.
SQ.moveGeneric = (e, w, dt) => {
  if (e.orbit) {
    const o = e.orbit;
    const c = o.around ? o.around : o;
    if (o.around && !o.around.alive) {
      e.orbit = null;
      return;
    }
    e.orbitA = (e.orbitA != null ? e.orbitA : SQ.rad(o.phase || 0)) + (o.speed || 0.8) * w.K.enemySpeed * dt;
    const nx = c.x + Math.cos(e.orbitA) * o.rad;
    const ny = c.y + Math.sin(e.orbitA) * o.rad;
    e.vx = (nx - e.x) / dt;
    e.vy = (ny - e.y) / dt;
    e.x = nx;
    e.y = ny;
  } else if (e.path) {
    const pts = e.path;
    e.pathI = e.pathI || 0;
    e.pathDir = e.pathDir || 1;
    let next = pts[e.pathI];
    const sp = (e.speed || 120) * w.K.enemySpeed;
    const dx = next[0] - e.x;
    const dy = next[1] - e.y;
    const d = Math.hypot(dx, dy);
    if (d < sp * dt + 0.5) {
      e.x = next[0];
      e.y = next[1];
      if (e.loop) e.pathI = (e.pathI + 1) % pts.length;
      else {
        if (e.pathI + e.pathDir >= pts.length || e.pathI + e.pathDir < 0) e.pathDir *= -1;
        e.pathI += e.pathDir;
      }
    } else {
      e.vx = (dx / d) * sp;
      e.vy = (dy / d) * sp;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    }
  }
};

SQ.spinnerArms = (h, t) => {
  const out = [];
  const n = h.arms || 1;
  const base = SQ.rad(h.phase || 0) + (h.speed || 1.4) * t;
  const inner = h.inner || 0;
  for (let i = 0; i < n; i++) {
    const a = base + (i * Math.PI * 2) / n;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.push([h.x + c * inner, h.y + s * inner, h.x + c * (h.len || 60), h.y + s * (h.len || 60)]);
  }
  return out;
};

// 0 = off, between 0 and 1 = warming up, 1 = deadly.
SQ.laserOn = (h, t) => {
  if (h.always) return 1;
  const on = h.on || 1.5;
  const off = h.off || 1.5;
  const per = on + off;
  const x = (((t + (h.phase || 0) * per) % per) + per) % per;
  if (x < off - 0.6) return 0;
  if (x < off) return (x - (off - 0.6)) / 0.6 * 0.9;
  return 1;
};
