// Enemy types. Each entry may define:
//   defaults()            default fields
//   init(e, w)            once on spawn
//   link(e, w)            once after the whole level is spawned
//   update(e, w, dt)      every 240 Hz step
//   onHit(e, w, s, speed) square touches it -> 'kill' | 'damage' | 'bounce' | 'pass'
//   onDamage / onDeath    reactions
//   draw(e, w, ctx, pal)
'use strict';
SQ.ENEMY = {};
(() => {
  const E = SQ.ENEMY;
  const D = SQ.drawing;
  const tint = (e, c) => (e.flash > 0 ? SQ.mix(c, '#ffffff', 0.65) : c);
  const bossHit = (e, w, s, speed) => (e.inv > 0 ? 'bounce' : speed >= w.K.kill ? 'damage' : 'bounce');
  const hpPips = (e, ctx, pal) => {
    const n = e.maxHp;
    for (let i = 0; i < n; i++) {
      const x = e.x + (i - (n - 1) / 2) * 16;
      D.diamond(ctx, x, e.y - e.r - 26, 9, 0, i < e.hp ? pal.enemy : SQ.rgba(pal.text, 0.25));
    }
  };

  // Attach a set of shield plates (solid walls) that rotate around an enemy.
  const makeShields = (e, sides, len, off, thick = 16) => {
    e.sides = sides;
    e.shields = sides.map(() => ({ k: 'r', x: e.x, y: e.y, w: thick, h: len, a: 0, vx: 0, vy: 0, omega: 0, px: e.x, py: e.y, shield: true }));
    e.shOff = off;
  };
  const placeShields = (e, omega) => {
    e.shields.forEach((s, i) => {
      const a = e.fa + SQ.rad(e.sides[i]);
      s.x = e.x + Math.cos(a) * e.shOff;
      s.y = e.y + Math.sin(a) * e.shOff;
      s.a = a;
      s.vx = e.vx || 0;
      s.vy = e.vy || 0;
      s.omega = omega || 0;
      s.px = e.x;
      s.py = e.y;
    });
  };
  const drawShields = (e, ctx, pal) => {
    for (const s of e.shields) D.rect(ctx, s, pal.wall);
  };

  // ------------------------------------------------------------- basics
  E.dummy = {
    defaults: () => ({ r: 26, rot: 0 }),
    update(e, w) {
      e.a = SQ.rad(e.rot) * w.t;
    },
    draw(e, w, ctx, pal) {
      D.diamond(ctx, e.x, e.y, e.r * 1.2, e.a, tint(e, pal.enemy));
    },
  };

  E.shield = {
    defaults: () => ({ r: 22, face: 180, mode: 'fixed', turn: 80, spinRate: 60, sides: [0], len: 104, off: 46 }),
    init(e) {
      e.fa = SQ.rad(e.face);
      makeShields(e, e.sides, e.len, e.off);
      placeShields(e, 0);
    },
    update(e, w, dt) {
      const prev = e.fa;
      if (e.mode === 'spin') e.fa += SQ.rad(e.spinRate) * dt * w.K.enemySpeed;
      else if (e.mode === 'track' && w.player.alive)
        e.fa = SQ.turnToward(e.fa, SQ.angleTo(e.x, e.y, w.player.x, w.player.y), SQ.rad(e.turn) * dt * w.K.enemySpeed);
      placeShields(e, (e.fa - prev) / dt);
    },
    draw(e, w, ctx, pal) {
      D.square(ctx, e.x, e.y, e.r * 1.6, e.fa, tint(e, pal.enemy2));
      drawShields(e, ctx, pal);
    },
  };

  const chaserUpdate = (e, w, dt) => {
    const p = w.player;
    const tx = p.alive ? p.x : e.x + Math.cos(e.a) * 50;
    const ty = p.alive ? p.y : e.y + Math.sin(e.a) * 50;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = e.speed * w.K.enemySpeed;
    const k = Math.min(1, e.turnK * dt);
    e.vx += ((dx / d) * sp - e.vx) * k;
    e.vy += ((dy / d) * sp - e.vy) * k;
    for (const o of w.enemies) {
      if (o === e || !o.alive || !o.flock) continue;
      const c = SQ.circleCircle(e.x, e.y, e.r, o.x, o.y, o.r);
      if (c) {
        e.x += c.nx * c.depth * 0.5;
        e.y += c.ny * c.depth * 0.5;
      }
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    w.enemyWalls(e, false);
    if (Math.hypot(e.vx, e.vy) > 5) e.a = Math.atan2(e.vy, e.vx);
  };
  const chaserDraw = (e, w, ctx, pal) => {
    const sp = Math.hypot(e.vx, e.vy);
    D.tail(ctx, e.x, e.y, e.a, e.r * 0.6, e.r * 1.2 + sp * 0.35, pal.enemy2);
    D.triangle(ctx, e.x, e.y, e.r * 1.35, e.a, tint(e, pal.enemy));
  };
  E.chaser = {
    defaults: () => ({ r: 20, speed: 150, turnK: 2.4, flock: true }),
    init(e) {
      e.a = e.face != null ? SQ.rad(e.face) : Math.PI;
    },
    update: chaserUpdate,
    draw: chaserDraw,
  };
  E.mini = {
    defaults: () => ({ r: 12, speed: 165, turnK: 3, flock: true }),
    update: chaserUpdate,
    draw: chaserDraw,
  };

  E.drifter = {
    defaults: () => ({ r: 20, speed: 140, dir: 30 }),
    init(e) {
      if (!e.vx && !e.vy) {
        e.vx = Math.cos(SQ.rad(e.dir)) * e.speed;
        e.vy = Math.sin(SQ.rad(e.dir)) * e.speed;
      }
    },
    update(e, w, dt) {
      const k = w.K.enemySpeed;
      e.x += e.vx * dt * k;
      e.y += e.vy * dt * k;
      w.enemyWalls(e, true);
      e.a += dt * 1.5;
    },
    draw(e, w, ctx, pal) {
      D.poly(ctx, e.x, e.y, e.r * 1.1, 6, e.a, tint(e, pal.enemy));
    },
  };

  E.turret = {
    defaults: () => ({ r: 24, rate: 1.9, bspeed: 250, aim: 'player', spread: 14, burst: 1, spinRate: 50, dir: 180 }),
    init(e) {
      e.ga = SQ.rad(e.dir);
      e.cool = e.delay != null ? e.delay : e.rate * 0.6 + 0.8;
    },
    update(e, w, dt) {
      const p = w.player;
      if (e.aim === 'player' && p.alive) e.ga = SQ.turnToward(e.ga, SQ.angleTo(e.x, e.y, p.x, p.y), 2.5 * dt);
      else if (e.aim === 'spin') e.ga += SQ.rad(e.spinRate) * dt;
      e.cool -= dt * w.K.enemySpeed;
      if (e.cool <= 0 && w.state === 'play') {
        e.cool = e.rate;
        for (let i = 0; i < e.burst; i++) {
          const a = e.ga + SQ.rad((i - (e.burst - 1) / 2) * e.spread);
          w.fireBullet(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, a, e.bspeed * w.K.enemySpeed);
        }
        SQ.audio.play('shoot');
      }
    },
    draw(e, w, ctx, pal) {
      const charge = SQ.clamp(1 - e.cool / 0.45, 0, 1);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.ga);
      ctx.fillStyle = tint(e, pal.enemy2);
      ctx.fillRect(0, -7, e.r + 14, 14);
      ctx.restore();
      D.circle(ctx, e.x, e.y, e.r, tint(e, pal.enemy));
      if (charge > 0) D.circle(ctx, e.x, e.y, e.r * 0.45 * charge, SQ.mix(pal.enemy, pal.hazard, 0.6));
    },
  };

  // ------------------------------------------------------------- linked
  E.core = {
    defaults: () => ({ r: 32, g: 'A' }),
    link(e, w) {
      e.nodes = w.enemies.filter((o) => o.t === 'node' && o.g === e.g);
      for (const n of e.nodes) {
        if (n.orbitCore) {
          const ph = (Math.atan2(n.y - e.y, n.x - e.x) * 180) / Math.PI;
          n.orbit = { around: e, rad: n.orbitCore, speed: n.ospeed || 0.8, phase: ph };
        }
      }
    },
    protected: (e) => e.nodes && e.nodes.some((n) => n.alive),
    onHit(e, w, s, speed) {
      if (E.core.protected(e)) return 'bounce';
      return speed >= w.K.kill ? 'kill' : 'bounce';
    },
    update(e, w) {
      e.a = w.t * 0.4;
    },
    draw(e, w, ctx, pal) {
      const prot = E.core.protected(e);
      for (const n of e.nodes || []) if (n.alive) D.dots(ctx, e.x, e.y, n.x, n.y, 30, 5, pal.enemy);
      D.diamond(ctx, e.x, e.y, e.r * 1.3, e.a, tint(e, prot ? pal.enemy2 : pal.enemy));
      if (prot) D.ring(ctx, e.x, e.y, e.r + 10, SQ.rgba(pal.enemy, 0.5), 3, [6, 8], w.t * 20);
    },
  };
  E.node = {
    defaults: () => ({ r: 16, g: 'A' }),
    update(e, w) {
      e.a = -w.t * 1.2;
    },
    draw(e, w, ctx, pal) {
      D.diamond(ctx, e.x, e.y, e.r * 1.35, e.a, tint(e, pal.enemy));
    },
  };

  E.warden = {
    defaults: () => ({ r: 24, field: 220, drag: 6 }),
    update(e, w) {
      e.a = w.t * 0.6;
    },
    draw(e, w, ctx, pal) {
      ctx.fillStyle = SQ.rgba(pal.hazard, 0.07);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.field, 0, Math.PI * 2);
      ctx.fill();
      D.ring(ctx, e.x, e.y, e.field, SQ.rgba(pal.hazard, 0.55), 4);
      D.diamond(ctx, e.x, e.y, e.r * 1.25, e.a, tint(e, pal.enemy2));
    },
  };

  // ------------------------------------------------------------- tough
  E.armored = {
    defaults: () => ({ r: 28, hp: 1 }),
    init(e) {
      e.maxHp = e.hp;
    },
    onHit(e, w, s, speed) {
      if (e.inv > 0) return 'bounce';
      if (speed < w.K.armor) return 'bounce';
      return e.hp > 1 ? 'damage' : 'kill';
    },
    update(e, w) {
      e.a = w.t * 0.25;
    },
    draw(e, w, ctx, pal) {
      D.square(ctx, e.x, e.y, e.r * 2, e.a, tint(e, pal.enemy2));
      D.square(ctx, e.x, e.y, e.r * 1.25, e.a + Math.PI / 4, tint(e, pal.enemy));
      if (e.maxHp > 1) hpPips(e, ctx, pal);
    },
  };

  const SPLIT_R = [0, 24, 34, 48];
  E.splitter = {
    defaults: () => ({ tier: 1, drift: false }),
    init(e) {
      e.r = SPLIT_R[e.tier] || 24;
      if (e.armor) e.maxHp = e.hp = e.hp || 1;
    },
    onHit(e, w, s, speed) {
      if (e.inv > 0) return 'bounce';
      if (e.armor && speed < w.K.armor) return 'bounce';
      if (speed < w.K.kill) return 'bounce';
      return e.hp > 1 ? 'damage' : 'kill';
    },
    update(e, w, dt) {
      e.a += dt * (e.drift ? 1.2 : 0.4);
      if (e.drift) {
        const k = w.K.enemySpeed;
        e.x += e.vx * dt * k;
        e.y += e.vy * dt * k;
        w.enemyWalls(e, true);
        const sp = Math.hypot(e.vx, e.vy);
        const target = 90;
        if (sp > target) {
          const ns = Math.max(target, sp - 260 * dt);
          e.vx *= ns / sp;
          e.vy *= ns / sp;
        }
      }
    },
    onDamage(e, w, s) {
      E.splitter.spawnKids(e, w, s, 1);
    },
    onDeath(e, w, s) {
      E.splitter.spawnKids(e, w, s, e.tier - 1);
    },
    spawnKids(e, w, s, tier) {
      let nx = 0;
      let ny = 1;
      if (s) {
        const sp = Math.hypot(s.vx, s.vy) || 1;
        nx = -s.vy / sp;
        ny = s.vx / sp;
      }
      for (const sign of [-1, 1]) {
        const kid = w.spawnEnemy({
          t: tier >= 1 ? 'splitter' : 'mini',
          tier,
          x: SQ.clamp(e.x + nx * sign * e.r * 0.8, 30, SQ.W - 30),
          y: SQ.clamp(e.y + ny * sign * e.r * 0.8, 30, SQ.H - 30),
          vx: nx * sign * 260,
          vy: ny * sign * 260,
          drift: true,
          spawnT: 0.25,
          minionOf: e.minionOf,
          required: e.required,
        });
        if (s) s.hits.set(kid.id, 0.35);
      }
    },
    draw(e, w, ctx, pal) {
      const c = tint(e, e.armor ? pal.enemy2 : pal.enemy);
      D.diamond(ctx, e.x, e.y, e.r * 1.25, e.a, c);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.a);
      ctx.strokeStyle = SQ.rgba(pal.bg, 0.8);
      ctx.lineWidth = 3;
      ctx.beginPath();
      const k = e.r * 0.8;
      ctx.moveTo(-k, 0);
      ctx.lineTo(k, 0);
      if (e.tier > 1) {
        ctx.moveTo(0, -k);
        ctx.lineTo(0, k);
      }
      ctx.stroke();
      ctx.restore();
      if (e.armor) D.square(ctx, e.x, e.y, e.r * 2.1, e.a, null, pal.enemy, 4);
      if (e.maxHp > 1) hpPips(e, ctx, pal);
    },
  };

  E.phantom = {
    defaults: () => ({ r: 22, on: 1.6, off: 1.3, phase: 0 }),
    update(e, w) {
      const per = e.on + e.off;
      const x = (((w.t + e.phase * per) % per) + per) % per;
      e.ghost = x < e.off;
      e.solid = !e.ghost;
      e.warn = e.ghost && x > e.off - 0.45;
      e.a = w.t * 0.8;
    },
    draw(e, w, ctx, pal) {
      let alpha = e.ghost ? 0.22 : 1;
      if (e.warn) alpha = Math.sin(w.t * 50) > 0 ? 0.7 : 0.25;
      ctx.globalAlpha = alpha;
      D.poly(ctx, e.x, e.y, e.r * 1.2, 5, e.a, tint(e, pal.enemy));
      ctx.globalAlpha = 1;
      if (e.ghost) D.ring(ctx, e.x, e.y, e.r * 1.2, SQ.rgba(pal.enemy, 0.6), 2, [4, 6]);
    },
  };

  E.dasher = {
    defaults: () => ({ r: 20, rest: 1.1, aimTime: 0.75, dashSpeed: 800, dashTime: 0.6 }),
    init(e) {
      e.mode = 'rest';
      e.timer = e.delay != null ? e.delay : 0.8 + Math.random() * 0.6;
      e.aimA = e.face != null ? SQ.rad(e.face) : Math.PI;
    },
    update(e, w, dt) {
      const p = w.player;
      const k = w.K.enemySpeed;
      e.timer -= dt * k;
      if (e.mode === 'rest') {
        const f = Math.exp(-4 * dt);
        e.vx *= f;
        e.vy *= f;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        w.enemyWalls(e, false);
        if (p.alive) e.aimA = SQ.turnToward(e.aimA, SQ.angleTo(e.x, e.y, p.x, p.y), 4 * dt);
        if (e.timer <= 0 && p.alive) {
          e.mode = 'aim';
          e.timer = e.aimTime;
        }
      } else if (e.mode === 'aim') {
        if (e.timer > 0.15 && p.alive) e.aimA = SQ.turnToward(e.aimA, SQ.angleTo(e.x, e.y, p.x, p.y), 6 * dt);
        if (e.timer <= 0) {
          e.mode = 'dash';
          e.timer = e.dashTime;
        }
      } else {
        e.vx = Math.cos(e.aimA) * e.dashSpeed * k;
        e.vy = Math.sin(e.aimA) * e.dashSpeed * k;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const hit = w.enemyWalls(e, false);
        if (e.timer <= 0 || hit) {
          e.mode = 'rest';
          e.timer = e.rest;
          if (hit) w.ring(e.x, e.y, 30, w.pal.enemy, 0.25);
        }
      }
    },
    draw(e, w, ctx, pal) {
      if (e.mode === 'aim') {
        const prog = 1 - e.timer / e.aimTime;
        ctx.strokeStyle = SQ.rgba(pal.enemy, 0.15 + prog * 0.5);
        ctx.lineWidth = 2 + prog * 3;
        ctx.setLineDash([10, 10]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.aimA) * 420, e.y + Math.sin(e.aimA) * 420);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (e.mode === 'dash') D.tail(ctx, e.x, e.y, e.aimA, e.r * 0.8, 120, pal.enemy2);
      D.kite(ctx, e.x, e.y, e.r * 1.5, e.aimA, tint(e, pal.enemy));
    },
  };

  // ------------------------------------------------------------- bosses
  E.monolith = {
    defaults: () => ({ r: 44, hp: 4, boss: true, name: 'MONOLITH', spinRate: 32, invTime: 1 }),
    init(e) {
      e.maxHp = e.hp;
      e.fa = SQ.rad(e.face != null ? e.face : 180);
      makeShields(e, [90, 180, 270], 150, 66, 20);
      placeShields(e, 0);
    },
    onHit: bossHit,
    onDamage(e) {
      e.spinRate = -Math.sign(e.spinRate) * (Math.abs(e.spinRate) + 16);
    },
    update(e, w, dt) {
      const om = SQ.rad(e.spinRate) * w.K.enemySpeed;
      e.fa += om * dt;
      placeShields(e, om);
    },
    draw(e, w, ctx, pal) {
      D.square(ctx, e.x, e.y, e.r * 1.75, e.fa, tint(e, pal.enemy));
      drawShields(e, ctx, pal);
      hpPips(e, ctx, pal);
    },
  };

  E.hive = {
    defaults: () => ({ r: 54, hp: 5, boss: true, name: 'HIVE', rate: 2.6, maxMinions: 4, speed: 70, invTime: 0.9 }),
    init(e) {
      e.maxHp = e.hp;
      e.cool = 1.5;
    },
    onHit: bossHit,
    update(e, w, dt) {
      e.a = (e.a || 0) + dt * 0.3;
      e.cool -= dt * w.K.enemySpeed;
      const minions = w.enemies.filter((o) => o.alive && o.minionOf === e.id).length;
      if (e.cool <= 0 && w.state === 'play') {
        e.cool = e.rate * (0.55 + (0.45 * e.hp) / e.maxHp);
        if (minions < e.maxMinions) {
          const a = Math.random() * Math.PI * 2;
          w.spawnEnemy({
            t: 'chaser',
            x: SQ.clamp(e.x + Math.cos(a) * (e.r + 26), 30, SQ.W - 30),
            y: SQ.clamp(e.y + Math.sin(a) * (e.r + 26), 30, SQ.H - 30),
            speed: 150,
            required: false,
            minionOf: e.id,
            spawnT: 0.6,
          });
        }
      }
    },
    draw(e, w, ctx, pal) {
      D.poly(ctx, e.x, e.y, e.r * 1.1, 6, e.a, tint(e, pal.enemy));
      const pulse = 0.5 + 0.5 * Math.sin(w.t * 4);
      D.poly(ctx, e.x, e.y, e.r * (0.45 + pulse * 0.1), 6, -e.a * 2, pal.enemy2);
      hpPips(e, ctx, pal);
    },
  };

  E.lattice = {
    defaults: () => ({ r: 40, hp: 3, boss: true, name: 'LATTICE', count: 4, orad: 175, ospeed: 0.42, regen: 5, invTime: 1 }),
    init(e, w) {
      e.maxHp = e.hp;
      e.exposed = 0;
      e.respawnIn = 0;
      e.fireCool = 3;
      E.lattice.spawnNodes(e, w);
    },
    spawnNodes(e, w) {
      for (let i = 0; i < e.count; i++) {
        w.spawnEnemy({
          t: 'node',
          x: e.x,
          y: e.y,
          r: 21,
          required: false,
          minionOf: e.id,
          spawnT: 0.5,
          orbit: { around: e, rad: e.orad + (i % 2) * 40, speed: e.ospeed * (i % 2 ? -1 : 1), phase: (i * 360) / e.count },
        });
      }
    },
    nodesAlive: (e, w) => w.enemies.some((o) => o.alive && o.minionOf === e.id),
    onHit(e, w, s, speed) {
      if (E.lattice.nodesAlive(e, w)) return 'bounce';
      return bossHit(e, w, s, speed);
    },
    onDamage(e) {
      e.ospeed += 0.22;
      e.respawnIn = 1.2;
    },
    update(e, w, dt) {
      e.a = (e.a || 0) + dt * 0.5;
      if (e.respawnIn > 0) {
        e.respawnIn -= dt;
        if (e.respawnIn <= 0 && e.alive) E.lattice.spawnNodes(e, w);
        return;
      }
      if (!E.lattice.nodesAlive(e, w)) {
        e.exposed += dt;
        if (e.exposed > e.regen) {
          e.exposed = 0;
          E.lattice.spawnNodes(e, w);
        }
      } else e.exposed = 0;
      if (e.hp < e.maxHp) {
        e.fireCool -= dt * w.K.enemySpeed;
        if (e.fireCool <= 0 && w.state === 'play') {
          e.fireCool = 3.2;
          for (let i = 0; i < 8; i++) w.fireBullet(e.x, e.y, e.a + (i * Math.PI) / 4, 190 * w.K.enemySpeed);
          SQ.audio.play('shoot');
        }
      }
    },
    draw(e, w, ctx, pal) {
      const prot = E.lattice.nodesAlive(e, w);
      for (const n of w.enemies) if (n.alive && n.minionOf === e.id && n.spawnT <= 0) D.dots(ctx, e.x, e.y, n.x, n.y, 28, 5, pal.enemy);
      D.diamond(ctx, e.x, e.y, e.r * 1.3, e.a, tint(e, prot ? pal.enemy2 : pal.enemy));
      if (prot) D.ring(ctx, e.x, e.y, e.r + 12, SQ.rgba(pal.enemy, 0.5), 3, [6, 8], w.t * 20);
      else D.arc(ctx, e.x, e.y, e.r + 16, 1 - e.exposed / e.regen, SQ.rgba(pal.hazard, 0.8), 4);
      hpPips(e, ctx, pal);
    },
  };

  E.engine = {
    defaults: () => ({ r: 46, hp: 4, boss: true, name: 'ENGINE', speed: 80, invTime: 1 }),
    init(e) {
      e.maxHp = e.hp;
      e.fa = 0;
      e.cool = 2;
      e.pattern = 0;
      e.spiral = 0;
      makeShields(e, [0, 180], 130, 68, 18);
      placeShields(e, 0);
    },
    onHit: bossHit,
    onDamage(e) {
      e.pattern++;
    },
    update(e, w, dt) {
      const om = SQ.rad(45 + (e.maxHp - e.hp) * 12) * w.K.enemySpeed;
      e.fa += om * dt;
      placeShields(e, om);
      e.cool -= dt * w.K.enemySpeed;
      if (w.state !== 'play') return;
      const p = w.player;
      const kind = e.pattern % 3;
      if (kind === 2) {
        // Spiral stream.
        e.spiral -= dt;
        if (e.spiral <= 0) {
          e.spiral = 0.12;
          w.fireBullet(e.x, e.y, w.t * 2.2, 200 * w.K.enemySpeed);
          w.fireBullet(e.x, e.y, w.t * 2.2 + Math.PI, 200 * w.K.enemySpeed);
        }
      }
      if (e.cool <= 0) {
        e.cool = 2.4 - (e.maxHp - e.hp) * 0.2;
        if (kind === 0) {
          const n = 10;
          for (let i = 0; i < n; i++) w.fireBullet(e.x, e.y, e.fa + (i * Math.PI * 2) / n, 190 * w.K.enemySpeed);
        } else if (kind === 1 && p.alive) {
          const a = SQ.angleTo(e.x, e.y, p.x, p.y);
          for (let i = -1; i <= 1; i++) w.fireBullet(e.x, e.y, a + i * 0.2, 260 * w.K.enemySpeed);
        }
        SQ.audio.play('shoot');
      }
    },
    draw(e, w, ctx, pal) {
      D.gear(ctx, e.x, e.y, e.r * 1.05, 10, -e.fa * 0.5, tint(e, pal.enemy));
      D.circle(ctx, e.x, e.y, e.r * 0.45, pal.enemy2);
      drawShields(e, ctx, pal);
      hpPips(e, ctx, pal);
    },
  };

  E.prism = {
    defaults: () => ({ r: 50, hp: 3, boss: true, name: 'PRISM', tier: 3, armor: true, speed: 60, invTime: 0.8 }),
    init(e) {
      e.maxHp = e.hp;
    },
    onHit(e, w, s, speed) {
      if (e.inv > 0 || speed < w.K.armor) return 'bounce';
      return 'damage';
    },
    // Each strike sheds two minis; breaking it releases two splitters.
    onDamage(e, w, s) {
      E.splitter.spawnKids(Object.assign({}, e, { minionOf: undefined, required: true }), w, s, 0);
    },
    onDeath(e, w, s) {
      E.splitter.spawnKids(Object.assign({}, e, { minionOf: undefined, required: true }), w, s, 1);
    },
    update(e, w, dt) {
      e.a = (e.a || 0) + dt * 0.5;
    },
    draw(e, w, ctx, pal) {
      D.triangle(ctx, e.x, e.y, e.r * 1.35, e.a, tint(e, pal.enemy2));
      D.triangle(ctx, e.x, e.y, e.r * 0.8, -e.a * 1.5 + Math.PI, tint(e, pal.enemy));
      D.ring(ctx, e.x, e.y, e.r + 8, SQ.rgba(pal.enemy, 0.6), 3, [3, 7], w.t * 30);
      hpPips(e, ctx, pal);
    },
  };

  // The finale: another circle, with its own square, playing by your rules.
  E.mirror = {
    defaults: () => ({ r: 24, hp: 3, boss: true, name: 'THE CIRCLE', speed: 250, invTime: 1.3, deathMsg: 'touched the other circle' }),
    init(e, w) {
      e.maxHp = e.hp;
      const s = w.makeSquare(e.sx != null ? e.sx : e.x - 70, e.sy != null ? e.sy : e.y);
      s.own = 'foe';
      s.target = e;
      s.ownerEnemy = e;
      s.extraTargets = [e];
      s.recallAcc = w.K.recallAcc * 0.85;
      s.recallMax = w.K.recallMax * 0.85;
      w.foeSquares.push(s);
      e.sq = s;
      e.think = e.delay != null ? e.delay : 2.5;
      e.strafe = 1;
      e.onSquareHit = () => {
        if (e.inv <= 0 && e.alive) w.damageEnemy(e, s);
      };
    },
    onHit: bossHit,
    onDamage(e) {
      e.sq.recall = false;
      e.think = 0.8;
      e.strafe *= -1;
    },
    onDeath(e, w) {
      w.burst(e.sq.x, e.sq.y, w.pal.enemy, 20, 300);
      w.foeSquares = w.foeSquares.filter((s) => s !== e.sq);
    },
    launch(e, w) {
      const K = w.K;
      const s = e.sq;
      const d = SQ.dist(e.x, e.y, s.x, s.y) || 1;
      const t = SQ.clamp((K.range - d) / (K.range - (K.pr + K.sr)), 0, 1);
      const sp = (K.vMin + (K.vMax - K.vMin) * t) * 0.85;
      s.vx = ((s.x - e.x) / d) * sp;
      s.vy = ((s.y - e.y) / d) * sp;
      s.recall = false;
      SQ.audio.play('launch', t * 0.6);
      w.ring(s.x, s.y, 20, w.pal.enemy, 0.25);
    },
    update(e, w, dt) {
      const K = w.K;
      const s = e.sq;
      const p = w.player;
      const range = K.range * 0.95;
      const dSq = SQ.dist(e.x, e.y, s.x, s.y);
      const sSp = Math.hypot(s.vx, s.vy);
      const toward = s.vx * (e.x - s.x) + s.vy * (e.y - s.y) > 0;
      e.think -= dt;
      if (w.state === 'play') {
        if (dSq <= range && sSp >= K.lethal * 0.8 && toward) E.mirror.launch(e, w);
        else if (dSq <= range && sSp < 400 && p.alive && e.think <= 0) {
          const a1 = SQ.angleTo(e.x, e.y, s.x, s.y);
          const a2 = SQ.angleTo(s.x, s.y, p.x, p.y);
          if (Math.abs(SQ.wrapAngle(a1 - a2)) < 0.28) {
            E.mirror.launch(e, w);
            e.think = 0.5;
          }
        }
        if (!s.recall && sSp < 120 && dSq > 520 && e.think <= 0 && Math.random() < dt * 0.6) {
          s.recall = true;
          e.think = 0.4;
        }
      }
      // Choose where to go.
      let tx = e.x;
      let ty = e.y;
      if (!s.recall && sSp < 320 && p.alive) {
        const d = SQ.dist(s.x, s.y, p.x, p.y) || 1;
        const behind = K.pr + K.sr + 34;
        tx = s.x - ((p.x - s.x) / d) * behind;
        ty = s.y - ((p.y - s.y) / d) * behind;
        // Don't walk through the square: sidestep if it's in the way.
        const dd = SQ.segDist(s.x, s.y, e.x, e.y, tx, ty);
        if (dd < K.pr + K.sr + 10 && dSq > behind) {
          const a = SQ.angleTo(s.x, s.y, e.x, e.y) + e.strafe * 1.2;
          tx = s.x + Math.cos(a) * behind * 1.4;
          ty = s.y + Math.sin(a) * behind * 1.4;
        }
      } else if (p.alive) {
        const a = SQ.angleTo(p.x, p.y, e.x, e.y) + e.strafe * 0.6;
        tx = p.x + Math.cos(a) * 380;
        ty = p.y + Math.sin(a) * 380;
      }
      let dx = tx - e.x;
      let dy = ty - e.y;
      let d = Math.hypot(dx, dy);
      let vx = d > 4 ? (dx / d) * e.speed : 0;
      let vy = d > 4 ? (dy / d) * e.speed : 0;
      // Dodge any dangerous square heading this way.
      for (const q of w.squares.concat(e.sq)) {
        const qs = Math.hypot(q.vx, q.vy);
        if (qs < K.lethal) continue;
        const qd = SQ.dist(q.x, q.y, e.x, e.y);
        if (qd > 320) continue;
        if (q === e.sq && qd <= range) continue;
        const head = (q.vx * (e.x - q.x) + q.vy * (e.y - q.y)) / (qs * qd || 1);
        if (head > 0.6) {
          const side = Math.sign(-q.vy * (e.x - q.x) + q.vx * (e.y - q.y)) || 1;
          vx = (-q.vy / qs) * side * e.speed * 1.2;
          vy = (q.vx / qs) * side * e.speed * 1.2;
        }
      }
      const k = Math.min(1, dt * 10);
      const sp = w.K.enemySpeed;
      e.vx += (vx * sp - e.vx) * k;
      e.vy += (vy * sp - e.vy) * k;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      w.enemyWalls(e, false);
      // Keep its own slow square from overlapping it.
      const c = SQ.circleCircle(s.x, s.y, s.r, e.x, e.y, e.r);
      if (c && sSp < K.lethal) {
        s.x = SQ.clamp(s.x + c.nx * c.depth, s.r, SQ.W - s.r);
        s.y = SQ.clamp(s.y + c.ny * c.depth, s.r, SQ.H - s.r);
      }
    },
    draw(e, w, ctx, pal) {
      const s = e.sq;
      const near = SQ.dist(e.x, e.y, s.x, s.y) <= w.K.range;
      D.circle(ctx, e.x, e.y, e.r, tint(e, near ? SQ.mix(pal.enemy, '#ffffff', 0.25) : pal.enemy));
      if (e.inv > 0 && Math.sin(w.t * 40) > 0) D.ring(ctx, e.x, e.y, e.r + 6, SQ.rgba(pal.enemy, 0.7), 2);
      hpPips(e, ctx, pal);
    },
  };
})();
