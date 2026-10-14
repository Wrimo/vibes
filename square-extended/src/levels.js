// Campaign: six chapters of ten levels. Coordinates are in the 1600x900
// arena. Each chapter introduces new pieces and ends with a boss.
//
// Level fields:
//   name, p: player start, s: square start, walls, enemies, hazards,
//   hint (shown at the bottom; {launch}/{recall} expand to the current
//   controls), mods (challenge rules).
'use strict';
(() => {
  // Builders keep the level data compact.
  const R = (x, y, w, h, a = 0, o = {}) => Object.assign({ k: 'r', x, y, w, h, a }, o);
  const C = (x, y, r, o = {}) => Object.assign({ k: 'c', x, y, r }, o);
  const Dm = (x, y, s, a = 0, o) => R(x, y, s, s, 45 + a, o);
  const B = (x, y, r = 40, boost = 1.25) => C(x, y, r, { bumper: boost });
  const e = (t, x, y, o = {}) => Object.assign({ t, x, y }, o);
  const spin = (x, y, len = 70, speed = 1.4, o = {}) => Object.assign({ t: 'spinner', x, y, len, speed }, o);
  const well = (x, y, core = 60, R = 340, str = 1500) => ({ t: 'well', x, y, core, R, str });
  const laser = (x1, y1, x2, y2, o = {}) => Object.assign({ t: 'laser', x1, y1, x2, y2 }, o);
  const portal = (ax, ay, bx, by, o = {}) => Object.assign({ t: 'portal', ax, ay, bx, by }, o);
  const wind = (x, y, w, h, fx, fy) => ({ t: 'wind', x, y, w, h, fx, fy });
  const sw = (x, y, door, o = {}) => Object.assign({ t: 'switch', x, y, door }, o);
  const orbit = (cx, cy, rad, speed, phase) => ({ orbit: { x: cx, y: cy, rad, speed, phase } });
  const ring = (n, cx, cy, rad, fn) => Array.from({ length: n }, (_, i) => fn(cx + Math.cos((i / n) * Math.PI * 2) * rad, cy + Math.sin((i / n) * Math.PI * 2) * rad, i));
  SQ.build = { R, C, Dm, B, e, spin, well, laser, portal, wind, sw, orbit, ring };

  const L = (name, def) => Object.assign({ name }, def);

  const CH1 = {
    id: 'c1',
    name: 'LAUNCH',
    palette: 'sand',
    blurb: 'Your only weapon is as deadly to you as to them.',
    levels: [
      L('First Contact', {
        p: [300, 450], s: [380, 450],
        enemies: [e('dummy', 1250, 450)],
        hint: 'Move next to the square and press {launch}. The closer you are, the harder it flies.',
      }),
      L('Comeback', {
        p: [800, 760], s: [800, 140],
        enemies: [e('dummy', 800, 450), e('dummy', 330, 250), e('dummy', 1270, 250)],
        hint: 'Press {recall} to call the square back. It speeds up until it reaches you, so launch it away before it hits you.',
      }),
      L('Bank Shot', {
        p: [300, 450], s: [370, 450],
        walls: [R(800, 450, 40, 520)],
        enemies: [e('dummy', 1300, 250), e('dummy', 1300, 650), e('dummy', 1050, 450)],
        hint: 'The square bounces off every wall. A slow square is harmless and can be nudged.',
      }),
      L('Diamonds', {
        p: [800, 120], s: [800, 190],
        walls: [Dm(420, 450, 200), Dm(800, 450, 200), Dm(1180, 450, 200)],
        enemies: [e('dummy', 610, 780), e('dummy', 990, 780), e('dummy', 1480, 140), e('dummy', 120, 780)],
      }),
      L('Shielded', {
        p: [300, 450], s: [370, 450],
        enemies: [e('shield', 1150, 450, { face: 180 }), e('dummy', 1150, 150), e('dummy', 1150, 750)],
        hint: 'Shields block one side only. Come at them from another angle.',
      }),
      L('Behind You', {
        p: [300, 450], s: [370, 450],
        enemies: [e('shield', 1000, 450, { mode: 'track', turn: 70 })],
        hint: 'This shield always faces you. Launch past it, then {recall}: the square comes home through its back.',
      }),
      L('Corridor', {
        p: [800, 450], s: [870, 450],
        walls: [R(800, 300, 1100, 30), R(800, 600, 1100, 30)],
        enemies: [e('dummy', 800, 150), e('dummy', 800, 750), e('dummy', 120, 450), e('dummy', 1480, 450)],
      }),
      L('Turnstiles', {
        p: [150, 780], s: [220, 780],
        enemies: [
          e('shield', 500, 280, { mode: 'spin', spinRate: 70 }),
          e('shield', 1100, 280, { mode: 'spin', spinRate: -90 }),
          e('shield', 800, 640, { mode: 'spin', spinRate: 110, sides: [0, 180] }),
          e('dummy', 1460, 120),
        ],
      }),
      L('Pinball', {
        p: [120, 450], s: [190, 450],
        walls: [0, 1, 2, 3, 4, 5].flatMap((i) => [230, 450, 670].map((y) => Dm(350 + i * 190, y, 56))),
        enemies: [
          e('dummy', 445, 340), e('dummy', 825, 560), e('dummy', 1205, 340),
          e('dummy', 635, 120), e('dummy', 1015, 780), e('dummy', 1480, 560),
        ],
      }),
      L('Monolith', {
        boss: true,
        p: [250, 450], s: [330, 450],
        enemies: [e('monolith', 1050, 450, { face: 0 })],
        hint: 'Strike the open face. It turns faster each time.',
      }),
    ],
  };

  const CH2 = {
    id: 'c2',
    name: 'RECALL',
    palette: 'dusk',
    blurb: 'Things begin to hunt. Things begin to pull.',
    levels: [
      L('Pursuit', {
        p: [250, 450], s: [320, 450],
        enemies: [e('chaser', 1350, 450, { speed: 110 })],
        hint: 'Triangles hunt you. Keep moving, and let them come to the square.',
      }),
      L('Pack', {
        p: [200, 450], s: [270, 450],
        walls: [C(800, 450, 80)],
        enemies: [e('chaser', 1450, 120, { speed: 130 }), e('chaser', 1450, 780, { speed: 130 }), e('chaser', 1500, 450, { speed: 120 })],
      }),
      L('Gravity', {
        p: [200, 450], s: [270, 450],
        hazards: [well(800, 450, 110, 430, 1700)],
        enemies: [e('dummy', 1400, 450), e('dummy', 800, 90), e('dummy', 800, 810)],
        hint: 'Dark wells bend the square. Throw it wide and let it curve.',
      }),
      L('Arms of Light', {
        p: [150, 450], s: [220, 450],
        hazards: [spin(420, 250, 70, 1.6), spin(420, 650, 70, -1.6), spin(800, 450, 80, 1.2, { arms: 2 }), spin(1180, 250, 70, -1.9), spin(1180, 650, 70, 1.9)],
        enemies: [e('dummy', 800, 150), e('dummy', 800, 750), e('dummy', 1460, 450), e('dummy', 610, 450)],
        hint: 'Spinning arms cut you, not the square.',
      }),
      L('Crossroads', {
        p: [800, 450], s: [870, 450],
        walls: [R(800, 310, 560, 70), R(800, 590, 560, 70), R(800, 137, 70, 275), R(800, 762, 70, 275), C(430, 450, 34), C(1170, 450, 34)],
        hazards: [spin(560, 150, 60, 1.5), spin(1040, 150, 60, -1.5), spin(560, 750, 60, -1.5), spin(1040, 750, 60, 1.5)],
        enemies: [
          e('chaser', 200, 120, { speed: 100 }), e('dummy', 1400, 120),
          e('dummy', 200, 780), e('chaser', 1400, 780, { speed: 100 }),
        ],
      }),
      L('Satellites', {
        p: [150, 450], s: [220, 450],
        hazards: [well(800, 450, 70, 360, 1400)],
        enemies: [0, 90, 180, 270].map((ph) => e('dummy', 800, 450, orbit(800, 450, 240, 0.5, ph))),
      }),
      L('Hounds', {
        p: [150, 450], s: [220, 450],
        walls: [C(500, 250, 45), C(1100, 250, 45), C(500, 650, 45), C(1100, 650, 45), C(800, 450, 45)],
        enemies: [[1500, 100], [1500, 800], [1500, 450], [800, 90], [800, 810], [1250, 450]].map(([x, y]) => e('chaser', x, y, { speed: 135 })),
      }),
      L('Slingshot', {
        p: [250, 700], s: [320, 700],
        walls: [R(800, 200, 40, 400), R(800, 780, 40, 240)],
        hazards: [well(560, 300, 40, 260, 1700), well(1040, 600, 40, 260, 1700)],
        enemies: [e('dummy', 1300, 150), e('dummy', 1450, 760), e('dummy', 1250, 480)],
      }),
      L('Lanterns', {
        p: [200, 450], s: [270, 450],
        enemies: [
          e('shield', 1100, 250, { mode: 'track', turn: 60 }), e('shield', 1100, 650, { mode: 'track', turn: 60 }),
          e('chaser', 1500, 100, { speed: 115 }), e('chaser', 1500, 800, { speed: 115 }), e('chaser', 1500, 450, { speed: 105 }),
        ],
      }),
      L('Hive', {
        boss: true,
        p: [250, 450], s: [320, 450],
        enemies: [e('hive', 1150, 450, { path: [[1150, 230], [1150, 670]], speed: 55 })],
        hint: 'It never stops making more. Go for the source.',
      }),
    ],
  };

  const CH3 = {
    id: 'c3',
    name: 'AVOID',
    palette: 'tide',
    blurb: 'They protect each other. They shoot back.',
    levels: [
      L('Links', {
        p: [200, 450], s: [270, 450],
        enemies: [e('core', 1250, 450), e('node', 1060, 250), e('node', 1060, 650)],
        hint: 'A core cannot be hurt while any of its linked nodes live.',
      }),
      L('The Field', {
        p: [120, 450], s: [200, 450],
        enemies: [e('warden', 800, 450, { field: 240 })],
        hint: 'Fields drain the square\'s speed. Launch hard, from up close.',
      }),
      L('Sentries', {
        p: [200, 450], s: [270, 450],
        walls: [Dm(800, 300, 80), Dm(800, 600, 80)],
        enemies: [e('turret', 1300, 200, { rate: 2.1 }), e('turret', 1300, 700, { rate: 2.1, delay: 2 })],
        hint: 'Turrets shoot at you. A fast square eats bullets.',
      }),
      L('Constellation', {
        p: [150, 450], s: [220, 450],
        enemies: [e('core', 800, 450), ...SQ.build.ring(5, 800, 450, 190, (x, y) => e('node', x, y, { orbitCore: 190, ospeed: 0.7 }))],
      }),
      L('Crossfire', {
        p: [800, 190], s: [800, 260],
        walls: [Dm(800, 470, 150)],
        enemies: [[120, 120, 0], [1480, 120, 0.6], [120, 780, 1.2], [1480, 780, 1.8]].map(([x, y, d]) => e('turret', x, y, { rate: 2.6, delay: 1.2 + d })),
      }),
      L('Nested', {
        p: [200, 450], s: [270, 450],
        enemies: [e('core', 1100, 450), e('node', 1100, 200), e('node', 1100, 700), e('warden', 1320, 450, { field: 280 })],
      }),
      L('Bastion', {
        p: [200, 450], s: [270, 450],
        walls: [R(1220, 450, 30, 200), R(1220, 150, 30, 170), R(1220, 750, 30, 170)],
        enemies: [
          e('turret', 1380, 450, { rate: 1.8 }), e('turret', 1380, 150, { rate: 2.2, delay: 2.5 }), e('turret', 1380, 750, { rate: 2.2, delay: 3 }),
          e('shield', 800, 450, { mode: 'track', turn: 70 }),
        ],
      }),
      L('Web', {
        p: [200, 700], s: [270, 700],
        hazards: [spin(800, 450, 130, 0.9, { arms: 2 }), spin(1350, 250, 70, -1.6)],
        enemies: [
          e('core', 500, 250, { g: 'A' }), e('node', 300, 120, { g: 'A' }), e('node', 700, 120, { g: 'A' }),
          e('core', 1100, 650, { g: 'B' }), e('node', 900, 790, { g: 'B' }), e('node', 1300, 790, { g: 'B' }),
        ],
      }),
      L('Gauntlet', {
        p: [90, 450], s: [160, 450],
        walls: [R(800, 270, 1300, 30), R(800, 630, 1300, 30)],
        enemies: [
          e('turret', 1510, 450, { rate: 1.6, delay: 2 }), e('warden', 900, 450, { field: 150 }),
          e('chaser', 800, 120, { speed: 115 }), e('chaser', 800, 780, { speed: 115 }),
          e('dummy', 1480, 120), e('dummy', 1480, 780),
        ],
      }),
      L('Lattice', {
        boss: true,
        p: [250, 450], s: [320, 450],
        enemies: [e('lattice', 1050, 450)],
        hint: 'Break the nodes, then the heart, before they grow back.',
      }),
    ],
  };

  const CH4 = {
    id: 'c4',
    name: 'PRESSURE',
    palette: 'ember',
    blurb: 'The arena itself starts to move.',
    levels: [
      L('Bumpers', {
        p: [150, 450], s: [220, 450],
        walls: [B(500, 250), B(500, 650), B(1100, 250), B(1100, 650), B(800, 450, 46)],
        enemies: [e('dummy', 1450, 150), e('dummy', 1450, 750), e('dummy', 800, 110), e('dummy', 800, 790)],
        hint: 'Bumpers kick the square away even harder.',
      }),
      L('Portals', {
        p: [200, 450], s: [270, 450],
        walls: [R(800, 450, 40, 900)],
        hazards: [portal(600, 450, 1000, 700)],
        enemies: [e('dummy', 1300, 200), e('dummy', 1420, 620), e('dummy', 1100, 380)],
        hint: 'Portals carry the square, not you.',
      }),
      L('Locked', {
        p: [200, 450], s: [270, 450],
        walls: [R(1200, 300, 300, 24), R(1200, 600, 300, 24), R(1350, 450, 24, 324), R(1050, 450, 24, 276, 0, { door: 'a' })],
        hazards: [sw(600, 150, 'a')],
        enemies: [e('dummy', 1200, 450)],
        hint: 'Hit a switch with the square to open its doors.',
      }),
      L('Pistons', {
        p: [150, 450], s: [220, 450],
        walls: [0, 1, 2].map((i) => R(500 + i * 300, 250, 50, 500, 0, { move: { dx: 0, dy: 400, period: 3, phase: i / 3 } })),
        enemies: [e('dummy', 1400, 200), e('dummy', 1400, 700), e('dummy', 1480, 450)],
        hint: 'Moving walls can crush you against the edges.',
      }),
      L('Currents', {
        p: [150, 600], s: [220, 600],
        hazards: [wind(600, 450, 400, 900, 0, -900), wind(1000, 450, 400, 900, 0, 900)],
        enemies: [e('dummy', 1450, 150), e('dummy', 1450, 750), e('dummy', 150, 150), e('dummy', 800, 820)],
      }),
      L('Laser Grid', {
        p: [150, 450], s: [220, 450],
        hazards: [laser(400, 300, 1200, 300, { on: 1.4, off: 1.6 }), laser(400, 600, 1200, 600, { on: 1.4, off: 1.6, phase: 0.5 }), laser(1200, 300, 1200, 600, { on: 1, off: 2, phase: 0.25 })],
        enemies: [e('dummy', 800, 150), e('dummy', 800, 750), e('dummy', 1460, 450), e('chaser', 1500, 100, { speed: 105 }), e('chaser', 1500, 800, { speed: 105 })],
        hint: 'Lasers flicker before they fire. The square passes through.',
      }),
      L('Combination', {
        p: [200, 450], s: [270, 450],
        walls: [
          R(1200, 200, 600, 24), R(1200, 700, 600, 24), R(1500, 450, 24, 524), R(900, 450, 24, 476, 0, { door: 'a' }),
          R(1275, 330, 250, 20), R(1275, 570, 250, 20), R(1400, 450, 20, 260), R(1150, 450, 20, 220, 0, { door: 'b' }),
        ],
        hazards: [sw(400, 150, 'a'), sw(1010, 300, 'b')],
        enemies: [e('dummy', 1275, 450), e('dummy', 1000, 620), e('dummy', 1560, 450)],
      }),
      L('Rotor', {
        p: [150, 450], s: [220, 450],
        walls: [R(800, 450, 640, 30, 0, { spin: 35 })],
        enemies: [e('dummy', 300, 150), e('dummy', 1300, 150), e('dummy', 300, 750), e('dummy', 1300, 750), e('dummy', 1500, 450)],
        hint: 'Even the walls turn now.',
      }),
      L('Machine', {
        p: [150, 450], s: [220, 450],
        walls: [R(800, 450, 30, 700), B(320, 200), B(320, 700), R(1450, 600, 300, 24), R(1300, 750, 24, 324, 0, { door: 'm' })],
        hazards: [portal(500, 450, 1050, 600), sw(1100, 150, 'm')],
        enemies: [e('dummy', 1250, 250), e('dummy', 1000, 820), e('dummy', 1460, 760)],
      }),
      L('Engine', {
        boss: true,
        p: [250, 450], s: [320, 450],
        walls: [C(620, 250, 40), C(620, 650, 40)],
        enemies: [e('engine', 1150, 450, { path: [[1150, 250], [1150, 650]], speed: 55 })],
        hint: 'Find the gaps between its plates.',
      }),
    ],
  };

  const CH5 = {
    id: 'c5',
    name: 'FRACTURE',
    palette: 'rust',
    blurb: 'Some things only break if you mean it.',
    levels: [
      L('Plating', {
        p: [300, 450], s: [370, 450],
        enemies: [e('armored', 1200, 450), e('armored', 1200, 150)],
        hint: 'Armor only breaks at full force. Launch from point-blank.',
      }),
      L('Splitters', {
        p: [250, 450], s: [320, 450],
        enemies: [e('splitter', 1100, 300, { tier: 1 }), e('splitter', 1100, 650, { tier: 2 })],
        hint: 'Cracked shapes break into more shapes.',
      }),
      L('Flicker', {
        p: [200, 450], s: [270, 450],
        enemies: [e('phantom', 900, 250), e('phantom', 1200, 450, { phase: 0.33 }), e('phantom', 900, 650, { phase: 0.66 }), e('phantom', 1400, 180, { phase: 0.5 })],
        hint: 'Phantoms are only solid some of the time.',
      }),
      L('Lunge', {
        p: [250, 450], s: [320, 450],
        enemies: [e('dasher', 1300, 250, { delay: 1.5 }), e('dasher', 1300, 650, { delay: 2.4 })],
        hint: 'Dashers take aim, then lunge. Sidestep the line.',
      }),
      L('Heavy Guard', {
        p: [200, 450], s: [270, 450],
        walls: [R(1350, 200, 24, 200), R(1350, 700, 24, 200)],
        enemies: [e('shield', 1100, 300, { face: 180 }), e('shield', 1100, 600, { face: 180 }), e('armored', 1400, 450)],
      }),
      L('Shatter', {
        p: [200, 450], s: [270, 450],
        walls: [Dm(700, 450, 90), Dm(1300, 450, 90)],
        enemies: [e('splitter', 1000, 250, { tier: 2 }), e('splitter', 1000, 650, { tier: 1 })],
      }),
      L('Ghost Lights', {
        p: [150, 450], s: [220, 450],
        hazards: [spin(850, 450, 95, 1.1, { arms: 2 }), spin(500, 700, 60, -1.7)],
        enemies: [e('phantom', 700, 200), e('phantom', 1000, 700, { phase: 0.4 }), e('phantom', 1300, 300, { phase: 0.7 }), e('phantom', 1450, 650, { phase: 0.2 })],
      }),
      L('Stampede', {
        p: [200, 450], s: [270, 450],
        enemies: [
          e('dasher', 1300, 200, { delay: 1.6 }), e('dasher', 1300, 700, { delay: 2.8 }),
          e('chaser', 1500, 90, { speed: 110 }), e('chaser', 1500, 810, { speed: 110 }), e('dummy', 1450, 450),
        ],
      }),
      L('Everything Breaks', {
        p: [200, 450], s: [270, 450],
        enemies: [
          e('splitter', 1200, 450, { tier: 2, armor: true }), e('phantom', 900, 200), e('phantom', 900, 700, { phase: 0.5 }),
          e('dasher', 1450, 150, { delay: 2.5 }),
        ],
      }),
      L('Prism', {
        boss: true,
        p: [250, 450], s: [320, 450],
        walls: [C(650, 200, 35), C(650, 700, 35)],
        enemies: [e('prism', 1100, 450, { path: [[1100, 280], [1100, 620]], speed: 50 })],
        hint: 'Every strike sheds splinters. Only full force gets through.',
      }),
    ],
  };

  const CH6 = {
    id: 'c6',
    name: 'CIRCLE',
    palette: 'mono',
    blurb: 'Everything you have learned, at once.',
    levels: [
      L('Echo', {
        p: [200, 450], s: [270, 450],
        enemies: [
          e('shield', 1000, 300, { mode: 'track', turn: 70 }), e('chaser', 1450, 150, { speed: 120 }), e('chaser', 1450, 750, { speed: 120 }),
          e('dummy', 1000, 650, orbit(1000, 650, 120, 1, 0)),
        ],
      }),
      L('Inversion', {
        p: [200, 450], s: [270, 450],
        hazards: [well(1100, 450, 60, 330, 1500)],
        enemies: [e('core', 1100, 180), e('node', 1100, 720), e('node', 1450, 450), e('node', 750, 450)],
      }),
      L('Clockwork', {
        p: [150, 450], s: [220, 450],
        walls: [R(560, 450, 360, 26, 0, { spin: -40 }), R(1040, 450, 360, 26, 0, { spin: 40 })],
        enemies: [e('turret', 800, 120, { aim: 'spin', spinRate: 70, rate: 0.9, delay: 2 }), e('turret', 800, 780, { aim: 'spin', spinRate: -70, rate: 0.9, delay: 2.4 }), e('dummy', 1480, 450)],
      }),
      L('Haunt', {
        p: [200, 450], s: [270, 450],
        mods: { darkness: true },
        enemies: [
          e('phantom', 800, 250), e('phantom', 1200, 650, { phase: 0.5 }), e('chaser', 1450, 120, { speed: 105 }),
          e('dummy', 1400, 450), e('warden', 800, 650, { field: 140 }),
        ],
        hint: 'The light follows you and the square. Nothing else.',
      }),
      L('Undertow', {
        p: [150, 450], s: [220, 450],
        hazards: [wind(800, 450, 500, 900, 500, 0)],
        enemies: [e('dasher', 1400, 200, { delay: 1.8 }), e('dasher', 1400, 700, { delay: 2.6 }), e('armored', 1200, 450)],
      }),
      L('Vault', {
        p: [200, 450], s: [270, 450],
        walls: [
          R(1200, 250, 400, 24), R(1200, 650, 400, 24), R(1400, 450, 24, 424), R(1000, 450, 24, 376, 0, { door: 'v' }),
          R(700, 120, 24, 240), R(700, 780, 24, 240),
        ],
        hazards: [sw(700, 450, 'v'), laser(1000, 0, 1000, 238, { on: 1, off: 2.2 }), laser(1000, 662, 1000, 900, { on: 1, off: 2.2, phase: 0.5 })],
        enemies: [e('armored', 1200, 450), e('turret', 1500, 120, { rate: 2.2 }), e('turret', 1500, 780, { rate: 2.2, delay: 3 })],
      }),
      L('Choir', {
        p: [150, 450], s: [220, 450],
        enemies: [
          e('core', 600, 220, { g: 'A' }), ...SQ.build.ring(3, 600, 220, 120, (x, y) => e('node', x, y, { g: 'A', orbitCore: 120, ospeed: 0.7 })),
          e('core', 1000, 680, { g: 'B' }), ...SQ.build.ring(3, 1000, 680, 120, (x, y) => e('node', x, y, { g: 'B', orbitCore: 120, ospeed: -0.7 })),
          e('turret', 1450, 450, { aim: 'spin', spinRate: 40, burst: 3, spread: 25, rate: 1.6 }),
        ],
      }),
      L('Twins', {
        p: [200, 450], squares: [[270, 400], [270, 500]],
        mods: { twin: true },
        enemies: [[1400, 120], [1450, 450], [1400, 780], [1000, 120], [1000, 780]].map(([x, y]) => e('chaser', x, y, { speed: 115 })),
        hint: 'Two squares. Both answer when you call.',
      }),
      L('Last Light', {
        p: [200, 450], s: [270, 450],
        walls: [B(800, 450, 50)],
        hazards: [spin(800, 180, 80, 1.3), spin(800, 720, 80, -1.3)],
        enemies: [
          e('splitter', 1300, 450, { tier: 2 }), e('dasher', 1450, 150, { delay: 2 }), e('phantom', 1100, 750, { phase: 0.3 }),
          e('shield', 1100, 150, { mode: 'track' }), e('turret', 1500, 800, { rate: 2.4, delay: 3 }),
        ],
      }),
      L('The Circle', {
        boss: true,
        p: [250, 450], s: [320, 450],
        walls: [Dm(800, 220, 70), Dm(800, 680, 70)],
        enemies: [e('mirror', 1350, 450, { sx: 1300, sy: 250 })],
        hint: 'It plays by your rules.',
      }),
    ],
  };

  SQ.CHAPTERS = [CH1, CH2, CH3, CH4, CH5, CH6];
  SQ.CHAPTERS.forEach((ch, ci) =>
    ch.levels.forEach((lv, li) => {
      lv.id = ci + 1 + '-' + (li + 1);
      lv.palette = lv.palette || ch.palette;
      lv.chapter = ch;
      lv.index = li;
    })
  );
})();
