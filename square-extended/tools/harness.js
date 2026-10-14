// Loads the game's simulation scripts into Node (no DOM) so levels can be
// validated and simulated headlessly. Rendering/UI scripts are skipped.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadGame() {
  const noop = () => {};
  const sandbox = {
    console,
    Math,
    performance: { now: () => Date.now() },
    navigator: {},
    addEventListener: noop,
    document: { createElement: () => ({ getContext: () => null }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const src = path.join(__dirname, '..', 'src');
  for (const f of ['util', 'palettes', 'save', 'input', 'audio', 'world', 'draw', 'enemies', 'levels', 'modes']) {
    vm.runInContext(fs.readFileSync(path.join(src, f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
  }
  return sandbox.SQ;
}

// Every playable level definition with a label.
function allLevels(SQ) {
  const out = [];
  for (const ch of SQ.CHAPTERS) for (const lv of ch.levels) out.push({ label: lv.id + ' ' + lv.name, def: lv });
  for (const c of SQ.CHALLENGES) if (c.kind === 'level') out.push({ label: 'challenge ' + c.name, def: c });
  return out;
}

module.exports = { loadGame, allLevels };
