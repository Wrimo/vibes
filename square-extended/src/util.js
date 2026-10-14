// Shared namespace, math and collision helpers.
// Everything hangs off window.SQ so the game runs from plain <script> tags
// (no module loader), which keeps it working from file:// and on itch.io.
'use strict';
const SQ = (window.SQ = window.SQ || {});

// Logical arena size. All level coordinates use this space.
SQ.W = 1600;
SQ.H = 900;
SQ.BORDER = 44;

SQ.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
SQ.lerp = (a, b, t) => a + (b - a) * t;
SQ.len = (x, y) => Math.hypot(x, y);
SQ.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
SQ.rad = (deg) => (deg * Math.PI) / 180;
SQ.rand = (a, b) => a + Math.random() * (b - a);
SQ.randi = (a, b) => Math.floor(SQ.rand(a, b + 1));
SQ.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
SQ.angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
SQ.wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
// Rotate angle a toward b by at most step radians.
SQ.turnToward = (a, b, step) => {
  const d = SQ.wrapAngle(b - a);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
};
SQ.smooth = (t) => t * t * (3 - 2 * t);

// Circle vs oriented rectangle. Rect is {x, y, w, h, a} with x/y at its
// centre and a in radians. Returns {nx, ny, depth} pushing the circle out,
// or null when not touching.
SQ.circleRect = (cx, cy, r, rc) => {
  const c = Math.cos(rc.a || 0);
  const s = Math.sin(rc.a || 0);
  const dx = cx - rc.x;
  const dy = cy - rc.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const hw = rc.w / 2;
  const hh = rc.h / 2;
  let nx, ny, depth;
  if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) {
    // Centre inside: push out along the shallowest axis.
    const px = hw - Math.abs(lx);
    const py = hh - Math.abs(ly);
    if (px < py) {
      nx = Math.sign(lx) || 1;
      ny = 0;
      depth = px + r;
    } else {
      nx = 0;
      ny = Math.sign(ly) || 1;
      depth = py + r;
    }
  } else {
    const qx = SQ.clamp(lx, -hw, hw);
    const qy = SQ.clamp(ly, -hh, hh);
    const ex = lx - qx;
    const ey = ly - qy;
    const d = Math.hypot(ex, ey);
    if (d >= r) return null;
    nx = ex / d;
    ny = ey / d;
    depth = r - d;
  }
  return { nx: nx * c - ny * s, ny: nx * s + ny * c, depth };
};

SQ.circleCircle = (ax, ay, ar, bx, by, br) => {
  const dx = ax - bx;
  const dy = ay - by;
  const d = Math.hypot(dx, dy);
  if (d >= ar + br) return null;
  if (d < 1e-6) return { nx: 1, ny: 0, depth: ar + br };
  return { nx: dx / d, ny: dy / d, depth: ar + br - d };
};

// Distance from point to segment.
SQ.segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  let t = l2 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
  t = SQ.clamp(t, 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
};

// Corners of an oriented rect, for drawing.
SQ.rectCorners = (rc) => {
  const c = Math.cos(rc.a || 0);
  const s = Math.sin(rc.a || 0);
  const hw = rc.w / 2;
  const hh = rc.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [rc.x + x * c - y * s, rc.y + x * s + y * c]);
};

SQ.hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
SQ.rgba = (hex, a) => {
  const [r, g, b] = SQ.hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
SQ.mix = (h1, h2, t) => {
  const a = SQ.hexToRgb(h1);
  const b = SQ.hexToRgb(h2);
  const c = a.map((v, i) => Math.round(SQ.lerp(v, b[i], t)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};

SQ.fmtTime = (t) => {
  if (t == null) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return (m ? m + ':' + (s < 10 ? '0' : '') : '') + s.toFixed(2);
};
