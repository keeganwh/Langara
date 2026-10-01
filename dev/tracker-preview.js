// Builds .out/tracker.html — an offline copy of tracker.html, the same way
// preview.js does for the Workflow Map: the real <style> block, the real
// <body> classes, local libraries, Tailwind compiled from the page's markup.
//
// The Firebase stub here is a small nested tree with live listeners, because
// the tracker (unlike the map) writes to narrow paths with update()/push()
// and renders from on('value') listeners.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/standalone');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, '.out');
const R = p => fs.readFileSync(p, 'utf8');
fs.mkdirSync(OUT, { recursive: true });

const src = R(path.join(ROOT, 'tracker.html'));
const m = src.match(/<script type="text\/babel">([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) { console.error('Could not find the script block in tracker.html'); process.exit(1); }
let code;
try { code = babel.transform(m[1], { presets: ['react'] }).code; }
catch (e) { console.error('BABEL ERROR — this would be a blank page in the browser:\n\n' + e.message); process.exit(1); }
console.log(`tracker transpiled OK (${(code.length / 1024).toFixed(0)} KB)`);

const appCss = (src.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const bodyClass = (src.match(/<body class="([^"]*)"/) || [, ''])[1];

fs.writeFileSync(path.join(OUT, 'in.css'), '@tailwind base;@tailwind components;@tailwind utilities;');
// The page remaps Tailwind colours in a <script id="tw-brand"> block for the
// CDN build; compile the preview with the same theme so it looks the same.
const brand = (src.match(/<script id="tw-brand">([\s\S]*?)<\/script>/) || [, ''])[1];
const theme = brand ? new Function('const tailwind = {}; ' + brand + '; return tailwind.config.theme;')() : {};
fs.writeFileSync(path.join(OUT, 'tw-tracker.config.js'), 'module.exports = ' + JSON.stringify({ content: [path.join(ROOT, 'tracker.html')], theme }) + ';');
execFileSync('npx', ['tailwindcss', '-c', path.join(OUT, 'tw-tracker.config.js'), '-i', path.join(OUT, 'in.css'), '-o', path.join(OUT, 'tw-tracker.css'),
  '--minify'], { cwd: __dirname, stdio: ['ignore', 'ignore', 'inherit'] });

// The map the tracker reads. Your own export if present, else a small fixture
// with a shared meeting (sync group) across two documents.
const samplePath = path.join(__dirname, 'sample-data.json');
const fixture = {
  roles: [{ id: 'r1', label: 'PC' }, { id: 'r2', label: 'CS Admin' }, { id: 'r3', label: 'Dean' }],
  syncGroupMeta: { g1: { name: 'JCCS Oct', color: '#f59e0b' } },
  projectTypes: [{ id: 'wf1', name: 'New Program', documents: [
    { id: 'd1', name: 'Concept Paper', color: '#6366f1', steps: [
      { id: 's1', stageName: 'Draft', presenterIds: ['r1'], notes: 'Use the 2026 template.', storageLocation: 'CS SharePoint', actions: [{ id: 'a1', type: 'prepared_by', label: 'Prepared by', person: 'PC' }, { id: 'a2', type: 'review', label: 'Reviewed by', person: 'Director' }] },
      { id: 's2', stageName: 'Dean Review', presenterIds: ['r3'] },
      { id: 's3', stageName: 'JCCS', presenterIds: ['r2'], syncGroupId: 'g1', triggerType: 'scheduled_meeting' },
      { id: 's4', stageName: 'EDCO' } ] },
    { id: 'd2', name: 'Program Proposal', color: '#10b981', steps: [
      { id: 't1', stageName: 'Draft', presenterIds: ['r1'] },
      { id: 't3', stageName: 'JCCS', presenterIds: ['r2'], syncGroupId: 'g1', triggerType: 'scheduled_meeting' },
      { id: 't4', stageName: 'EDCO' } ] } ] }],
};
const sample = fs.existsSync(samplePath) ? R(samplePath) : JSON.stringify(fixture);

const stub = `
(function(){
  var KEY='__stub_trk';
  var db; try { db = JSON.parse(localStorage.getItem(KEY)||'null'); } catch(e) { db=null; }
  if (!db) db = { pipeline: window.__SAMPLE__, tracker: {} };
  var listeners = [];
  var parts = function(p){ return String(p).split('/').filter(Boolean); };
  var clone = function(v){ return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  function get(p){ var n=db; var ps=parts(p); for (var i=0;i<ps.length;i++){ if (n==null||typeof n!=='object') return null; n=n[ps[i]]; } return n===undefined?null:n; }
  function resolve(v){ if (v && typeof v==='object'){ if (v['.sv']==='timestamp') return Date.now(); var o=Array.isArray(v)?[]:{}; for (var k in v) o[k]=resolve(v[k]); return o; } return v; }
  function put(p,v){ var ps=parts(p); var n=db; for (var i=0;i<ps.length-1;i++){ if (n[ps[i]]==null||typeof n[ps[i]]!=='object') n[ps[i]]={}; n=n[ps[i]]; }
    var last=ps[ps.length-1]; if (v===null||v===undefined) delete n[last]; else n[last]=resolve(v); }
  function notify(){ try { localStorage.setItem(KEY, JSON.stringify(db)); } catch(e){}
    listeners.forEach(function(l){ var v=clone(get(l.path)); l.cb({ val:function(){return v;} }); }); }
  window.__stubDb = function(){ return db; };
  function ref(p){ return {
    get:function(){ var v=clone(get(p)); return Promise.resolve({ exists:function(){return v!==null;}, val:function(){return v;} }); },
    set:function(v){ put(p,v); notify(); return Promise.resolve(); },
    update:function(o){ for (var k in o) put(p+'/'+k,o[k]); notify(); return Promise.resolve(); },
    remove:function(){ put(p,null); notify(); return Promise.resolve(); },
    push:function(v){ var k='k'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); put(p+'/'+k,v); notify(); return Promise.resolve(); },
    on:function(ev,cb){ if (p==='.info/connected'){ cb({val:function(){return true;}}); return cb; }
      listeners.push({path:p,cb:cb}); var v=clone(get(p)); cb({ val:function(){return v;} }); return cb; },
    off:function(ev,cb){ listeners=listeners.filter(function(l){return l.cb!==cb;}); }
  }; }
  window.firebase = {
    initializeApp:function(){ return {}; },
    database: Object.assign(function(){ return { ref: ref }; }, { ServerValue:{ TIMESTAMP:{'.sv':'timestamp'} } }),
    auth:function(){ return {
      onAuthStateChanged:function(cb){ cb({uid:'u1',email:'you@langara.ca',displayName:'You'}); return function(){}; },
      signOut:function(){ return Promise.resolve(); }
    }; }
  };
})();`;

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/>
<title>CS Program Tracker — local preview</title>
<style>${R(path.join(OUT, 'tw-tracker.css'))}</style>
<style>${appCss}</style>
</head>
<body class="${bodyClass}">
<div id="root"></div>
<script>window.__SAMPLE__ = ${sample};</script>
<script>${R(path.join(__dirname, 'node_modules/react/umd/react.production.min.js'))}<\/script>
<script>${R(path.join(__dirname, 'node_modules/react-dom/umd/react-dom.production.min.js'))}<\/script>
<script>${stub}<\/script>
<script>${code}<\/script>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'tracker.html'), html);
console.log('tracker preview written — dev/.out/tracker.html');
