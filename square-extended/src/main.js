// Canvas setup and the main loop.
'use strict';
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const B = SQ.BORDER;
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

  // Map window pixels to arena coordinates.
  view.toLogical = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return { x: (cx - r.left - view.ox) / view.scale, y: (cy - r.top - view.oy) / view.scale };
  };
  SQ.view = view;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    view.dpr = dpr;
    const fw = SQ.W + B * 2;
    const fh = SQ.H + B * 2;
    view.scale = Math.min(cw / fw, ch / fh);
    // Offset of arena (0,0) in CSS pixels.
    view.ox = (cw - fw * view.scale) / 2 + B * view.scale;
    view.oy = (ch - fh * view.scale) / 2 + B * view.scale;
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    SQ.input.poll(dt);
    const scr = SQ.getScreen();
    scr.update(dt);
    const cur = SQ.getScreen();
    const pal = cur.pal || SQ.PALETTES.sand;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pal.border;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
    cur.draw(ctx);
    SQ.input.endFrame();
    requestAnimationFrame(frame);
  };

  SQ.setScreen(new SQ.screens.TitleScreen());
  requestAnimationFrame(frame);
})();
