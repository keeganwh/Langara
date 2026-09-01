// Transpiles the app's inline <script type="text/babel"> with the SAME pinned
// Babel the browser uses, so a syntax or transform error shows up here instead
// of as a blank page in production.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/standalone');

const APP = path.join(__dirname, '..', 'pipeline-tool-v2.html');
const OUT = path.join(__dirname, '.out');

const src = fs.readFileSync(APP, 'utf8');
const m = src.match(/<script type="text\/babel">([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) { console.error('Could not find the app script block in pipeline-tool-v2.html'); process.exit(1); }

let code;
try {
  code = babel.transform(m[1], { presets: ['react'] }).code;
} catch (e) {
  console.error('BABEL ERROR — this would be a blank page in the browser:\n');
  console.error(e.message);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'app.js'), code);
console.log(`transpiled OK (${(code.length / 1024).toFixed(0)} KB)`);
