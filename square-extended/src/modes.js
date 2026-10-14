// Challenges (single levels with a twist on the rules, plus whole-chapter
// no-death runs) and Arenas (endless waves with a score).
'use strict';
(() => {
  const { R, C, Dm, B, e, spin, well, laser, portal, wind } = SQ.build;

  const CH = (id, name, desc, def) => Object.assign({ id, name, desc, kind: 'level' }, def);

  SQ.CHALLENGES = [
    CH('one-shot', 'One Shot', 'Clear the arena with a single launch. Find the line.', {
      palette: 'night', mods: { maxLaunches: 1 },
      p: [130, 770], s: [200, 700],
      walls: [Dm(1300, 160, 70), R(1450, 700, 30, 260)],
      enemies: [e('dummy', 450, 450), e('dummy', 700, 200), e('dummy', 1100, 232), e('dummy', 1300, 432)],
    }),
    CH('no-recall', 'Out of Reach', 'Recall is disabled. Walk to the square every time.', {
      palette: 'moss', mods: { noRecall: true },
      p: [800, 450], s: [870, 450],
      walls: [R(400, 450, 30, 500), R(1200, 450, 30, 500)],
      enemies: [e('dummy', 150, 150), e('dummy', 150, 750), e('dummy', 1450, 150), e('dummy', 1450, 750), e('chaser', 800, 90, { speed: 100 })],
    }),
    CH('ricochet', 'Ricochet', 'The square only breaks things after it has bounced.', {
      palette: 'night', mods: { ricochet: true },
      p: [200, 450], s: [270, 450],
      enemies: [e('dummy', 800, 450), e('dummy', 1200, 250), e('dummy', 1200, 650), e('dummy', 500, 150)],
    }),
    CH('glass', 'Glass', 'The square shatters on its third bounce after a launch.', {
      palette: 'tide', mods: { maxBounces: 2 },
      p: [200, 450], s: [270, 450],
      walls: [R(800, 450, 30, 300)],
      enemies: [e('dummy', 1300, 450), e('dummy', 800, 120), e('dummy', 800, 780), e('dummy', 1450, 120)],
    }),
    CH('blackout', 'Blackout', 'Lights out. Something is hunting.', {
      palette: 'dusk', mods: { darkness: true },
      p: [200, 450], s: [270, 450],
      walls: [C(800, 450, 70)],
      enemies: [e('chaser', 1450, 150, { speed: 110 }), e('chaser', 1450, 750, { speed: 110 }), e('dummy', 1300, 450), e('dummy', 800, 120), e('dummy', 800, 780)],
    }),
    CH('hyper', 'Frictionless', 'The square never slows down.', {
      palette: 'ember', mods: { hyper: true },
      p: [200, 450], s: [270, 450],
      walls: [B(600, 300), B(1000, 600), B(1000, 300), B(600, 600)],
      enemies: [e('dummy', 800, 450), e('dummy', 1450, 150), e('dummy', 1450, 750), e('dummy', 800, 100), e('dummy', 800, 800)],
    }),
    CH('rush', 'Rush', 'Ten targets, twenty-five seconds.', {
      palette: 'sand', mods: { timeLimit: 25 },
      p: [800, 450], s: [870, 450],
      enemies: SQ.build.ring(10, 800, 450, 340, (x, y) => e('dummy', x, y * 0.9 + 45)),
    }),
    CH('twins', 'Double Trouble', 'Two squares, one recall button.', {
      palette: 'rust', mods: { twin: true },
      p: [800, 450], squares: [[730, 450], [870, 450]],
      enemies: [e('armored', 200, 150), e('armored', 1400, 750), e('phantom', 200, 750), e('phantom', 1400, 150, { phase: 0.5 }), e('dasher', 1450, 450, { delay: 2 })],
    }),
    CH('three-strikes', 'Three Strikes', 'Six targets, three launches.', {
      palette: 'moss', mods: { maxLaunches: 3 },
      p: [200, 450], s: [270, 450],
      walls: [Dm(800, 300, 70), Dm(800, 600, 70)],
      enemies: [e('dummy', 500, 150), e('dummy', 1100, 150), e('dummy', 500, 750), e('dummy', 1100, 750), e('dummy', 1000, 450), e('dummy', 1400, 450)],
    }),
    CH('bullet-hell', 'Bullet Hell', 'The square is your only umbrella.', {
      palette: 'night',
      p: [800, 450], s: [870, 450],
      enemies: [
        e('turret', 120, 120, { aim: 'spin', spinRate: 60, rate: 0.35, delay: 1.5 }),
        e('turret', 1480, 780, { aim: 'spin', spinRate: 60, rate: 0.35, delay: 1.5 }),
        e('turret', 1480, 120, { rate: 1.3, burst: 3, spread: 18, delay: 2 }),
        e('turret', 120, 780, { rate: 1.3, burst: 3, spread: 18, delay: 2.6 }),
      ],
    }),
    CH('swarm', 'Swarm', 'Fourteen of them, arriving one by one. One of you.', {
      palette: 'dusk',
      p: [800, 450], s: [870, 450],
      enemies: SQ.build.ring(14, 800, 450, 560, (x, y, i) => e('mini', SQ.clamp(x, 60, 1540), SQ.clamp(y, 60, 840), { speed: 130, spawnT: 0.8 + i * 1.1 })),
    }),
    CH('gravity-golf', 'Gravity Golf', 'One launch. The target hides behind the well.', {
      palette: 'tide', mods: { maxLaunches: 1 },
      p: [150, 750], s: [220, 750],
      hazards: [well(800, 450, 95, 420, 1300)],
      enemies: [e('dummy', 1380, 150)],
    }),
    CH('spinner-garden', 'Spinner Garden', 'Walk the garden. Mind the arms.', {
      palette: 'moss',
      p: [100, 450], s: [170, 450],
      hazards: [0, 1, 2, 3].flatMap((i) => [0, 1, 2].map((j) => spin(330 + i * 300, 180 + j * 270, 75, (i + j) % 2 ? 1.5 : -1.5, { arms: 2, phase: i * 40 + j * 20 }))),
      enemies: [e('dummy', 480, 315), e('dummy', 780, 585), e('dummy', 1080, 315), e('dummy', 1380, 585), e('dummy', 1500, 120)],
    }),
    CH('clock-tower', 'Clock Tower', 'Lasers sweep on a schedule. So do you.', {
      palette: 'ember',
      p: [100, 100], s: [170, 100],
      hazards: [
        laser(0, 300, 1600, 300, { on: 1, off: 2 }), laser(0, 600, 1600, 600, { on: 1, off: 2, phase: 0.5 }),
        laser(533, 0, 533, 900, { on: 1, off: 2.2, phase: 0.25 }), laser(1066, 0, 1066, 900, { on: 1, off: 2.2, phase: 0.75 }),
      ],
      enemies: [e('dummy', 800, 450), e('dummy', 1350, 150), e('dummy', 1350, 750), e('dummy', 270, 750), e('chaser', 1500, 450, { speed: 90 })],
    }),
  ];

  // Whole-chapter runs: any death sends you back to the chapter's first level.
  SQ.CHAPTERS.forEach((ch, i) =>
    SQ.CHALLENGES.push({
      id: 'rush-' + ch.id,
      name: 'Chapter ' + (i + 1) + ' Deathless',
      desc: 'All of ' + ch.name + ' without dying. Unlocked by finishing the chapter.',
      kind: 'chapter',
      chapter: i,
      palette: ch.palette,
    })
  );

  // ------------------------------------------------------------- arenas
  SQ.ARENAS = [
    { id: 'open', name: 'Open Floor', palette: 'sand', desc: 'Nothing to hide behind.', walls: [], hazards: [] },
    {
      id: 'pillars', name: 'Four Pillars', palette: 'dusk', desc: 'Cover, and corners to get caught in.',
      walls: [C(500, 270, 55), C(1100, 270, 55), C(500, 630, 55), C(1100, 630, 55)], hazards: [],
    },
    { id: 'well', name: 'Event Horizon', palette: 'tide', desc: 'A well in the middle of everything.', walls: [], hazards: [well(800, 450, 70, 380, 1500)] },
    {
      id: 'machine', name: 'Pinball Machine', palette: 'ember', desc: 'Bumpers and a pair of portals.',
      walls: [B(400, 225), B(1200, 225), B(400, 675), B(1200, 675), B(800, 450, 50)],
      hazards: [portal(150, 120, 1450, 780), portal(1450, 120, 150, 780, { color: 'enemy2' })],
    },
    {
      id: 'garden', name: 'Spinner Garden', palette: 'moss', desc: 'Lethal blossoms everywhere.',
      walls: [], hazards: [spin(450, 250, 80, 1.3), spin(1150, 250, 80, -1.3), spin(450, 650, 80, -1.3), spin(1150, 650, 80, 1.3), spin(800, 450, 110, 0.8, { arms: 3 })],
    },
    { id: 'void', name: 'The Void', palette: 'night', desc: 'Endless waves, in the dark.', mods: { darkness: true }, walls: [C(800, 450, 60)], hazards: [] },
  ];

  // Enemy menu for waves: cost and the first wave each can appear in.
  const POOL = [
    { t: 'dummy', cost: 1, from: 1 },
    { t: 'chaser', cost: 2, from: 1, o: () => ({ speed: SQ.rand(100, 150) }) },
    { t: 'drifter', cost: 2, from: 2, o: () => ({ dir: SQ.rand(0, 360), speed: SQ.rand(90, 150) }) },
    { t: 'shield', cost: 3, from: 3, o: () => ({ mode: SQ.pick(['track', 'spin']), spinRate: SQ.pick([-80, 80]) }) },
    { t: 'turret', cost: 3, from: 4, o: () => ({ rate: SQ.rand(2, 2.8) }) },
    { t: 'phantom', cost: 2, from: 5, o: () => ({ phase: Math.random() }) },
    { t: 'dasher', cost: 3, from: 6 },
    { t: 'warden', cost: 3, from: 7, o: () => ({ field: SQ.rand(120, 170) }) },
    { t: 'armored', cost: 3, from: 8 },
    { t: 'splitter', cost: 4, from: 9, o: () => ({ tier: 2 }) },
    { t: 'mini', cost: 1, from: 10, o: () => ({ speed: 170 }) },
  ];
  const BOSSES = [
    { t: 'monolith', o: { hp: 2 } },
    { t: 'hive', o: { hp: 3, maxMinions: 3 } },
    { t: 'lattice', o: { hp: 1, count: 4 } },
    { t: 'engine', o: { hp: 2 } },
  ];

  SQ.makeWaveSpawner = () => (w) => {
    const sp = {
      wave: 0, timer: 1.2, between: true, score: 0, multi: 0,
      findSpot(r) {
        for (let tries = 0; tries < 80; tries++) {
          const x = SQ.rand(80, SQ.W - 80);
          const y = SQ.rand(80, SQ.H - 80);
          if (SQ.dist(x, y, w.player.x, w.player.y) < 380 - tries * 2) continue;
          if (w.solids().some((s) => w.collide(x, y, r + 30, s))) continue;
          if (w.hazards.some((h) => (h.t === 'spinner' && SQ.dist(x, y, h.x, h.y) < (h.len || 60) + r + 20) || (h.t === 'well' && SQ.dist(x, y, h.x, h.y) < (h.core || 50) + r + 30))) continue;
          if (w.enemies.some((o) => o.alive && SQ.dist(x, y, o.x, o.y) < o.r + r + 30)) continue;
          return [x, y];
        }
        return [SQ.W - 120, SQ.H / 2];
      },
      startWave() {
        this.wave++;
        this.between = false;
        const n = this.wave;
        if (n % 5 === 0) {
          const b = BOSSES[(n / 5 - 1) % BOSSES.length];
          const [x, y] = this.findSpot(70);
          const o = Object.assign({}, b.o);
          o.hp = (o.hp || 2) + Math.floor(n / 20);
          w.spawnEnemy(Object.assign({ t: b.t, x, y, spawnT: 1.2 }, o));
        }
        let budget = 2 + Math.floor(n * 1.7);
        const avail = POOL.filter((p) => p.from <= n);
        let guard = 0;
        while (budget > 0 && guard++ < 60) {
          const choices = avail.filter((p) => p.cost <= budget);
          if (!choices.length) break;
          // Lean towards newer, tougher enemies as waves climb.
          const pick = choices[Math.floor(Math.pow(Math.random(), 0.7) * choices.length)];
          budget -= pick.cost;
          const r = 30;
          const [x, y] = this.findSpot(r);
          w.spawnEnemy(Object.assign({ t: pick.t, x, y, spawnT: 0.9 + Math.random() * 0.4 }, pick.o ? pick.o() : {}));
        }
        w.toast('WAVE ' + n, SQ.W / 2, 90);
      },
      update(dt) {
        if (w.state !== 'play') return;
        if (this.between) {
          this.timer -= dt;
          if (this.timer <= 0) this.startWave();
        } else if (!w.enemies.some((o) => o.alive && o.required)) {
          this.between = true;
          this.timer = 1.6;
          this.score += this.wave * 25;
          w.toast('+' + this.wave * 25, w.player.x, w.player.y - 50);
        }
      },
      onKill(e, s) {
        if (!e.required && !e.boss) return;
        const chain = s ? s.chain : 1;
        this.score += 10 * chain + (e.boss ? 100 : 0);
      },
      done: () => false,
    };
    return sp;
  };
})();
