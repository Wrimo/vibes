// Bundles index.html and every src/*.js it references into one self-contained
// HTML file (handy for sharing or a single-file upload).
// Usage: node tools/bundle.js [out=dist/square-extended.html] [--fragment]
//   --fragment  omit the <!doctype>/<html>/<head>/<body> wrapper, for hosts
//               that supply their own document skeleton.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(root, 'dist', 'square-extended.html');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts
  .map((src) => `// ---- ${src}\n` + fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script'))
  .join('\n');
const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const body = `<canvas id="game" tabindex="0"></canvas>\n<script>\n${js}\n</script>\n`;

const doc = fragment
  ? `${title}\n${style}\n${body}`
  : `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n${title}\n${style}\n</head>\n<body>\n${body}</body>\n</html>\n`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, doc);
console.log(`wrote ${out} (${(doc.length / 1024).toFixed(0)} KB, ${scripts.length} scripts)`);
