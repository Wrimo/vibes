// Drawing primitives and the world renderer.
'use strict';
SQ.drawing = (() => {
  const fill = (ctx, color) => {
    ctx.fillStyle = color;
    ctx.fill();
  };
  return {
    circle(ctx, x, y, r, color) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
      fill(ctx, color);
    },
    ring(ctx, x, y, r, color, lw = 2, dash = null, offset = 0) {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      if (dash) {
        ctx.setLineDash(dash);
        ctx.lineDashOffset = offset;
      }
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    },
    arc(ctx, x, y, r, frac, color, lw = 3) {
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * SQ.clamp(frac, 0, 1));
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    },
    // Square of the given side, rotated.
    square(ctx, x, y, side, rot, color, stroke, lw = 3) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot || 0);
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(-side / 2, -side / 2, side, side);
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.strokeRect(-side / 2, -side / 2, side, side);
      }
      ctx.restore();
    },
    // Diamond whose corners sit r from the centre.
    diamond(ctx, x, y, r, rot, color) {
      this.square(ctx, x, y, r * Math.SQRT2, (rot || 0) + Math.PI / 4, color);
    },
    rect(ctx, rc, color, stroke, lw = 3) {
      const pts = SQ.rectCorners(rc);
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      if (color) fill(ctx, color);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    },
    poly(ctx, x, y, r, n, rot, color) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = rot + (i * Math.PI * 2) / n;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      fill(ctx, color);
    },
    gear(ctx, x, y, r, teeth, rot, color) {
      ctx.beginPath();
      const n = teeth * 2;
      for (let i = 0; i < n; i++) {
        const a = rot + (i * Math.PI * 2) / n;
        const rr = i % 2 ? r * 0.8 : r;
        const a2 = a + Math.PI / n;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        ctx.lineTo(x + Math.cos(a2) * rr, y + Math.sin(a2) * rr);
      }
      ctx.closePath();
      fill(ctx, color);
    },
    triangle(ctx, x, y, r, ang, color) {
      ctx.beginPath();
      for (const da of [0, 2.3, -2.3]) {
        const rr = da ? r * 0.85 : r;
        ctx.lineTo(x + Math.cos(ang + da) * rr, y + Math.sin(ang + da) * rr);
      }
      ctx.closePath();
      fill(ctx, color);
    },
    kite(ctx, x, y, r, ang, color) {
      ctx.beginPath();
      const pts = [
        [r, 0],
        [-r * 0.45, r * 0.6],
        [-r * 0.15, 0],
        [-r * 0.45, -r * 0.6],
      ];
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      pts.forEach(([px, py], i) => {
        const X = x + px * c - py * s;
        const Y = y + px * s + py * c;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.closePath();
      fill(ctx, color);
    },
    // Tapered sliver trailing behind something heading in direction ang.
    tail(ctx, x, y, ang, width, len, color) {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(x - s * width, y + c * width);
      ctx.lineTo(x - c * len, y - s * len);
      ctx.lineTo(x + s * width, y - c * width);
      ctx.closePath();
      fill(ctx, color);
    },
    dots(ctx, x1, y1, x2, y2, spacing, r, color) {
      const d = SQ.dist(x1, y1, x2, y2);
      const n = Math.floor(d / spacing);
      ctx.fillStyle = color;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        ctx.beginPath();
        ctx.arc(SQ.lerp(x1, x2, t), SQ.lerp(y1, y2, t), r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    // Tapering comet trail through a list of points (oldest first).
    trail(ctx, pts, width, color) {
      const n = pts.length;
      if (n < 2) return;
      const left = [];
      const right = [];
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const wdt = width * (i / (n - 1));
        left.push([pts[i][0] - dy * wdt, pts[i][1] + dx * wdt]);
        right.push([pts[i][0] + dy * wdt, pts[i][1] - dx * wdt]);
      }
      ctx.beginPath();
      left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
      fill(ctx, color);
    },
  };
})();

