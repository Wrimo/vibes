// Menus, HUD and game flow. Every screen draws in the same logical space as
// the arena (0..1600 x 0..900, with the border band around it).
'use strict';
SQ.FONT = '"Futura", "Century Gothic", "Avenir Next", "Trebuchet MS", sans-serif';

(() => {
  const I = SQ.input;
  const W = SQ.W;
  const H = SQ.H;
  const save = SQ.save;

  // ------------------------------------------------------------- helpers
  const text = (ctx, str, x, y, o = {}) => {
    ctx.font = `${o.weight || 'normal'} ${o.size || 24}px ${SQ.FONT}`;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = o.baseline || 'middle';
    ctx.fillStyle = o.color || '#fff';
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (o.spacing) {
      try {
        ctx.letterSpacing = o.spacing + 'px';
      } catch (e) {
        /* older browsers */
      }
    }
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
    if (o.spacing) {
      try {
        ctx.letterSpacing = '0px';
      } catch (e) {
        /* ignore */
      }
    }
  };
  const wrap = (ctx, str, maxW, size, weight = 'normal') => {
    ctx.font = `${weight} ${size}px ${SQ.FONT}`;
    const words = str.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (ctx, str, x, y, maxW, o = {}) => {
    const size = o.size || 22;
    const lines = wrap(ctx, str, maxW, size, o.weight);
    lines.forEach((l, i) => text(ctx, l, x, y + i * size * 1.4, o));
    return lines.length * size * 1.4;
  };
  SQ.ui = { text, wrap, para };

  const controlWord = (which) => {
    if (I.usingPad) return which === 'launch' ? 'A' : 'B';
    return which === 'launch' ? 'left-click (it flies toward the cursor) or SPACE' : 'SHIFT (or right-click)';
  };
  const fillHint = (s) => s.replace('{launch}', controlWord('launch')).replace('{recall}', controlWord('recall'));

  const isUnlockAll = () => !!save.settings.unlockAll;
  const levelUnlocked = (ci, li) => {
    if (isUnlockAll()) return true;
    if (li === 0) {
      if (ci === 0) return true;
      const prev = SQ.CHAPTERS[ci - 1];
      return !!save.data.cleared[prev.levels[prev.levels.length - 1].id];
    }
    return !!save.data.cleared[SQ.CHAPTERS[ci].levels[li - 1].id];
  };
  const chapterDone = (ci) => SQ.CHAPTERS[ci].levels.every((l) => save.data.cleared[l.id]);
  SQ.progress = { levelUnlocked, chapterDone };

  // Drifting shapes behind menus.
  class Backdrop {
    constructor() {
      this.t = 0;
      this.shapes = Array.from({ length: 16 }, (_, i) => ({
        x: Math.random() * W, y: Math.random() * H, s: 20 + Math.random() * 90, r: Math.random() * 6,
        vr: SQ.rand(-0.2, 0.2), vx: SQ.rand(-12, 12), vy: SQ.rand(-8, 8), k: i % 3,
      }));
    }
    update(dt) {
      this.t += dt;
      for (const s of this.shapes) {
        s.x = (s.x + s.vx * dt + W + 200) % (W + 200) - 100;
        s.y = (s.y + s.vy * dt + H + 200) % (H + 200) - 100;
        s.r += s.vr * dt;
      }
    }
    draw(ctx, pal) {
      const B = SQ.BORDER;
      ctx.fillStyle = pal.border;
      ctx.fillRect(-B * 3, -B * 3, W + B * 6, H + B * 6);
      const g = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W * 0.62);
      g.addColorStop(0, pal.bg);
      g.addColorStop(1, pal.bgEdge);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      for (const s of this.shapes) {
        ctx.globalAlpha = 0.12;
        const c = s.k === 0 ? pal.wall : s.k === 1 ? pal.enemy : pal.square;
        SQ.drawing.square(ctx, s.x, s.y, s.s, s.r, c);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
  }
  const backdrop = new Backdrop();

  // Vertical list menu with keyboard, gamepad and mouse support.
  class Menu {
    constructor(items, o = {}) {
      this.items = items;
      this.sel = items.findIndex((i) => !i.disabled);
      if (this.sel < 0) this.sel = 0;
      this.o = o;
      this.rects = [];
    }
    move(d) {
      const n = this.items.length;
      for (let k = 1; k <= n; k++) {
        const i = (((this.sel + d * k) % n) + n) % n;
        if (!this.items[i].disabled) {
          this.sel = i;
          SQ.audio.play('move');
          return;
        }
      }
    }
    update() {
      if (I.pressed('nav-up')) this.move(-1);
      if (I.pressed('nav-down')) this.move(1);
      const it = this.items[this.sel];
      if (it && it.adjust) {
        if (I.pressed('nav-left')) it.adjust(-1);
        if (I.pressed('nav-right')) it.adjust(1);
      }
      const m = I.mouse;
      let hover = -1;
      this.rects.forEach((r, i) => {
        if (m.x >= r[0] && m.x <= r[0] + r[2] && m.y >= r[1] && m.y <= r[1] + r[3]) hover = i;
      });
      if (m.moved && hover >= 0 && !this.items[hover].disabled && hover !== this.sel) {
        this.sel = hover;
        SQ.audio.play('move');
      }
      if (m.click && hover >= 0) {
        this.sel = hover;
        return this.activate();
      }
      if (I.pressed('confirm') && !m.click) return this.activate();
      if (I.pressed('back') && this.o.onBack) {
        SQ.audio.play('move');
        this.o.onBack();
      }
    }
    activate() {
      const it = this.items[this.sel];
      if (!it || it.disabled) {
        SQ.audio.play('denied');
        return;
      }
      SQ.audio.play('select');
      if (it.action) it.action();
      else if (it.adjust) it.adjust(1);
    }
    draw(ctx, x, y, pal, o = {}) {
      const gap = o.gap || 58;
      const size = o.size || 30;
      const width = o.width || 520;
      this.rects = [];
      this.items.forEach((it, i) => {
        const yy = y + i * gap;
        const sel = i === this.sel;
        const label = typeof it.label === 'function' ? it.label() : it.label;
        const col = it.disabled ? SQ.rgba(pal.ui, 0.35) : pal.ui;
        if (sel) {
          ctx.fillStyle = SQ.rgba(pal.border, 0.45);
          ctx.fillRect(x - width / 2, yy - gap * 0.42, width, gap * 0.84);
          SQ.drawing.diamond(ctx, x - width / 2 + 26, yy, 9, backdrop.t * 2, pal.square);
        }
        text(ctx, label, x, yy, { size, color: col, weight: sel ? 'bold' : 'normal', spacing: 2 });
        if (it.value) text(ctx, it.value(), x + width / 2 - 20, yy, { size: size * 0.8, color: col, align: 'right' });
        this.rects.push([x - width / 2, yy - gap / 2, width, gap]);
      });
    }
  }

  // ------------------------------------------------------------- screens
  let screen = null;
  SQ.setScreen = (s) => {
    screen = s;
  };
  SQ.getScreen = () => screen;

  class TitleScreen {
    constructor() {
      this.t = 0;
      this.pal = SQ.PALETTES.sand;
      SQ.audio.music('sand');
    }
    update(dt) {
      this.t += dt;
      backdrop.update(dt);
      if (this.t > 0.3 && I.pressed('any')) {
        SQ.audio.play('select');
        SQ.setScreen(new MainMenu());
      }
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      // A little circle and square doing their dance.
      const t = this.t;
      const cx = W / 2 + Math.cos(t * 0.7) * 120;
      const cy = 640 + Math.sin(t * 1.1) * 30;
      const sx = W / 2 + Math.cos(t * 1.6) * 420;
      const sy = 640 + Math.sin(t * 3.2) * 110;
      const pts = [];
      for (let i = 14; i >= 0; i--) {
        const tt = t - i * 0.02;
        pts.push([W / 2 + Math.cos(tt * 1.6) * 420, 640 + Math.sin(tt * 3.2) * 110]);
      }
      SQ.drawing.trail(ctx, pts, 13, SQ.rgba(pal.square, 0.8));
      SQ.drawing.square(ctx, sx, sy, 30, t * 6, pal.square);
      SQ.drawing.circle(ctx, cx, cy, 24, pal.player);
      text(ctx, '(square)', W / 2, 270, { size: 150, color: pal.ui, weight: 'bold' });
      text(ctx, 'E X T E N D E D', W / 2, 375, { size: 34, color: pal.ui, alpha: 0.85 });
      text(ctx, 'Launch.  Recall.  Avoid.', W / 2, 440, { size: 26, color: pal.text, alpha: 0.9 });
      text(ctx, 'press any key', W / 2, 820, { size: 22, color: pal.ui, alpha: 0.5 + 0.4 * Math.sin(t * 3) });
    }
  }

  class MainMenu {
    constructor() {
      this.pal = SQ.PALETTES.sand;
      SQ.audio.music('sand');
      this.menu = new Menu([
        { label: 'CAMPAIGN', action: () => SQ.setScreen(new CampaignScreen()) },
        { label: 'CHALLENGES', action: () => SQ.setScreen(new ListScreen('challenges')) },
        { label: 'ARENAS', action: () => SQ.setScreen(new ListScreen('arenas')) },
        { label: 'SETTINGS', action: () => SQ.setScreen(new SettingsScreen(() => new MainMenu())) },
        { label: 'HOW TO PLAY', action: () => SQ.setScreen(new InfoScreen('how')) },
        { label: 'CREDITS', action: () => SQ.setScreen(new InfoScreen('credits')) },
      ], { onBack: () => SQ.setScreen(new TitleScreen()) });
    }
    update(dt) {
      backdrop.update(dt);
      this.menu.update();
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      text(ctx, '(square)', W / 2, 150, { size: 90, color: pal.ui, weight: 'bold' });
      text(ctx, 'E X T E N D E D', W / 2, 220, { size: 24, color: pal.ui, alpha: 0.8 });
      this.menu.draw(ctx, W / 2, 340, pal);
      const d = save.data;
      const cleared = Object.keys(d.cleared).length;
      const total = SQ.CHAPTERS.reduce((a, c) => a + c.levels.length, 0);
      text(ctx, `${cleared} / ${total} levels  ·  ${d.deaths} deaths`, W / 2, 850, { size: 20, color: pal.text, alpha: 0.8 });
    }
  }

  class CampaignScreen {
    constructor(ci, li) {
      // Default to the first unlocked level that hasn't been cleared.
      if (ci == null) {
        ci = 0;
        li = 0;
        outer: for (let i = 0; i < SQ.CHAPTERS.length; i++)
          for (let j = 0; j < SQ.CHAPTERS[i].levels.length; j++)
            if (levelUnlocked(i, j) && !save.data.cleared[SQ.CHAPTERS[i].levels[j].id]) {
              ci = i;
              li = j;
              break outer;
            }
      }
      this.ci = ci;
      this.li = li;
      this.rects = [];
      this.tabRects = [];
    }
    get pal() {
      return SQ.PALETTES[SQ.CHAPTERS[this.ci].palette];
    }
    update(dt) {
      backdrop.update(dt);
      const n = SQ.CHAPTERS[this.ci].levels.length;
      const prev = [this.ci, this.li];
      if (I.pressed('nav-left')) {
        if (this.li > 0) this.li--;
        else if (this.ci > 0) {
          this.ci--;
          this.li = SQ.CHAPTERS[this.ci].levels.length - 1;
        }
      }
      if (I.pressed('nav-right')) {
        if (this.li < n - 1) this.li++;
        else if (this.ci < SQ.CHAPTERS.length - 1) {
          this.ci++;
          this.li = 0;
        }
      }
      if (I.pressed('nav-up')) {
        if (this.li >= 5) this.li -= 5;
        else if (this.ci > 0) this.ci--;
      }
      if (I.pressed('nav-down')) {
        if (this.li < 5) this.li += 5;
        else if (this.ci < SQ.CHAPTERS.length - 1) this.ci++;
      }
      const m = I.mouse;
      const hit = (r) => m.x >= r[0] && m.x <= r[0] + r[2] && m.y >= r[1] && m.y <= r[1] + r[3];
      this.tabRects.forEach((r, i) => {
        if (hit(r) && (m.moved || m.click)) this.ci = i;
      });
      let clicked = false;
      this.rects.forEach((r, i) => {
        if (hit(r)) {
          if (m.moved) this.li = i;
          if (m.click) {
            this.li = i;
            clicked = true;
          }
        }
      });
      if (prev[0] !== this.ci || prev[1] !== this.li) SQ.audio.play('move');
      if (prev[0] !== this.ci) SQ.audio.music(SQ.CHAPTERS[this.ci].palette);
      if (clicked || (I.pressed('confirm') && !m.click)) {
        if (levelUnlocked(this.ci, this.li)) {
          SQ.audio.play('select');
          SQ.setScreen(new GameScreen({ mode: 'campaign', ci: this.ci, li: this.li }));
        } else SQ.audio.play('denied');
      }
      if (I.pressed('back')) SQ.setScreen(new MainMenu());
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      const ch = SQ.CHAPTERS[this.ci];
      // Chapter tabs.
      this.tabRects = [];
      const tw = 230;
      SQ.CHAPTERS.forEach((c, i) => {
        const x = W / 2 + (i - (SQ.CHAPTERS.length - 1) / 2) * tw;
        const open = levelUnlocked(i, 0);
        const sel = i === this.ci;
        if (sel) {
          ctx.fillStyle = SQ.rgba(pal.border, 0.5);
          ctx.fillRect(x - tw / 2 + 8, 40, tw - 16, 70);
        }
        text(ctx, String(i + 1), x, 62, { size: 18, color: pal.ui, alpha: open ? 0.7 : 0.3 });
        text(ctx, open ? c.name : '· · ·', x, 88, { size: sel ? 26 : 22, color: pal.ui, weight: sel ? 'bold' : 'normal', alpha: open ? 1 : 0.35, spacing: 2 });
        if (chapterDone(i)) SQ.drawing.diamond(ctx, x + tw / 2 - 24, 62, 7, 0, pal.square);
        this.tabRects.push([x - tw / 2, 40, tw, 70]);
      });
      text(ctx, ch.blurb, W / 2, 160, { size: 24, color: pal.ui, alpha: 0.8 });
      // Level grid.
      this.rects = [];
      const cw = 210;
      const chh = 150;
      ch.levels.forEach((lv, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = W / 2 + (col - 2) * (cw + 20);
        const y = 300 + row * (chh + 24);
        const open = levelUnlocked(this.ci, i);
        const sel = i === this.li;
        const done = save.data.cleared[lv.id];
        ctx.fillStyle = SQ.rgba(pal.border, sel ? 0.5 : 0.3);
        ctx.fillRect(x - cw / 2, y - chh / 2, cw, chh);
        if (sel) {
          ctx.strokeStyle = pal.ui;
          ctx.lineWidth = 4;
          ctx.strokeRect(x - cw / 2 - 4, y - chh / 2 - 4, cw + 8, chh + 8);
        }
        text(ctx, lv.id, x, y - 38, { size: 22, color: pal.ui, alpha: open ? 0.7 : 0.3 });
        if (open) {
          text(ctx, lv.name, x, y + 4, { size: lv.name.length > 14 ? 19 : 22, color: pal.ui, weight: 'bold' });
          if (lv.boss) text(ctx, 'BOSS', x, y + 40, { size: 16, color: pal.enemy, weight: 'bold', spacing: 3 });
          else if (done) text(ctx, SQ.fmtTime(save.data.best[lv.id]), x, y + 40, { size: 18, color: pal.ui, alpha: 0.75 });
        } else {
          SQ.drawing.square(ctx, x, y + 10, 26, 0, null, SQ.rgba(pal.ui, 0.35), 3);
        }
        if (done) SQ.drawing.diamond(ctx, x + cw / 2 - 18, y - chh / 2 + 18, 7, 0, pal.square);
        this.rects.push([x - cw / 2, y - chh / 2, cw, chh]);
      });
      const lv = ch.levels[this.li];
      const open = levelUnlocked(this.ci, this.li);
      const info = open
        ? `${lv.name}${save.data.best[lv.id] != null ? '   ·   best ' + SQ.fmtTime(save.data.best[lv.id]) : ''}`
        : 'Locked: clear the level before it.';
      text(ctx, info, W / 2, 700, { size: 26, color: pal.ui });
      const cd = save.data.chapterDeaths[ch.id] || 0;
      text(ctx, `chapter deaths: ${cd}`, W / 2, 745, { size: 20, color: pal.ui, alpha: 0.6 });
      text(ctx, 'arrows / stick to choose  ·  confirm to play  ·  back to return', W / 2, 850, { size: 18, color: pal.ui, alpha: 0.5 });
    }
  }

  // Shared list screen for challenges and arenas.
  class ListScreen {
    constructor(kind, sel = 0) {
      this.kind = kind;
      this.items = kind === 'challenges' ? SQ.CHALLENGES : SQ.ARENAS;
      this.sel = sel;
      this.scroll = 0;
      this.rects = [];
    }
    unlocked(it) {
      if (this.kind !== 'challenges' || it.kind !== 'chapter') return true;
      return isUnlockAll() || chapterDone(it.chapter);
    }
    get pal() {
      return SQ.PALETTES[this.items[this.sel].palette];
    }
    update(dt) {
      backdrop.update(dt);
      const n = this.items.length;
      const prev = this.sel;
      if (I.pressed('nav-up')) this.sel = (this.sel - 1 + n) % n;
      if (I.pressed('nav-down')) this.sel = (this.sel + 1) % n;
      const m = I.mouse;
      let clicked = false;
      this.rects.forEach((r, i) => {
        if (m.x >= r[0] && m.x <= r[0] + r[2] && m.y >= r[1] && m.y <= r[1] + r[3]) {
          if (m.moved) this.sel = i;
          if (m.click) {
            this.sel = i;
            clicked = true;
          }
        }
      });
      if (prev !== this.sel) SQ.audio.play('move');
      if (clicked || (I.pressed('confirm') && !m.click)) {
        const it = this.items[this.sel];
        if (!this.unlocked(it)) return SQ.audio.play('denied');
        SQ.audio.play('select');
        if (this.kind === 'arenas') SQ.setScreen(new GameScreen({ mode: 'arena', arena: it, from: this.sel }));
        else if (it.kind === 'chapter') SQ.setScreen(new GameScreen({ mode: 'chapterRun', ci: it.chapter, li: 0, challenge: it, from: this.sel }));
        else SQ.setScreen(new GameScreen({ mode: 'challenge', challenge: it, from: this.sel }));
      }
      if (I.pressed('back')) SQ.setScreen(new MainMenu());
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      text(ctx, this.kind === 'challenges' ? 'CHALLENGES' : 'ARENAS', W / 2, 70, { size: 48, color: pal.ui, weight: 'bold', spacing: 6 });
      const rowH = 46;
      const visible = 15;
      if (this.sel < this.scroll) this.scroll = this.sel;
      if (this.sel >= this.scroll + visible) this.scroll = this.sel - visible + 1;
      this.rects = [];
      const x0 = 120;
      const wList = 620;
      for (let i = this.scroll; i < Math.min(this.items.length, this.scroll + visible); i++) {
        const it = this.items[i];
        const y = 150 + (i - this.scroll) * rowH;
        const sel = i === this.sel;
        const open = this.unlocked(it);
        if (sel) {
          ctx.fillStyle = SQ.rgba(pal.border, 0.55);
          ctx.fillRect(x0, y - rowH / 2 + 3, wList, rowH - 6);
        }
        this.rects.push([x0, y - rowH / 2, wList, rowH]);
        text(ctx, open ? it.name : it.name + '  (locked)', x0 + 24, y, { size: 24, color: pal.ui, align: 'left', alpha: open ? 1 : 0.4, weight: sel ? 'bold' : 'normal' });
        let right = '';
        if (this.kind === 'challenges') {
          const r = save.data.challenges[it.id];
          if (r && r.done) right = r.best != null ? SQ.fmtTime(r.best) : 'done';
        } else {
          const r = save.data.arenas[it.id];
          if (r) right = 'wave ' + r.wave;
        }
        if (right) text(ctx, right, x0 + wList - 20, y, { size: 20, color: pal.ui, align: 'right', alpha: 0.75 });
      }
      // Detail panel.
      const it = this.items[this.sel];
      const px = 1000;
      ctx.fillStyle = SQ.rgba(pal.border, 0.4);
      ctx.fillRect(px - 180, 150 - rowH / 2, 660, 520);
      text(ctx, it.name, px + 150, 200, { size: 38, color: pal.ui, weight: 'bold' });
      para(ctx, it.desc, px + 150, 270, 560, { size: 24, color: pal.ui, alpha: 0.9 });
      if (this.kind === 'arenas') {
        const r = save.data.arenas[it.id];
        text(ctx, r ? `best wave ${r.wave}  ·  best score ${r.score}` : 'not played yet', px + 150, 420, { size: 22, color: pal.ui, alpha: 0.8 });
        para(ctx, 'Waves keep coming, and every fifth one brings something big. Chain several kills with one launch for bonus points.', px + 150, 490, 560, { size: 20, color: pal.ui, alpha: 0.65 });
      } else {
        const r = save.data.challenges[it.id];
        text(ctx, r && r.done ? 'completed' + (r.best != null ? '  ·  best ' + SQ.fmtTime(r.best) : '') : 'not completed', px + 150, 420, { size: 22, color: pal.ui, alpha: 0.8 });
      }
      text(ctx, 'confirm to play  ·  back to return', W / 2, 850, { size: 18, color: pal.ui, alpha: 0.5 });
    }
  }

  class SettingsScreen {
    constructor(back) {
      this.back = back;
      this.pal = SQ.PALETTES.sand;
      this.confirmReset = false;
      const s = save.settings;
      const toggle = (key, label, after) => ({
        label,
        value: () => (s[key] ? 'ON' : 'OFF'),
        adjust: () => {
          s[key] = !s[key];
          save.write();
          if (after) after();
        },
      });
      this.menu = new Menu([
        toggle('slowMode', 'Slow Mode'),
        toggle('showRange', 'Show Launch Range'),
        toggle('shake', 'Screen Shake'),
        toggle('sfx', 'Sound Effects'),
        toggle('music', 'Music'),
        toggle('timer', 'Show Timer'),
        toggle('unlockAll', 'Unlock Everything'),
        {
          label: () => (this.confirmReset ? 'Really erase progress?' : 'Erase Progress'),
          action: () => {
            if (this.confirmReset) {
              save.reset();
              this.confirmReset = false;
            } else this.confirmReset = true;
          },
        },
        { label: 'Back', action: () => SQ.setScreen(this.back()) },
      ], { onBack: () => SQ.setScreen(this.back()) });
    }
    update(dt) {
      backdrop.update(dt);
      if (this.menu.sel !== 7) this.confirmReset = false;
      this.menu.update();
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      text(ctx, 'SETTINGS', W / 2, 90, { size: 48, color: pal.ui, weight: 'bold', spacing: 6 });
      this.menu.draw(ctx, W / 2, 190, pal, { width: 640, gap: 56, size: 26 });
      const tips = [
        'Slow Mode lowers the square\'s top speed and gives a larger launch buffer. Some enemies move slower too.',
        'Draws your launch range around the circle.',
        '', '', '', 'Shows the level timer in the corner.',
        'Opens every level, chapter and challenge.',
      ];
      const tip = tips[this.menu.sel];
      if (tip) para(ctx, tip, W / 2, 720, 900, { size: 20, color: pal.ui, alpha: 0.7 });
    }
  }

  class InfoScreen {
    constructor(kind) {
      this.kind = kind;
      this.pal = SQ.PALETTES[kind === 'how' ? 'dusk' : 'tide'];
    }
    update(dt) {
      backdrop.update(dt);
      if (I.pressed('back') || I.pressed('confirm')) SQ.setScreen(new MainMenu());
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      if (this.kind === 'how') {
        text(ctx, 'HOW TO PLAY', W / 2, 70, { size: 46, color: pal.ui, weight: 'bold', spacing: 6 });
        const lines = [
          ['MOVE', 'WASD / arrows / left stick'],
          ['LAUNCH', 'Left-click sends the square toward the cursor. Space, J, Z, A or RB push it straight away from you. Only works when the square is near you, and it flies harder the closer it is.'],
          ['RECALL', 'Shift, K or X / right-click / B or LB. The square speeds up toward you until it arrives, so launch it away before it hits you.'],
          ['RESTART', 'R / Y'],
          ['PAUSE', 'Esc or P / Start'],
        ];
        let y = 150;
        for (const [k, v] of lines) {
          text(ctx, k, 260, y, { size: 24, color: pal.square, weight: 'bold', align: 'left' });
          y += para(ctx, v, 460, y, 900, { size: 22, color: pal.ui, align: 'left' }) + 10;
        }
        y += 20;
        para(ctx, 'A fast square kills enemies and kills you. A slow one is harmless: walk into it to nudge it. Your circle lights up when the square is in launch range. Clear every enemy to finish a level.', W / 2, y, 1100, { size: 22, color: pal.ui, alpha: 0.9 });
        para(ctx, 'Shields block one side. Cores hide behind their nodes. Wardens drain speed. Armor needs a point-blank launch. Cracked shapes split. Phantoms flicker. Dashers telegraph a straight lunge. Wells bend the square, portals move it, bumpers boost it, switches open doors.', W / 2, y + 120, 1100, { size: 20, color: pal.ui, alpha: 0.75 });
      } else {
        text(ctx, 'CREDITS', W / 2, 110, { size: 46, color: pal.ui, weight: 'bold', spacing: 6 });
        const rows = [
          ['(square)', 'design & development by Brennan Cottrell (Wrimor)'],
          ['original sound & music', 'Brett Boyd'],
          ['original trailer', 'Chase Burden'],
          ['extended edition', 'new chapters, bosses, challenges and arenas built on the original\'s rules. Synthesised audio.'],
          ['inspired by', 'Octarena (Galakrond), THOTH (Carlsten Games), qomp (Stuffed Wombat)'],
        ];
        let y = 220;
        for (const [k, v] of rows) {
          text(ctx, k, W / 2, y, { size: 22, color: pal.square, weight: 'bold' });
          y += 34;
          y += para(ctx, v, W / 2, y, 1000, { size: 22, color: pal.ui }) + 26;
        }
      }
      text(ctx, 'back to return', W / 2, 860, { size: 18, color: pal.ui, alpha: 0.5 });
    }
  }

  class ResultScreen {
    constructor(o) {
      this.o = o;
      this.pal = SQ.PALETTES[o.palette || 'sand'];
      this.t = 0;
      this.menu = new Menu(o.items, { onBack: o.items[o.items.length - 1].action });
    }
    update(dt) {
      this.t += dt;
      backdrop.update(dt);
      if (this.t > 0.4) this.menu.update();
    }
    draw(ctx) {
      const pal = this.pal;
      backdrop.draw(ctx, pal);
      text(ctx, this.o.title, W / 2, 170, { size: 64, color: pal.ui, weight: 'bold', spacing: 6 });
      let y = 270;
      for (const l of this.o.lines || []) {
        y += para(ctx, l, W / 2, y, 1100, { size: 26, color: pal.ui, alpha: 0.9 }) + 8;
      }
      this.menu.draw(ctx, W / 2, Math.max(y + 60, 560), pal);
    }
  }

  // ------------------------------------------------------------- the game
  class GameScreen {
    constructor(cfg) {
      this.cfg = cfg;
      this.deaths = 0;
      this.paused = false;
      this.runTime = 0;
      this.loadCurrent();
    }
    currentDef() {
      const c = this.cfg;
      if (c.mode === 'campaign' || c.mode === 'chapterRun') return SQ.CHAPTERS[c.ci].levels[c.li];
      if (c.mode === 'challenge') return c.challenge;
      const a = c.arena;
      return { name: a.name, palette: a.palette, p: [800, 450], s: [870, 450], walls: a.walls, hazards: a.hazards, enemies: [], mods: a.mods };
    }
    loadCurrent() {
      const def = this.currentDef();
      const opts = {};
      if (this.cfg.mode === 'arena') opts.spawner = SQ.makeWaveSpawner(this.cfg.arena);
      this.world = new SQ.World(def, opts);
      this.intro = 0;
      SQ.audio.music(this.world.palKey);
    }
    get pal() {
      return this.world.pal;
    }
    pause() {
      this.paused = true;
      const quit = () => SQ.setScreen(this.backScreen());
      const s = save.settings;
      this.pmenu = new Menu([
        { label: 'Resume', action: () => (this.paused = false) },
        { label: 'Restart', action: () => this.restart(false) },
        {
          label: 'Slow Mode', value: () => (s.slowMode ? 'ON' : 'OFF'),
          adjust: () => {
            s.slowMode = !s.slowMode;
            save.write();
          },
        },
        {
          label: 'Show Range', value: () => (s.showRange ? 'ON' : 'OFF'),
          adjust: () => {
            s.showRange = !s.showRange;
            save.write();
          },
        },
        {
          label: 'Music', value: () => (s.music ? 'ON' : 'OFF'),
          adjust: () => {
            s.music = !s.music;
            save.write();
          },
        },
        { label: 'Quit', action: quit },
      ], { onBack: () => (this.paused = false) });
    }
    backScreen() {
      const c = this.cfg;
      if (c.mode === 'campaign') return new CampaignScreen(c.ci, c.li);
      if (c.mode === 'arena') return new ListScreen('arenas', c.from || 0);
      return new ListScreen('challenges', c.from || 0);
    }
    restart(isDeath) {
      this.paused = false;
      if (this.cfg.mode === 'arena' && isDeath) return this.arenaOver();
      if (this.cfg.mode === 'chapterRun' && isDeath && this.cfg.li > 0) {
        this.cfg.li = 0;
        this.runTime = 0;
        this.loadCurrent();
        this.world.toast('back to the start', this.world.player.x, this.world.player.y - 60);
        return;
      }
      if (this.cfg.mode === 'arena') return this.loadCurrent();
      // Rebuild the world so settings changed in the pause menu apply.
      const intro = this.intro;
      this.loadCurrent();
      this.intro = Math.max(intro, 3);
    }
    update(dt) {
      backdrop.update(dt);
      if (this.paused) {
        this.pmenu.update();
        if (I.pressed('pause') && this.paused) this.paused = false;
        return;
      }
      if (I.pressed('pause')) {
        SQ.audio.play('move');
        return this.pause();
      }
      const w = this.world;
      if (I.pressed('restart') && w.state !== 'clear') {
        if (w.state === 'play' && this.cfg.mode !== 'arena') return this.restart(false);
        if (w.state === 'dead') return this.onDeath();
      }
      w.frame(dt, I);
      this.intro += dt;
      if (w.state === 'dead' && (w.stateT > 1.0 || (w.stateT > 0.3 && I.pressed('launch')))) this.onDeath();
      if (w.state === 'clear' && w.stateT > 1.1) this.onClear();
    }
    onDeath() {
      this.deaths++;
      const c = this.cfg;
      if (c.mode === 'campaign' || c.mode === 'chapterRun') save.addDeath(SQ.CHAPTERS[c.ci].id);
      else save.addDeath(null);
      this.restart(true);
    }
    arenaOver() {
      const a = this.cfg.arena;
      const sp = this.world.spawner;
      const prev = save.data.arenas[a.id] || { wave: 0, score: 0 };
      const rec = sp.score > prev.score;
      save.data.arenas[a.id] = { wave: Math.max(prev.wave, sp.wave), score: Math.max(prev.score, sp.score) };
      save.write();
      SQ.setScreen(new ResultScreen({
        title: 'GAME OVER',
        palette: a.palette,
        lines: [`${a.name}`, `wave ${sp.wave}  ·  score ${sp.score}  ·  ${this.world.kills} kills`, rec ? 'new best!' : `best: wave ${save.data.arenas[a.id].wave}, score ${save.data.arenas[a.id].score}`],
        items: [
          { label: 'Try Again', action: () => SQ.setScreen(new GameScreen(this.cfg)) },
          { label: 'Arenas', action: () => SQ.setScreen(new ListScreen('arenas', this.cfg.from || 0)) },
        ],
      }));
    }
    onClear() {
      const c = this.cfg;
      const w = this.world;
      if (c.mode === 'campaign') {
        const lv = SQ.CHAPTERS[c.ci].levels[c.li];
        save.levelCleared(lv.id, w.clearTime);
        if (c.li < SQ.CHAPTERS[c.ci].levels.length - 1) {
          c.li++;
          return this.loadCurrent();
        }
        return this.chapterComplete();
      }
      if (c.mode === 'chapterRun') {
        this.runTime += w.clearTime;
        if (c.li < SQ.CHAPTERS[c.ci].levels.length - 1) {
          c.li++;
          return this.loadCurrent();
        }
        const r = save.data.challenges[c.challenge.id] || {};
        save.data.challenges[c.challenge.id] = { done: true, best: r.best == null ? this.runTime : Math.min(r.best, this.runTime) };
        save.write();
        return SQ.setScreen(new ResultScreen({
          title: 'DEATHLESS',
          palette: SQ.CHAPTERS[c.ci].palette,
          lines: [`${SQ.CHAPTERS[c.ci].name} without a single death.`, `time ${SQ.fmtTime(this.runTime)}`],
          items: [{ label: 'Challenges', action: () => SQ.setScreen(new ListScreen('challenges', c.from || 0)) }],
        }));
      }
      if (c.mode === 'challenge') {
        const ch = c.challenge;
        const r = save.data.challenges[ch.id] || {};
        const best = r.best == null ? w.clearTime : Math.min(r.best, w.clearTime);
        save.data.challenges[ch.id] = { done: true, best };
        save.write();
        return SQ.setScreen(new ResultScreen({
          title: 'CLEAR',
          palette: ch.palette,
          lines: [ch.name, `time ${SQ.fmtTime(w.clearTime)}  ·  best ${SQ.fmtTime(best)}  ·  ${this.deaths} deaths`],
          items: [
            { label: 'Retry', action: () => SQ.setScreen(new GameScreen({ mode: 'challenge', challenge: ch, from: c.from })) },
            { label: 'Challenges', action: () => SQ.setScreen(new ListScreen('challenges', c.from || 0)) },
          ],
        }));
      }
    }
    chapterComplete() {
      const c = this.cfg;
      const ch = SQ.CHAPTERS[c.ci];
      const last = c.ci === SQ.CHAPTERS.length - 1;
      const total = ch.levels.reduce((a, l) => a + (save.data.best[l.id] || 0), 0);
      if (last) {
        save.data.finished = true;
        save.write();
        return SQ.setScreen(new ResultScreen({
          title: 'THE END',
          palette: 'mono',
          lines: [
            'The other circle is gone. The square comes home, slowly, and does not hurt you.',
            `Sum of best times ${SQ.fmtTime(total)}  ·  ${save.data.deaths} deaths in all.`,
            'Chapter Deathless challenges are waiting, and the arenas never end.',
          ],
          items: [
            { label: 'Challenges', action: () => SQ.setScreen(new ListScreen('challenges')) },
            { label: 'Main Menu', action: () => SQ.setScreen(new MainMenu()) },
          ],
        }));
      }
      SQ.setScreen(new ResultScreen({
        title: `CHAPTER ${c.ci + 1} COMPLETE`,
        palette: ch.palette,
        lines: [ch.name, `sum of best times ${SQ.fmtTime(total)}  ·  ${save.data.chapterDeaths[ch.id] || 0} deaths`, `Unlocked: Chapter ${c.ci + 2}, ${SQ.CHAPTERS[c.ci + 1].name}, and the ${ch.name} Deathless challenge.`],
        items: [
          { label: 'Next Chapter', action: () => SQ.setScreen(new GameScreen({ mode: 'campaign', ci: c.ci + 1, li: 0 })) },
          { label: 'Level Select', action: () => SQ.setScreen(new CampaignScreen(c.ci + 1, 0)) },
        ],
      }));
    }
    draw(ctx) {
      const w = this.world;
      const pal = w.pal;
      w.draw(ctx);
      this.drawHud(ctx);
      if (this.paused) {
        // Fixed dark overlay so every palette (including the light one) reads.
        const pp = { ui: '#f2eee6', square: '#f2eee6', border: '#000000' };
        ctx.fillStyle = 'rgba(12,12,16,0.8)';
        ctx.fillRect(-SQ.BORDER, -SQ.BORDER, W + SQ.BORDER * 2, H + SQ.BORDER * 2);
        text(ctx, 'PAUSED', W / 2, 180, { size: 56, color: pp.ui, weight: 'bold', spacing: 8 });
        this.pmenu.draw(ctx, W / 2, 300, pp, { width: 560 });
      }
    }
    drawHud(ctx) {
      const w = this.world;
      const pal = w.pal;
      const c = this.cfg;
      const def = this.currentDef();
      const top = -SQ.BORDER / 2;
      const hudCol = SQ.mix(pal.border, '#ffffff', 0.6);
      let label = def.name;
      if (c.mode === 'campaign' || c.mode === 'chapterRun') label = `${def.id}  ${def.name}`;
      text(ctx, label, 6, top, { size: 20, color: hudCol, align: 'left' });
      const right = [];
      if (c.mode === 'arena') right.push(`wave ${w.spawner.wave}`, `score ${w.spawner.score}`);
      else {
        if (save.settings.timer) right.push(SQ.fmtTime(w.state === 'clear' ? w.clearTime : w.t));
        right.push(`deaths ${this.deaths}`);
      }
      if (save.settings.slowMode) right.unshift('slow');
      text(ctx, right.join('   '), W - 6, top, { size: 20, color: hudCol, align: 'right' });
      // Rule reminders.
      const m = w.mods;
      const notes = [];
      if (m.maxLaunches != null) notes.push(`launches ${Math.max(0, m.maxLaunches - w.launches)}`);
      if (m.timeLimit) notes.push(`time ${Math.max(0, m.timeLimit - w.t).toFixed(1)}`);
      if (m.noRecall) notes.push('no recall');
      if (m.ricochet) notes.push('bounce first');
      if (m.maxBounces != null) notes.push(`shatters after ${m.maxBounces} bounces`);
      if (c.mode === 'chapterRun') notes.push('deathless run');
      if (notes.length) text(ctx, notes.join('   ·   '), W / 2, top, { size: 20, color: hudCol });
      // Boss bar.
      const boss = w.enemies.find((e) => e.alive && e.boss && e.maxHp);
      if (boss) {
        const bw = 420;
        text(ctx, boss.name, W / 2, 34, { size: 18, color: pal.ui, weight: 'bold', spacing: 4, alpha: 0.85 });
        ctx.fillStyle = SQ.rgba(pal.ui, 0.18);
        ctx.fillRect(W / 2 - bw / 2, 50, bw, 8);
        ctx.fillStyle = pal.enemy;
        ctx.fillRect(W / 2 - bw / 2, 50, (bw * Math.max(0, boss.hp)) / boss.maxHp, 8);
      }
      // Level title card.
      if (this.intro < 2.2 && c.mode !== 'arena') {
        const a = this.intro < 1.4 ? 1 : 1 - (this.intro - 1.4) / 0.8;
        text(ctx, def.name, W / 2, H / 2 - 160, { size: 56, color: pal.ui, weight: 'bold', alpha: a * 0.85, spacing: 3 });
        if (def.id) text(ctx, def.id, W / 2, H / 2 - 215, { size: 22, color: pal.ui, alpha: a * 0.6 });
        if (def.desc) text(ctx, def.desc, W / 2, H / 2 - 110, { size: 24, color: pal.ui, alpha: a * 0.8 });
      }
      if (def.hint && c.mode !== 'arena') {
        const lines = wrap(ctx, fillHint(def.hint), 1100, 22);
        lines.forEach((l, i) => text(ctx, l, W / 2, H - 34 - (lines.length - 1 - i) * 30, { size: 22, color: pal.ui, alpha: 0.75 }));
      }
      if (w.state === 'dead') {
        const a = SQ.clamp(w.stateT * 3, 0, 1);
        text(ctx, w.failReason, W / 2, H / 2, { size: 30, color: pal.ui, alpha: a * 0.8 });
      }
      if (w.state === 'clear') {
        const a = SQ.clamp(w.stateT * 3, 0, 1);
        text(ctx, 'clear', W / 2, H / 2, { size: 40, color: pal.ui, alpha: a * 0.85, weight: 'bold', spacing: 10 });
      }
    }
  }

  SQ.screens = { TitleScreen, MainMenu, CampaignScreen, ListScreen, SettingsScreen, InfoScreen, ResultScreen, GameScreen };
})();
