// Browser smoke test: loads the game in headless Chromium, walks the menus,
// opens a selection of levels and saves screenshots. Fails on any page error.
// Usage: node tools/smoke.js [outDir] [levelId ...]
'use strict';
const path = require('path');
const fs = require('fs');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  ({ chromium } = require(path.join(process.execPath, '..', '..', 'lib', 'node_modules', 'playwright')));
}

(async () => {
  const out = process.argv[2] || path.join(__dirname, '..', 'shots');
  const ids = process.argv.slice(3);
  fs.mkdirSync(out, { recursive: true });
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {}).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1280, height: 750 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack || String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'title.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'menu.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'campaign.png') });

  const levels = ids.length ? ids : ['1-1', '1-4', '1-10', '2-5', '3-4', '4-7', '5-10', '6-10'];
  for (const id of levels) {
    await page.evaluate((id) => {
      const [c, l] = id.split('-').map(Number);
      SQ.setScreen(new SQ.screens.GameScreen({ mode: 'campaign', ci: c - 1, li: l - 1 }));
    }, id);
    // Launch toward the first enemy-ish direction and let things move.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(250);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.press('Space');
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(out, 'level-' + id + '.png') });
  }
  for (const [kind, i] of [['challenges', 0], ['arenas', 3]]) {
    await page.evaluate(([kind, i]) => SQ.setScreen(new SQ.screens.ListScreen(kind, i)), [kind, i]);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, kind + '.png') });
  }
  await page.evaluate(() => SQ.setScreen(new SQ.screens.GameScreen({ mode: 'arena', arena: SQ.ARENAS[3] })));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(out, 'arena.png') });
  await browser.close();
  if (errors.length) {
    console.log('PAGE ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('smoke OK, screenshots in ' + out);
})();
