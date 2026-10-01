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
  ok('links back to the Workflow Map', await p.evaluate(() => !!document.querySelector('a[href="workflow-tool.html"]')));

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
  await click(p, '[data-testid=new-project]'); await p.waitForTimeout(150);
  await fill(p, '.fixed input >> nth=0', 'Certificate in Testing');
  await click(p, '.fixed button', 'Create project'); await p.waitForTimeout(300);
  d = await db(p);
  const proj = Object.values(d.tracker.projects || {})[0];
  ok('project created with a workflow snapshot', proj && proj.documents.length === 2 && proj.sourceHash);
  t = await text(p);
  ok('opens on the Overview, one row per document', await p.evaluate(() => document.querySelectorAll('[data-testid=ov-doc]').length === 2));
  ok('each document has a step track with a wide current card', await p.evaluate(() => document.querySelectorAll('[data-testid=track] [data-kind=now]').length === 2));
  ok('current card is wider than the side cards', await p.evaluate(() => { const n = document.querySelector('.trk-now'), s = document.querySelector('.trk-side'); return n.offsetWidth > s.offsetWidth * 2.5; }));
  ok('upcoming dates sit in the summary, not a panel below', await p.evaluate(() => !!document.querySelector('[data-testid=upcoming]')));
  ok('rows open aligned: every current card starts at the same x', await p.evaluate(() => { const xs = [...document.querySelectorAll('.trk-now')].map(n => Math.round(n.getBoundingClientRect().left)); return xs.length === 2 && Math.abs(xs[0] - xs[1]) <= 1; }));
  ok('a first step gets a start placeholder so it stays aligned', await p.evaluate(() => !!document.querySelector('[data-kind=none]')));
  ok('row tracks show no scrollbar', await p.evaluate(() => { const tr = document.querySelector('[data-testid=track]'); return tr.offsetHeight === tr.clientHeight; }));
  ok('segmented bar has one segment per step', await p.evaluate(() => document.querySelector('[data-testid=segments]').children.length === 4));

  console.log('\nDocument links');
  await click(p, '[data-testid=doc-link] button', 'Add file link'); await p.waitForTimeout(100);
  await fill(p, '.fixed input >> nth=0', 'https://example.com/v1');
  await click(p, '.fixed button', 'Add link'); await p.waitForTimeout(150);
  await click(p, '[data-testid=doc-link] button[title="Update link"]'); await p.waitForTimeout(100);
  await fill(p, '.fixed input >> nth=0', 'https://example.com/v2');
  await fill(p, '.fixed input >> nth=1', 'after review');
  await click(p, '.fixed button', 'Save as latest version'); await p.waitForTimeout(150);
  d = await db(p);
  const lk = Object.values(d.tracker.projects)[0].links.d1;
  ok('a new file version replaces the link and keeps the old one', lk.url === 'https://example.com/v2' && lk.version === 2 && Object.values(lk.history).some(h => h.url === 'https://example.com/v1'));
  await p.evaluate(() => document.querySelector('[data-testid=card-task]').click()); await p.waitForTimeout(150);
  d = await db(p);
  ok('a task can be ticked on the card without opening the step', !!((cell(d, 'd1', 's1').checks || {}).r1 || {}).t0 && await p.evaluate(() => !document.querySelector('.fixed')));
  await p.evaluate(() => document.querySelector('[data-testid=card-task]').click()); await p.waitForTimeout(150);
  ok('the document shows its file link', await p.evaluate(() => /Open file\s*v2/.test(document.querySelector('[data-testid=doc-link]').innerText)));
  await p.screenshot({ path: path.join(SHOTS, 'tracker-overview.png') });
  await click(p, 'button[data-view=flow]'); await p.waitForTimeout(150);
  t = await text(p);
  ok('full flow view shows one track per document', t.includes('Concept Paper') && t.includes('Program Proposal') && t.includes('EDCO'));
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
  t = await text(p);
  ok('step panel shows the workflow map\'s notes and storage', t.includes('Use the 2026 template.') && t.includes('CS SharePoint'));
  ok('actions become a checklist', await p.evaluate(() => document.querySelectorAll('[data-testid=checklist] input[type=checkbox]').length === 2));
  await p.evaluate(() => document.querySelector('[data-testid=checklist] input').click()); await p.waitForTimeout(100);
  d = await db(p);
  ok('ticking a task records it against round 1', !!((cell(d, 'd1', 's1').checks || {}).r1 || {}).t0);
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
  await click(p, '[data-testid=nav-dashboard]'); await p.waitForTimeout(200);
  t = await text(p);
  ok('dashboard lists the step assigned through a role', await p.evaluate(() => { const a = document.querySelector('[data-testid=attention]'); return !!a && a.innerText.includes('JCCS'); }));
  ok('summary tiles count held up steps', await p.evaluate(() => /2\s*Held up/.test(document.querySelector('[data-testid=tiles]').innerText)));
  ok('project row shows workflow, due and updated under the title', await p.evaluate(() => !!document.querySelector('[data-testid=flag-held]')) && /New Program · (No due date|Due:)[^\n]*· Updated:/.test(t));
  ok('project row shows who is on it', await p.evaluate(() => document.querySelector('[data-testid=project-people]').innerText.includes('YP')));
  ok('overall bar carries its % inside', await p.evaluate(() => /\d+%/.test(document.querySelector('[data-testid=overall-bar]').innerText)));
  ok('one progress chip per document, named', await p.evaluate(() => { const c = document.querySelector('[data-testid=doc-chips]'); return c.children.length === 2 && c.innerText.includes('Program Proposal'); }));
  ok('sidebar lists the project with its progress', await p.evaluate(() => document.querySelector('aside').innerText.includes('Certificate in Testing')));
  ok('brand block and top bar borders meet in one line', await p.evaluate(() => Math.abs(document.querySelector('aside > button').getBoundingClientRect().bottom - document.querySelector('header').getBoundingClientRect().bottom) < 0.5));
  ok('donut counts the project once', await p.evaluate(() => /1\s*projects/.test(document.querySelector('[data-testid=donut]').innerText)));
  ok('completed projects are hidden by default', await p.evaluate(() => /Status\s*5/.test(document.querySelector('[data-testid=f-status]').innerText)));
  await p.evaluate(() => [...document.querySelectorAll('[data-testid=tiles] button')].find(b => b.innerText.includes('Sent back')).click()); await p.waitForTimeout(100);
  ok('clicking a tile filters to those projects', await p.evaluate(() => document.querySelectorAll('[data-testid=project-row]').length === 0 && document.body.innerText.includes('No projects match')));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Show all').click()); await p.waitForTimeout(100);
  ok('show all brings the project back', await p.evaluate(() => document.querySelectorAll('[data-testid=project-row]').length === 1));
  ok('recent updates are grouped under the project', await p.evaluate(() => document.querySelectorAll('[data-testid=recent-group]').length === 1 && document.querySelector('[data-testid=recent-group]').innerText.startsWith('Certificate in Testing')));
  ok('a change applied at a meeting collapses to one line', await p.evaluate(() => (document.querySelector('[data-testid=recent]').innerText.match(/JCCS: Held up/g) || []).length === 1));
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
  await click(p, 'button[data-view=overview]'); await p.waitForTimeout(150);
  ok('overview now slides to the reopened step', await p.evaluate(() => { const n = document.querySelector('[data-kind=now]'); return !!n && n.innerText.includes('Draft') && n.innerText.includes('Round 2'); }));
  await p.screenshot({ path: path.join(SHOTS, 'tracker-overview-2.png') });
  await p.goto(PAGE); await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll('[data-testid=tiles] button')].find(b => b.innerText.includes('Sent back')).click()); await p.waitForTimeout(100);
  ok('the Sent back tile now finds the project', await p.evaluate(() => document.querySelectorAll('[data-testid=project-row]').length === 1));
  await p.screenshot({ path: path.join(SHOTS, 'tracker-dashboard.png'), fullPage: true });
  await click(p, '[data-testid=project-row]'); await p.waitForTimeout(200);
  await click(p, 'button[data-view=flow]'); await p.waitForTimeout(150);

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
  ok('flags a changed workflow with a pill in the top bar', await p.evaluate(() => !!document.querySelector('[data-testid=drift-pill]')));
  await click(p, '[data-testid=drift-pill]'); await p.waitForTimeout(150);
  ok('the changes drawer says what changed', await p.evaluate(() => document.querySelector('[data-testid=workflow-diff]').innerText.includes('New step: Board')));
  await click(p, '[data-testid=changes-drawer] button', 'Update to latest workflow'); await p.waitForTimeout(150);
  d = await db(p);
  const pr2 = Object.values(d.tracker.projects)[0];
  ok('update pulls in new steps and keeps progress', pr2.documents[0].steps.some(s => s.id === 's5') && cell(d, 'd1', 's1').round === 2);
  await p.evaluate(() => { const db = window.__stubDb(); const s = db.pipeline.projectTypes[0].documents[0].steps[0]; s.notes = 'Use the 2027 template.'; s.presenterIds = ['r1']; });
  await p.evaluate(() => firebase.database().ref('tracker/ping').set(2)); await p.waitForTimeout(150);
  ok('a notes-only edit does not raise the Workflow changed pill', await p.evaluate(() => !document.querySelector('[data-testid=drift-pill]')));
  await p.evaluate(() => { const db = window.__stubDb(); const s = db.pipeline.projectTypes[0].documents[1].steps[1]; s.presenterIds = ['r2']; });
  await p.evaluate(() => firebase.database().ref('tracker/ping').set(3)); await p.waitForTimeout(150);
  await p.evaluate(() => { if (!document.querySelector('[data-testid=changes-drawer]')) document.querySelector('[data-testid=changes-btn]').click(); }); await p.waitForTimeout(100);
  await click(p, '[data-testid=changes-drawer] button[data-tab=workflow]'); await p.waitForTimeout(150);
  ok('minor changes collapse to one summary line', await p.evaluate(() => /minor detail changes on 1 step \(notes\)/.test(document.querySelector('[data-testid=minor-summary]').innerText)));

  console.log('\nIcons');
  ok('no emoji in the rendered page', await p.evaluate(() => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText)));

  console.log('\nErrors');
  ok('no console or page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