(() => {
  const D = SQ.drawing;
  let darkCanvas = null;

  SQ.World.prototype.draw = function (ctx) {
    const pal = this.pal;
    const W = SQ.W;
    const H = SQ.H;
    const B = SQ.BORDER;
    ctx.save();
    if (this.shake > 0 && SQ.save.settings.shake) ctx.translate(SQ.rand(-1, 1) * this.shake, SQ.rand(-1, 1) * this.shake);

    // Frame and floor.
    ctx.fillStyle = pal.border;
    ctx.fillRect(-B * 3, -B * 3, W + B * 6, H + B * 6);
    const g = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.62);
    g.addColorStop(0, pal.bg);
    g.addColorStop(1, pal.bgEdge);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    this.drawHazardsUnder(ctx);
    for (const w of this.walls) this.drawWall(ctx, w);
    this.drawHazardsOver(ctx);

    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (e.spawnT > 0) {
        const t = SQ.clamp(e.spawnT / 0.8, 0, 1);
        D.ring(ctx, e.x, e.y, e.r + 40 * t, SQ.rgba(pal.enemy, 0.8 * (1 - t) + 0.2), 3);
        ctx.globalAlpha = 0.35 * (1 - t);
        SQ.ENEMY[e.t].draw(e, this, ctx, pal);
        ctx.globalAlpha = 1;
        continue;
      }
      SQ.ENEMY[e.t].draw(e, this, ctx, pal);
    }
    for (const b of this.bullets) {
      D.circle(ctx, b.x, b.y, b.r + 3, SQ.rgba(pal.enemy, 0.3));
      D.circle(ctx, b.x, b.y, b.r, pal.enemy);
    }

    for (const s of this.foeSquares) this.drawSquare(ctx, s, pal.enemy, pal.enemy2);
    for (const s of this.squares) this.drawSquare(ctx, s, pal.square, pal.squareDim);
    this.drawPlayer(ctx);

    for (const q of this.particles) {
      ctx.globalAlpha = SQ.clamp(q.life / q.max, 0, 1);
      D.square(ctx, q.x, q.y, q.size * (0.4 + 0.6 * (q.life / q.max)), q.rot, q.color);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      D.ring(ctx, r.x, r.y, r.r * (0.3 + t * 0.9), SQ.rgba(r.color, (1 - t) * 0.7), 3 * (1 - t) + 1);
    }
    ctx.font = 'bold 22px ' + SQ.FONT;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.fillStyle = SQ.rgba(pal.ui, SQ.clamp(t.life / t.max, 0, 1));
      ctx.fillText(t.text, t.x, t.y);
    }

    if (this.mods.darkness) this.drawDarkness(ctx);

    // Vignette, like an old screen.
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  SQ.World.prototype.drawWall = function (ctx, w) {
    const pal = this.pal;
    if (w.door) {
      const col = SQ.rgba(pal.hazard, w.open ? 0.35 : 0.8);
      if (w.k === 'c') {
        if (!w.open) D.circle(ctx, w.x, w.y, w.r, pal.wall);
        D.ring(ctx, w.x, w.y, w.r, col, 3, [8, 8]);
      } else {
        if (!w.open) D.rect(ctx, w, pal.wall);
        ctx.setLineDash([10, 8]);
        D.rect(ctx, w, null, col, 3);
        ctx.setLineDash([]);
      }
      return;
    }
    if (w.k === 'c') {
      if (w.bumper) {
        const s = 1 + w.pulse * 0.15;
        D.circle(ctx, w.x, w.y, w.r * s, pal.wall);
        D.ring(ctx, w.x, w.y, w.r * s - 6, SQ.mix(pal.hazard, pal.wall, 0.35 - w.pulse * 0.35), 5);
      } else D.circle(ctx, w.x, w.y, w.r, pal.wall);
    } else D.rect(ctx, w, pal.wall);
  };

  SQ.World.prototype.drawHazardsUnder = function (ctx) {
    const pal = this.pal;
    const t = this.t;
    for (const h of this.hazards) {
      if (h.t === 'wind') {
        ctx.fillStyle = SQ.rgba(pal.hazard, 0.06);
        ctx.fillRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h);
        const a = Math.atan2(h.fy, h.fx);
        const f = Math.hypot(h.fx, h.fy);
        ctx.save();
        ctx.beginPath();
        ctx.rect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h);
        ctx.clip();
        ctx.strokeStyle = SQ.rgba(pal.hazard, 0.25);
        ctx.lineWidth = 2;
        const n = Math.floor((h.w * h.h) / 9000) + 4;
        for (let i = 0; i < n; i++) {
          const seed = Math.sin(i * 91.7 + h.x) * 1000;
          const u = seed - Math.floor(seed);
          const seed2 = Math.sin(i * 47.3 + h.y) * 1000;
          const v = seed2 - Math.floor(seed2);
          const span = h.w + h.h;
          const off = ((t * f * 0.35 + u * span) % span) - span / 2;
          const px = h.x + Math.cos(a) * off + -Math.sin(a) * (v - 0.5) * span;
          const py = h.y + Math.sin(a) * off + Math.cos(a) * (v - 0.5) * span;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(a) * 30, py - Math.sin(a) * 30);
          ctx.stroke();
        }
        ctx.restore();
      } else if (h.t === 'well') {
        const R = h.R || 320;
        for (let i = 0; i < 4; i++) {
          const k = 1 - ((t * 0.35 + i / 4) % 1);
          D.ring(ctx, h.x, h.y, (h.core || 50) + (R - (h.core || 50)) * k, SQ.rgba(pal.wall, 0.18 * (1 - k)), 2);
        }
        D.circle(ctx, h.x, h.y, h.core || 50, pal.wall);
      } else if (h.t === 'portal') {
        const r = h.r || 36;
        const col = h.color ? pal[h.color] : pal.hazard;
        for (const [x, y, dir] of [
          [h.ax, h.ay, 1],
          [h.bx, h.by, -1],
        ]) {
          D.circle(ctx, x, y, r, SQ.rgba(col, 0.12));
          D.ring(ctx, x, y, r, SQ.rgba(col, 0.85), 4, [10, 7], t * 40 * dir);
          D.ring(ctx, x, y, r * 0.55, SQ.rgba(col, 0.4), 2, [5, 5], -t * 30 * dir);
        }
      } else if (h.t === 'switch') {
        const r = h.r || 20;
        D.circle(ctx, h.x, h.y, r + 6, SQ.rgba(pal.wall, 0.8));
        D.circle(ctx, h.x, h.y, r * 0.7, h.on ? pal.hazard : SQ.rgba(pal.hazard, 0.25));
        D.ring(ctx, h.x, h.y, r + 6, SQ.rgba(pal.hazard, 0.7), 2);
      } else if (h.t === 'laser') {
        const on = SQ.laserOn(h, t);
        if (on >= 1) {
          ctx.strokeStyle = SQ.rgba(pal.hazard, 0.35);
          ctx.lineWidth = 16;
          ctx.beginPath();
          ctx.moveTo(h.x1, h.y1);
          ctx.lineTo(h.x2, h.y2);
          ctx.stroke();
          ctx.strokeStyle = pal.hazard;
          ctx.lineWidth = 6;
          ctx.stroke();
        } else {
          ctx.strokeStyle = SQ.rgba(pal.hazard, on > 0 ? (Math.sin(t * 60) > 0 ? 0.7 : 0.2) : 0.18);
          ctx.lineWidth = on > 0 ? 3 : 2;
          ctx.setLineDash([6, 10]);
          ctx.beginPath();
          ctx.moveTo(h.x1, h.y1);
          ctx.lineTo(h.x2, h.y2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        D.circle(ctx, h.x1, h.y1, 9, pal.wall);
        D.circle(ctx, h.x2, h.y2, 9, pal.wall);
      }
    }
  };

  SQ.World.prototype.drawHazardsOver = function (ctx) {
    const pal = this.pal;
    for (const h of this.hazards) {
      if (h.t !== 'spinner') continue;
      ctx.lineCap = 'round';
      for (const [ax, ay, bx, by] of SQ.spinnerArms(h, this.t)) {
        const g = ctx.createLinearGradient(ax, ay, bx, by);
        g.addColorStop(0, SQ.rgba(pal.hazard, 0.15));
        g.addColorStop(1, SQ.rgba(pal.hazard, 0.95));
        ctx.strokeStyle = g;
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      D.circle(ctx, h.x, h.y, 13, pal.wall);
    }
  };

  SQ.World.prototype.drawSquare = function (ctx, s, hot, dim) {
    const K = this.K;
    const speed = Math.hypot(s.vx, s.vy);
    const lethal = speed >= K.lethal;
    const col = lethal ? hot : dim;
    if (s.recall && this.player.alive) {
      const tg = s.target || this.player;
      ctx.strokeStyle = SQ.rgba(col, 0.25);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tg.x, tg.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (speed > 60) D.trail(ctx, s.trail.concat([[s.x, s.y]]), 13, SQ.rgba(col, lethal ? 0.85 : 0.4));
    D.square(ctx, s.x, s.y, 30, s.ang, col);
    if (this.mods.ricochet && s.own === 'player' && !s.armed && lethal) D.square(ctx, s.x, s.y, 40, s.ang, null, SQ.rgba(hot, 0.6), 2);
  };

  SQ.World.prototype.drawPlayer = function (ctx) {
    const p = this.player;
    const pal = this.pal;
    if (!p.alive) return;
    if (SQ.save.settings.showRange && this.state === 'play') {
      D.ring(ctx, p.x, p.y, this.K.range, SQ.rgba(pal.playerHot, 0.07 + this.rangeGlow * 0.18), 2, [3, 9], -this.t * 12);
    }
    const col = SQ.mix(pal.player, pal.playerHot, this.rangeGlow);
    if (this.rangeGlow > 0.05) D.circle(ctx, p.x, p.y, p.r + 6 * this.rangeGlow, SQ.rgba(pal.playerHot, 0.18 * this.rangeGlow));
    D.circle(ctx, p.x, p.y, p.r, col);
    if (this.launchBuf > 0) D.ring(ctx, p.x, p.y, p.r + 4, SQ.rgba(pal.playerHot, 0.5), 2);
  };

  SQ.World.prototype.drawDarkness = function (ctx) {
    const sc = 0.5;
    if (!darkCanvas) {
      darkCanvas = document.createElement('canvas');
      darkCanvas.width = SQ.W * sc;
      darkCanvas.height = SQ.H * sc;
    }
    const d = darkCanvas.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, darkCanvas.width, darkCanvas.height);
    d.fillStyle = 'rgba(5,6,10,0.96)';
    d.fillRect(0, 0, darkCanvas.width, darkCanvas.height);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r) => {
      const g = d.createRadialGradient(x * sc, y * sc, 0, x * sc, y * sc, r * sc);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.beginPath();
      d.arc(x * sc, y * sc, r * sc, 0, Math.PI * 2);
      d.fill();
    };
    const p = this.player;
    hole(p.x, p.y, 230);
    for (const s of this.squares) hole(s.x, s.y, 120 + Math.min(80, Math.hypot(s.vx, s.vy) * 0.06));
    for (const r of this.rings) hole(r.x, r.y, r.r * 1.5 * (r.life / r.max));
    for (const b of this.bullets) hole(b.x, b.y, 26);
    ctx.drawImage(darkCanvas, 0, 0, SQ.W, SQ.H);
  };
})();
