// Keyboard, mouse and gamepad input, folded into a small set of actions.
'use strict';
SQ.input = (() => {
  const down = new Set();
  const pressedQ = new Set(); // actions pressed since last frame
  let mouse = { x: 0, y: 0, moved: false, click: false, active: false, aim: null };
  let usingPad = false;

  const KEYMAP = {
    launch: ['Space', 'KeyJ', 'KeyZ'],
    recall: ['ShiftLeft', 'ShiftRight', 'KeyK', 'KeyX'],
    restart: ['KeyR'],
    pause: ['Escape', 'KeyP'],
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    confirm: ['Enter', 'Space', 'KeyJ', 'KeyZ'],
    back: ['Escape', 'Backspace', 'KeyX'],
  };
  const codeToActions = {};
  for (const [act, codes] of Object.entries(KEYMAP))
    for (const c of codes) (codeToActions[c] = codeToActions[c] || []).push(act);

  const press = (act) => pressedQ.add(act);

  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      // Allow held menu navigation to repeat, nothing else.
      const acts = codeToActions[e.code] || [];
      if (acts.some((a) => ['up', 'down', 'left', 'right'].includes(a))) acts.forEach(press);
      e.preventDefault();
      return;
    }
    usingPad = false;
    down.add(e.code);
    (codeToActions[e.code] || []).forEach(press);
    press('any');
    if (codeToActions[e.code] || e.code.startsWith('Arrow') || e.code === 'Tab') e.preventDefault();
    SQ.audio && SQ.audio.unlock();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());

  const toLogical = (e) => {
    const r = SQ.view && SQ.view.toLogical(e.clientX, e.clientY);
    if (r) {
      mouse.x = r.x;
      mouse.y = r.y;
    }
  };
  window.addEventListener('mousemove', (e) => {
    toLogical(e);
    mouse.moved = true;
    mouse.active = true;
  });
  window.addEventListener('mousedown', (e) => {
    toLogical(e);
    usingPad = false;
    SQ.audio && SQ.audio.unlock();
    if (e.button === 0) {
      press('launch');
      mouse.click = true;
      mouse.active = true;
      mouse.aim = { x: mouse.x, y: mouse.y };
    }
    if (e.button === 2) press('recall');
    press('any');
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // Gamepad: poll each frame and turn button edges into actions.
  const padPrev = {};
  const PADMAP = {
    0: ['launch', 'confirm'],
    1: ['recall', 'back'],
    2: ['recall'],
    3: ['restart'],
    4: ['recall'],
    5: ['launch'],
    6: ['recall'],
    7: ['launch'],
    8: ['back'],
    9: ['pause'],
    12: ['up'],
    13: ['down'],
    14: ['left'],
    15: ['right'],
  };
  let padAxes = { x: 0, y: 0 };
  let stickRepeat = 0;
  let stickDir = '';
  const pollPad = (dt) => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    padAxes = { x: 0, y: 0 };
    for (const p of pads) {
      if (!p) continue;
      p.buttons.forEach((b, i) => {
        const pressed = b.pressed || b.value > 0.5;
        const k = p.index + ':' + i;
        if (pressed && !padPrev[k]) {
          usingPad = true;
          mouse.active = false;
          (PADMAP[i] || []).forEach(press);
          press('any');
          SQ.audio && SQ.audio.unlock();
        }
        padPrev[k] = pressed;
      });
      const ax = p.axes[0] || 0;
      const ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.2) {
        padAxes = { x: ax, y: ay };
        usingPad = true;
      }
      // Dpad held also moves.
      if (p.buttons[12] && p.buttons[12].pressed) padAxes.y = -1;
      if (p.buttons[13] && p.buttons[13].pressed) padAxes.y = 1;
      if (p.buttons[14] && p.buttons[14].pressed) padAxes.x = -1;
      if (p.buttons[15] && p.buttons[15].pressed) padAxes.x = 1;
    }
    // Stick as menu navigation with repeat.
    let dir = '';
    if (Math.abs(padAxes.y) > 0.6) dir = padAxes.y < 0 ? 'up' : 'down';
    else if (Math.abs(padAxes.x) > 0.6) dir = padAxes.x < 0 ? 'left' : 'right';
    if (dir && dir !== stickDir) {
      press('menu-' + dir);
      stickRepeat = 0.35;
    } else if (dir) {
      stickRepeat -= dt;
      if (stickRepeat <= 0) {
        press('menu-' + dir);
        stickRepeat = 0.12;
      }
    }
    stickDir = dir;
  };

  let frame = new Set();
  return {
    mouse,
    get usingPad() {
      return usingPad;
    },
    // Call once at the start of every frame.
    poll(dt) {
      pollPad(dt);
      frame = new Set(pressedQ);
      // Stick navigation only counts for menus.
      for (const d of ['up', 'down', 'left', 'right']) if (frame.has('menu-' + d)) frame.add('nav-' + d);
      for (const d of ['up', 'down', 'left', 'right']) if (frame.has(d)) frame.add('nav-' + d);
      pressedQ.clear();
      mouse.click = mouse.click && frame.has('launch');
    },
    endFrame() {
      mouse.moved = false;
      mouse.click = false;
      mouse.aim = null;
    },
    // Where a click this frame asked the square to go, or null for a
    // keyboard/gamepad launch (which pushes the square straight away).
    launchAim() {
      return frame.has('launch') && mouse.aim ? { x: mouse.aim.x, y: mouse.aim.y } : null;
    },
    pressed(act) {
      return frame.has(act);
    },
    consume(act) {
      frame.delete(act);
    },
    held(act) {
      return (KEYMAP[act] || []).some((c) => down.has(c));
    },
    move() {
      let x = 0;
      let y = 0;
      if (this.held('left')) x -= 1;
      if (this.held('right')) x += 1;
      if (this.held('up')) y -= 1;
      if (this.held('down')) y += 1;
      if (Math.hypot(padAxes.x, padAxes.y) > 0.2) {
        x += padAxes.x;
        y += padAxes.y;
      }
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
      return { x, y };
    },
  };
})();
