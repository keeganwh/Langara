// Headless checks for tracker.html against dev/.out/tracker.html (built by
// tracker-preview.js). Drives the real flows: add a person, create a project,
// change status, apply to a whole meeting, skip, send back, and check that
// the earlier round stays on record.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '.out', 'tracker.html');
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const SHOTS = path.join(__dirname, '.out');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
};
const text = p => p.evaluate(() => document.body.innerText);   // innerText, never textContent
const click = (p, sel, txt) => p.evaluate(([sel, txt]) => {
  const el = [...document.querySelectorAll(sel)].find(e => !txt || e.innerText.trim() === txt || e.innerText.includes(txt));
  if (!el) throw new Error('not found: ' + sel + ' ' + txt);
  el.click();
}, [sel, txt]);
const fill = async (p, selector, value) => { await p.locator(selector).first().fill(value); };
const db = p => p.evaluate(() => window.__stubDb());
const cell = (d, docId, stepId) => {
  const pr = Object.values(d.tracker.projects)[0];
  return ((pr.progress || {})[docId] || {})[stepId] || {};
};

(async () => {
  const browser = await chromium.launch(fs.existsSync(EXEC) ? { executablePath: EXEC } : {});
  const p = await browser.newPage();
  await p.setViewportSize({ width: 1400, height: 900 });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept());

  await p.goto(PAGE);
  await p.evaluate(() => localStorage.clear());
  await p.goto(PAGE); await p.waitForTimeout(500);

  console.log('\nDashboard');
  let t = await text(p);
  ok('boots to the dashboard', t.includes('Needs your attention') && t.includes('New project'));
  ok('asks an unlisted user to add themselves', t.includes('not on the People list'));
  ok('links back to the Workflow Map', await p.evaluate(() => !!document.querySelector('a[href="pipeline-tool-v2.html"]')));

  console.log('\nPeople');
  await click(p, 'button', 'People'); await p.waitForTimeout(150);
  await click(p, 'button', 'Add person');
  await fill(p, '.fixed input >> nth=0', 'You Person');
  await fill(p, '.fixed input >> nth=1', 'you@langara.ca');
  await p.evaluate(() => { const l = [...document.querySelectorAll('.fixed label')].find(l => l.innerText.trim() === 'CS Admin'); l.querySelector('input').click(); });
  await click(p, 'button', 'Save person'); await p.waitForTimeout(150);
  let d = await db(p);
  const person = Object.values(d.tracker.people || {})[0];
  ok('person saved with a default role', person && person.email === 'you@langara.ca' && person.roleIds.includes('r2'));
  await p.keyboard.press('Escape');
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);

  console.log('\nNew project');
  await click(p, 'button', 'New project'); await p.waitForTimeout(150);
  await fill(p, '.fixed input >> nth=0', 'Certificate in Testing');
  await click(p, '.fixed button', 'Create project'); await p.waitForTimeout(300);
  d = await db(p);
  const proj = Object.values(d.tracker.projects || {})[0];
  ok('project created with a workflow snapshot', proj && proj.documents.length === 2 && proj.sourceHash);
  t = await text(p);
  ok('opens the project view with one track per document', t.includes('Concept Paper') && t.includes('Program Proposal') && t.includes('JCCS'));
  ok('bypassed steps draw a dashed track', await p.evaluate(() => !!document.querySelector('.trk-line.bypass')));
  ok('activity records the creation', Object.values(proj.activity || {}).some(a => /Created from/.test(a.text)));
  await p.screenshot({ path: path.join(SHOTS, 'tracker-project.png') });

  console.log('\nStatus');
  const openStep = async (docName, stepName) => {
    await p.evaluate(([dn, sn]) => {
      const rows = [...document.querySelectorAll('.trk-node')];
      // nodes are in document-major order; find the one whose row label matches
      const all = rows.filter(n => n.innerText.includes(sn));
      const idx = dn === 'Concept Paper' ? 0 : all.length - 1;
      all[idx].click();
    }, [docName, stepName]);
    await p.waitForTimeout(150);
  };
  await openStep('Concept Paper', 'Draft');
  await click(p, '.fixed button', 'In progress'); await p.waitForTimeout(100);
  d = await db(p);
  ok('status write lands on the narrow cell path', cell(d, 'd1', 's1').status === 'in_progress' && cell(d, 'd1', 's1').startDate);
  await click(p, '.fixed button', 'Complete'); await p.waitForTimeout(100);
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);

  console.log('\nMeeting shortcut');
  await openStep('Concept Paper', 'JCCS');
  t = await text(p);
  ok('offers to apply to every document at the meeting', t.includes('every document at this meeting'));
  await p.evaluate(() => { const l = [...document.querySelectorAll('.fixed label')].find(l => l.innerText.includes('every document at this meeting')); l.querySelector('input').click(); });
  await click(p, '.fixed button', 'In progress'); await p.waitForTimeout(100);
  d = await db(p);
  ok('status applied to both documents at the meeting', cell(d, 'd1', 's3').status === 'in_progress' && cell(d, 'd2', 't3').status === 'in_progress');

  console.log('\nHeld up');
  await click(p, '.fixed button', 'Held up'); await p.waitForTimeout(100);
  t = await text(p);
  ok('held up asks for a reason', t.includes('What is it waiting on?'));
  await p.locator('textarea').last().fill('Waiting on the Dean');
  await click(p, '.fixed button', 'Mark held up'); await p.waitForTimeout(100);
  d = await db(p);
  ok('held up stores the reason', cell(d, 'd1', 's3').status === 'held_up' && cell(d, 'd1', 's3').heldReason === 'Waiting on the Dean');

  console.log('\nAttention');
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);
  await click(p, 'button', 'Dashboard'); await p.waitForTimeout(200);
  t = await text(p);
  ok('dashboard lists the step assigned through a role', await p.evaluate(() => { const a = document.querySelector('[data-testid=attention]'); return !!a && a.innerText.includes('JCCS'); }));
  ok('project row shows held up count and current steps', t.includes('held up') && t.includes('Concept Paper:'));
  await p.screenshot({ path: path.join(SHOTS, 'tracker-dashboard.png') });
  await click(p, '[data-testid=project-row]'); await p.waitForTimeout(200);

  console.log('\nSkip');
  await openStep('Concept Paper', 'Dean Review');
  await click(p, '.fixed button', 'Skipped'); await p.waitForTimeout(100);
  t = await text(p);
  ok('skip asks for confirmation and a reason', t.includes('Skip this step?'));
  await p.locator('textarea').last().fill('Not needed');
  await click(p, '.fixed button', 'Skip step'); await p.waitForTimeout(100);
  d = await db(p);
  ok('skip is recorded', cell(d, 'd1', 's2').status === 'skipped');
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);

  console.log('\nSend back');
  await openStep('Concept Paper', 'JCCS');
  await p.selectOption('.fixed select', '0');
  await click(p, '.fixed button', 'Send back'); await p.waitForTimeout(100);
  t = await text(p);
  ok('send back asks for confirmation and a reason', t.includes('Send back?'));
  await p.locator('textarea').last().fill('Committee asked for changes');
  await p.evaluate(() => { const b = [...document.querySelectorAll('.fixed button')].filter(b => b.innerText.trim() === 'Send back'); b[b.length - 1].click(); });
  await p.waitForTimeout(200);
  d = await db(p);
  const s1 = cell(d, 'd1', 's1'), s3 = cell(d, 'd1', 's3');
  ok('target step reopens in round 2', s1.status === 'in_progress' && s1.round === 2);
  ok('started later steps reset into a new round', s3.status === 'pending' && s3.round === 2);
  ok('earlier completion stays in history', Object.values(s1.history || {}).some(h => h.to === 'complete' && (h.round || 1) === 1));
  t = await text(p);
  ok('round badge shows on the track', t.includes('R2'));

  console.log('\nWorkflow update');
  await p.evaluate(() => {
    const db = window.__stubDb();
    db.pipeline.projectTypes[0].documents[0].steps.push({ id: 's5', stageName: 'Board' });
  });
  await p.evaluate(() => window.__stubDb().tracker.projects && null);
  // Trigger a re-render through a harmless write.
  await p.evaluate(() => firebase.database().ref('tracker/ping').set(1));
  await p.waitForTimeout(150);
  t = await text(p);
  ok('flags a changed workflow', t.includes('has changed since this project started'));
  await click(p, 'button', 'Update to latest workflow'); await p.waitForTimeout(150);
  d = await db(p);
  const pr2 = Object.values(d.tracker.projects)[0];
  ok('update pulls in new steps and keeps progress', pr2.documents[0].steps.some(s => s.id === 's5') && cell(d, 'd1', 's1').round === 2);

  console.log('\nIcons');
  ok('no emoji in the rendered page', await p.evaluate(() => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText)));

  console.log('\nErrors');
  ok('no console or page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
