// Builds .out/preview.html — a self-contained copy of the app that runs offline.
// Firebase is stubbed, the CDN libraries are replaced with local copies, and
// Tailwind is compiled from the app's own markup.
//
// Two details matter or the preview will quietly lie to you:
//   * it uses the app's REAL <style> block, not a hand-copied subset
//   * it applies the app's REAL <body> classes (bg-slate-100 min-h-screen)
// Both have hidden real bugs before — see dev/README.md.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '.out');
const R = p => fs.readFileSync(p, 'utf8');

fs.mkdirSync(OUT, { recursive: true });

const src = R(path.join(ROOT, 'pipeline-tool-v2.html'));
const appCss = (src.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const bodyClass = (src.match(/<body class="([^"]*)"/) || [, ''])[1];

// Tailwind, compiled against the app's own classes
fs.writeFileSync(path.join(OUT, 'in.css'), '@tailwind base;@tailwind components;@tailwind utilities;');
execFileSync('npx', ['tailwindcss', '-i', path.join(OUT, 'in.css'), '-o', path.join(OUT, 'tw.css'),
  '--content', path.join(ROOT, 'pipeline-tool-v2.html'), '--minify'],
  { cwd: __dirname, stdio: ['ignore', 'ignore', 'inherit'] });

// Optional: your own Backup & Restore export. Gitignored — see dev/README.md.
const samplePath = path.join(__dirname, 'sample-data.json');
const sample = fs.existsSync(samplePath) ? R(samplePath) : 'null';
if (sample === 'null') console.log('note: no dev/sample-data.json — falling back to the app\'s seed data');

const stub = `
(function(){
  var _data;
  try { _data = JSON.parse(localStorage.getItem('__stub_db')||'null'); } catch(e) { _data=null; }
  if (!_data) _data = { presence:{u1:{email:'you@langara.ca',displayName:'You',online:true}},
                        pipeline: window.__SAMPLE__ || undefined };
  function persist(){ try { localStorage.setItem('__stub_db', JSON.stringify(_data)); } catch(e){} }
  function refFor(path){ return {
    get:function(){ return Promise.resolve({ exists:function(){return path in _data && _data[path]!==undefined},
                                             val:function(){return _data[path]} }); },
    set:function(v){ _data[path]=v; persist(); return Promise.resolve(); },
    remove:function(){ delete _data[path]; persist(); return Promise.resolve(); },
    onDisconnect:function(){ return { remove:function(){ return Promise.resolve(); } }; },
    on:function(ev,cb){ cb({ val:function(){ return _data[path]; } }); return cb; },
    off:function(){}
  }; }
  window.firebase = {
    initializeApp:function(){ return {}; },
    database: Object.assign(function(){ return { ref: refFor }; }, { ServerValue:{ TIMESTAMP:0 } }),
    auth:function(){ return {
      onAuthStateChanged:function(cb){ cb({uid:'u1',email:'you@langara.ca',displayName:'You'}); return function(){}; },
      signOut:function(){ return Promise.resolve(); }
    }; }
  };
})();`;

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<title>CS Pipeline Tool — local preview</title>
<style>${R(path.join(OUT, 'tw.css'))}</style>
<style>${appCss}</style>
<style>
  body { display:flex; flex-direction:column; height:100vh; overflow:hidden; }
  #previewbar { flex:0 0 auto; }
  #approot { flex:1 1 auto; min-height:0; }
  #approot > div { height:100%; }
  #approot .h-screen { height:100%; }
  @media print { #previewbar{display:none!important} body{display:block;height:auto;overflow:visible} }
</style>
</head>
<body class="${bodyClass}">
<div id="previewbar" style="background:#1e293b;color:#cbd5e1;font:400 12px/1.5 system-ui,sans-serif;padding:9px 16px">
  <strong style="color:#fff;font-weight:600">Local preview</strong>
  &nbsp;Firebase is stubbed — nothing here is saved or shared.
</div>
<div id="approot"><div id="root"></div></div>
<script>window.__SAMPLE__ = ${sample};</script>
<script>${R(path.join(__dirname, 'node_modules/react/umd/react.production.min.js'))}<\/script>
<script>${R(path.join(__dirname, 'node_modules/react-dom/umd/react-dom.production.min.js'))}<\/script>
<script>${stub}<\/script>
<script>${R(path.join(OUT, 'app.js'))}<\/script>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'preview.html'), html);
console.log(`preview.html written (${(html.length / 1024).toFixed(0)} KB) — dev/.out/preview.html`);
