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
  await click(p, '[data-testid=settings-btn]'); await p.waitForTimeout(150);
  await click(p, '.fixed button', 'People'); await p.waitForTimeout(150);
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
  d = await db(p);
  ok('completing the step completes its remaining tasks', ((cell(d, 'd1', 's1').checks || {}).r1 || {}).t1 && ((cell(d, 'd1', 's1').checks.r1.t1.status) === 'complete'));
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);

  console.log('\nMeeting shortcut');
  await openStep('Concept Paper', 'JCCS');
  t = await text(p);
  ok('offers to apply to every document at the meeting', t.includes('every document at this meeting'));
  ok('people list separates automatic from added by hand', await p.evaluate(() => !!document.querySelector('[data-testid=people-auto]') && !!document.querySelector('[data-testid=people-hand]') && /You Person/.test(document.querySelector('[data-testid=people-auto]').innerText)));
  await p.evaluate(() => document.querySelector('[data-testid=checklist] [data-testid=task-menu-btn]').click()); await p.waitForTimeout(100);
  await p.evaluate(() => [...document.querySelectorAll('[data-testid=task-menu] button')].find(b => b.innerText.includes('In progress')).click()); await p.waitForTimeout(150);
  d = await db(p);
  ok('a task can be set in progress from its menu', ((cell(d, 'd1', 's3').checks || {}).r1 || {}).t0 && cell(d, 'd1', 's3').checks.r1.t0.status === 'in_progress');
  ok('a set status replaces the checkbox', await p.evaluate(() => { const r = [...document.querySelectorAll('[data-testid=checklist] [data-testid=task-row]')][0]; return r.dataset.status === 'in_progress' && !!r.querySelector('[data-testid=task-marker]') && !r.querySelector('input[type=checkbox]'); }));
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
  ok('the held-up reason is editable on the step, with line breaks', await p.evaluate(() => { const ta = document.querySelector('[data-testid=held-reason] textarea'); return !!ta && ta.value === 'Waiting on the Dean'; }));
  await p.locator('[data-testid=held-reason] textarea').fill('Waiting on the Dean\nback on the 12th');
  await p.evaluate(() => document.querySelector('[data-testid=held-reason] textarea').blur()); await p.waitForTimeout(150);
  d = await db(p);
  ok('an edited reason saves with its line break', cell(d, 'd1', 's3').heldReason === 'Waiting on the Dean\nback on the 12th');
  await p.locator('[data-testid=held-reason] textarea').fill('Waiting on the Dean');
  await p.evaluate(() => document.querySelector('[data-testid=held-reason] textarea').blur()); await p.waitForTimeout(150);

  console.log('\nAttention');
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);
  await click(p, '[data-testid=nav-dashboard]'); await p.waitForTimeout(200);
  t = await text(p);
  ok('dashboard lists the step assigned through a role', await p.evaluate(() => { const a = document.querySelector('[data-testid=attention]'); return !!a && a.innerText.includes('JCCS'); }));
  ok('summary tiles count projects held up, not steps', await p.evaluate(() => /1\s*Held up/.test(document.querySelector('[data-testid=tiles]').innerText)));
  ok('needs your attention leads with the project, step underneath, no document', await p.evaluate(() => { const r = document.querySelector('[data-testid=attention-item]'); return !!r && r.innerText.split('\n')[0].trim() === 'Certificate in Testing' && !/Concept Paper|Program Proposal/.test(r.innerText); }));
  ok('project row shows workflow, due and updated under the title', await p.evaluate(() => !!document.querySelector('[data-testid=flag-held]')) && /New Program\s*·\s*(No due date|Due:)[\s\S]*?Updated:/.test(t));
  ok('project row shows who is on it', await p.evaluate(() => document.querySelector('[data-testid=project-people]').innerText.includes('YP')));
  ok('overall bar carries its % inside', await p.evaluate(() => /\d+%/.test(document.querySelector('[data-testid=overall-bar]').innerText)));
  ok('document chips are hidden by default', await p.evaluate(() => !document.querySelector('[data-testid=doc-chips]')));
  ok('a held-up project colours its bar amber', await p.evaluate(() => document.querySelector('[data-testid=overall-bar]').dataset.tone === '#d97706'));
  ok('each person has their own colour', await p.evaluate(() => !!document.querySelector('[data-testid=project-people] [data-testid=avatar]').style.background));
  await p.evaluate(() => document.querySelector('[data-testid=row-docs-toggle]').click()); await p.waitForTimeout(100);
  ok('one progress chip per document, named', await p.evaluate(() => { const c = document.querySelector('[data-testid=doc-chips]'); return c.children.length === 2 && c.innerText.includes('Program Proposal'); }));
  await p.evaluate(() => document.querySelector('[data-testid=row-docs-toggle]').click());
  await p.evaluate(() => document.querySelector('[data-testid=pref-detailed] input').click()); await p.waitForTimeout(100);
  ok('detailed progress splits the bar by document', await p.evaluate(() => document.querySelector('[data-testid=overall-bar]').dataset.detailed === 'yes' && document.querySelector('[data-testid=overall-bar]').children.length === 2));
  await p.evaluate(() => document.querySelector('[data-testid=pref-detailed] input').click()); await p.waitForTimeout(100);
  ok('the project list scrolls on its own', await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid=project-scroll]')).overflowY === 'auto'));
  ok('Dashboard, Workflow Tool and Settings sit at the top of the sidebar', await p.evaluate(() => { const sw = document.querySelector('[data-testid=nav-switch]'); const proj = [...document.querySelectorAll('aside span')].find(x => x.innerText.trim() === 'PROJECTS' || x.innerText.trim() === 'Projects'); return !!sw && !!proj && (sw.compareDocumentPosition(proj) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  ok('sidebar lists the project with its progress', await p.evaluate(() => document.querySelector('aside').innerText.includes('Certificate in Testing')));
  ok('brand block and top bar borders meet in one line', await p.evaluate(() => Math.abs(document.querySelector('aside > button').getBoundingClientRect().bottom - document.querySelector('header').getBoundingClientRect().bottom) < 0.5));
  ok('donut counts the project once', await p.evaluate(() => /1\s*projects/.test(document.querySelector('[data-testid=donut]').innerText)));
  ok('completed projects are hidden by default', await p.evaluate(() => /Status\s*5/.test(document.querySelector('[data-testid=f-status]').innerText)));
  await p.evaluate(() => [...document.querySelectorAll('[data-testid=tiles] button')].find(b => b.innerText.includes('Sent back')).click()); await p.waitForTimeout(100);
  ok('clicking a tile filters to those projects', await p.evaluate(() => document.querySelectorAll('[data-testid=project-row]').length === 0 && document.body.innerText.includes('No projects match')));
  await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Show all').click()); await p.waitForTimeout(100);
  ok('show all brings the project back', await p.evaluate(() => document.querySelectorAll('[data-testid=project-row]').length === 1));
  ok('recent updates are grouped under the project', await p.evaluate(() => document.querySelectorAll('[data-testid=recent-group]').length === 1 && document.querySelector('[data-testid=recent-group]').innerText.startsWith('Certificate in Testing')));
  ok('recent updates list the project on one line until opened', await p.evaluate(() => !document.querySelector('[data-testid=recent-items]')));
  await p.evaluate(() => document.querySelector('[data-testid=recent-group] button').click()); await p.waitForTimeout(100);
  ok('a change applied at a meeting collapses to one line', await p.evaluate(() => (document.querySelector('[data-testid=recent]').innerText.match(/JCCS: Held up/g) || []).length === 1));
  console.log('\nMeeting schedule');
  const mDate = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  await click(p, '[data-testid=schedule-btn]'); await p.waitForTimeout(150);
  await p.locator('[data-testid=meeting-name]').fill('JCCS Meeting');
  await p.locator('[data-testid=meeting-dates] input[type=date]').first().fill(mDate);
  await click(p, '.fixed button', 'Add to schedule'); await p.waitForTimeout(200);
  ok('a meeting can be added to the schedule', await p.evaluate(() => /JCCS Meeting/.test(document.querySelector('[data-testid=meeting-schedule]').innerText)));
  await p.evaluate(() => [...document.querySelectorAll('.fixed button')].find(b => b.innerText.trim() === 'Done').click()); await p.waitForTimeout(150);
  ok('a scheduled meeting shows in the next 30 days with no projects yet', await p.evaluate(() => /JCCS Meeting[\s\S]*0 projects/.test(document.querySelector('[data-testid=report-dates]').innerText)));
  await click(p, '[data-testid=project-row]'); await p.waitForTimeout(200);
  await openStep('Concept Paper', 'JCCS');
  await click(p, '[data-testid=meeting-date-btn]'); await p.waitForTimeout(100);
  ok('the meeting calendar highlights the matching scheduled date', await p.evaluate((d) => { const c = document.querySelector('[data-testid=meeting-cal]'); return !!c && [...c.querySelectorAll('[data-marked=yes]')].length === 1; }, mDate));
  await p.evaluate(() => { const b = [...document.querySelectorAll('[data-testid=meeting-cal] [data-marked=no]')].find(x => /^\d+$/.test(x.innerText.trim())); b.click(); }); await p.waitForTimeout(150);
  ok('picking an off-schedule date asks if the meeting was rescheduled', await p.evaluate(() => !!document.querySelector('[data-testid=reschedule-ask]')));
  await click(p, '.fixed button', 'No, just use this date'); await p.waitForTimeout(150);
  ok('an off-schedule date is flagged', await p.evaluate(() => !!document.querySelector('[data-testid=meeting-off-schedule]')));
  await click(p, '[data-testid=meeting-date-btn]'); await p.waitForTimeout(100);
  await p.evaluate(() => document.querySelector('[data-testid=meeting-cal] [data-marked=yes]') ? document.querySelector('[data-testid=meeting-cal] [data-marked=yes]').click() : [...document.querySelectorAll('[data-testid=meeting-cal] button')].find(b => b.innerText.includes('Clear')).click()); await p.waitForTimeout(150);
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);

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

  console.log('\nDuplicate');
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(200);
  await click(p, '[data-testid=new-project]'); await p.waitForTimeout(150);
  await click(p, '[data-testid=new-mode] button', 'Duplicate a project'); await p.waitForTimeout(100);
  await click(p, '.fixed button', 'Duplicate project'); await p.waitForTimeout(300);
  d = await db(p);
  const prs = Object.values(d.tracker.projects);
  const dup = prs.find(x => /^Copy of /.test(x.name));
  ok('duplicate copies progress', !!dup && JSON.stringify(dup.progress) === JSON.stringify(prs.find(x => x !== dup).progress));
  ok('duplicate leaves out file links', !!dup && !dup.links);
  ok('duplicate starts its own activity', !!dup && Object.values(dup.activity || {}).length === 1 && /Duplicated from/.test(Object.values(dup.activity)[0].text));

  console.log('\nBatches');
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(200);
  await click(p, '[data-testid=new-project]'); await p.waitForTimeout(150);
  await fill(p, '.fixed input >> nth=0', 'New Courses Fall');
  await p.evaluate(() => document.querySelector('[data-testid=batch-toggle] input').click()); await p.waitForTimeout(100);
  await p.locator('[data-testid=batch-items]').fill('CPSC 1010\nCPSC 1020');
  await p.evaluate(() => [...document.querySelectorAll('[data-testid=batch-setup] button')].filter(b => b.innerText.trim() === 'Shared')[0].click()); await p.waitForTimeout(100);
  await click(p, '.fixed button', 'Create project'); await p.waitForTimeout(300);
  d = await db(p);
  const bp = Object.entries(d.tracker.projects).find(([, x]) => x.name === 'New Courses Fall');
  ok('a batch stores its items, shared documents and one workflow copy', !!bp && bp[1].batch && bp[1].items.length === 2 && bp[1].sharedDocIds[0] === 'd1' && !bp[1].documents);
  await p.evaluate(() => { const b = document.querySelector('button[data-view=overview]'); if (b) b.click(); }); await p.waitForTimeout(200);
  ok('the overview groups the batch by item', await p.evaluate(() => document.querySelectorAll('[data-testid=item-header]').length === 2 && document.querySelectorAll('[data-testid=ov-doc]').length === 3));
  await p.evaluate(() => { const h = document.querySelectorAll('[data-testid=item-header]')[0]; h.nextElementSibling.querySelector('[data-kind=now]').click(); }); await p.waitForTimeout(200);
  ok('an initiative counts the shared documents in its progress', await p.evaluate(() => /\/(\d+) steps/.exec(document.querySelector('[data-testid=item-header]').textContent)[1] > 3));
  ok('a batch step offers Apply to all initiatives beside Status', await p.evaluate(() => !!document.querySelector('[data-testid=all-items]')));
  // Status first, then tick: the tick still applies it.
  await click(p, '.fixed button', 'In progress'); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelector('[data-testid=all-items] input').click()); await p.waitForTimeout(200);
  d = await db(p);
  const prog = d.tracker.projects[bp[0]].progress || {};
  const items = d.tracker.projects[bp[0]].items;
  ok('ticking Apply to all after choosing a status still updates every initiative', items.every(it => ((prog['d2__' + it.id] || {}).t1 || {}).status === 'in_progress'));
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);
  await click(p, 'button', 'Project settings'); await p.waitForTimeout(150);
  await p.evaluate(() => [...document.querySelectorAll('[data-testid=batch-items-edit] button')].find(b => b.innerText.includes('Split off')).click()); await p.waitForTimeout(100);
  await p.evaluate(() => [...document.querySelectorAll('.fixed button')].filter(b => b.innerText.trim() === 'Split off').pop().click()); await p.waitForTimeout(400);
  d = await db(p);
  const split = Object.values(d.tracker.projects).find(x => /^New Courses Fall — CPSC 1010$/.test(x.name));
  ok('splitting off an item makes its own project with its progress', !!split && split.items.length === 1 && !!(split.progress || {})['d2__' + items[0].id]);
  ok('the item leaves the batch', d.tracker.projects[bp[0]].items.length === 1);
  await click(p, 'button', 'Project settings'); await p.waitForTimeout(150);
  await click(p, '.fixed button', 'Delete'); await p.waitForTimeout(150);
  ok('delete asks in a confirm box, not a typed prompt', await p.evaluate(() => /5 seconds to undo/.test((document.querySelector('[data-testid=confirm-message]') || {}).innerText || '')));
  await p.evaluate(() => [...document.querySelectorAll('.fixed button')].filter(b => b.innerText.trim() === 'Delete project').pop().click()); await p.waitForTimeout(400);
  d = await db(p);
  const gone = !Object.values(d.tracker.projects).some(x => /— CPSC 1010$/.test(x.name));
  ok('delete removes the project and shows an undo toast', gone && await p.evaluate(() => !!document.querySelector('[data-testid=undo-toast]')));
  await p.evaluate(() => document.querySelector('[data-testid=undo-btn]').click()); await p.waitForTimeout(300);
  d = await db(p);
  ok('undo brings the deleted project back whole', Object.values(d.tracker.projects).some(x => /— CPSC 1010$/.test(x.name) && !!x.progress));

  console.log('\nBulk actions');
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('[data-testid=select-all]').click()); await p.waitForTimeout(100);
  ok('select all shown ticks every listed row', await p.evaluate(() => [...document.querySelectorAll('[data-testid=row-select]')].every(c => c.checked)));
  await click(p, '[data-testid=bulk-batch]'); await p.waitForTimeout(150);
  ok('a batch in the selection blocks merging, with the reason', await p.evaluate(() => /cannot be merged/.test((document.querySelector('[data-testid=batch-block]') || {}).innerText || '')));
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);
  await click(p, '[data-testid=bulk-archive]'); await p.waitForTimeout(300);
  d = await db(p);
  ok('bulk archive archives every selected project', Object.values(d.tracker.projects).every(x => x.archived));
  await p.evaluate(() => document.querySelector('[data-testid=undo-btn]').click()); await p.waitForTimeout(300);
  d = await db(p);
  ok('undo restores them', Object.values(d.tracker.projects).every(x => !x.archived));
  // Merge the two single projects into a new batch.
  const singles = Object.entries(d.tracker.projects).filter(([, x]) => !x.batch);
  await p.evaluate(() => { const a = document.querySelector('[data-testid=select-all]'); if (a.checked) a.click(); }); await p.waitForTimeout(100);
  await p.evaluate((names) => [...document.querySelectorAll('[data-testid=project-row]')].forEach(r => { if (names.includes(r.querySelector('span').innerText.trim())) r.parentElement.querySelector('[data-testid=row-select]').click(); }), singles.map(([, x]) => x.name)); await p.waitForTimeout(100);
  await click(p, '[data-testid=bulk-batch]'); await p.waitForTimeout(150);
  await p.locator('[data-testid=bulk-batch-name]').fill('Merged Batch');
  await click(p, '.fixed button', 'Create batch'); await p.waitForTimeout(400);
  d = await db(p);
  const mb = Object.values(d.tracker.projects).find(x => x.name === 'Merged Batch');
  const srcWithProg = singles.find(([, x]) => x.progress && x.progress.d1);
  ok('merging makes a batch with one initiative per project, no shared documents', !!mb && mb.items.length === singles.length && !(mb.sharedDocIds || []).length);
  ok('merged progress moves to docId__initiativeId', !!mb && (!srcWithProg || Object.keys(mb.progress || {}).some(k => /^d1__/.test(k))));
  ok('the originals are archived with a note', singles.every(([id]) => d.tracker.projects[id].archived && /Added to the batch "Merged Batch"/.test(d.tracker.projects[id].notes)));

  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(300);
  ok('a batch shows as one line in Needs your attention', await p.evaluate(() => [...document.querySelectorAll('[data-testid=attention-batch]')].filter(x => x.innerText.startsWith('Merged Batch')).length === 1));
  ok('upcoming lists meetings only, grouped by event', await p.evaluate(() => { const r = document.querySelector('[data-testid=report-dates]'); return !!r && !/\bdue\b/.test(r.innerText); }));
  // Tasks across initiatives, in the merged batch (every document per initiative).
  const mbId = Object.entries(d.tracker.projects).find(([, x]) => x.name === 'Merged Batch')[0];
  await p.evaluate((id) => { location.hash = '#/p/' + id; }, mbId); await p.waitForTimeout(300);
  await p.evaluate(() => { const b = document.querySelector('button[data-view=overview]'); if (b) b.click(); }); await p.waitForTimeout(200);
  await p.evaluate(() => { const c = [...document.querySelectorAll('[data-kind=now]')].find(x => /Draft/.test(x.innerText) && /Concept Paper/.test(x.closest('[data-testid=ov-doc]') ? x.closest('[data-testid=ov-doc]').innerText : x.innerText)); (c || document.querySelector('[data-kind=now]')).click(); }); await p.waitForTimeout(200);
  ok('the tasks list offers its own Apply to all initiatives', await p.evaluate(() => !!document.querySelector('[data-testid=all-tasks]')));
  await p.evaluate(() => document.querySelector('[data-testid=all-tasks] input').click()); await p.waitForTimeout(100);
  await p.evaluate(() => { const c = [...document.querySelectorAll('[data-testid=panel-task]')].find(x => !x.checked); c && c.click(); }); await p.waitForTimeout(300);
  d = await db(p);
  { const b = d.tracker.projects[mbId]; const counts = b.items.map(it => Object.keys((((b.progress || {})['d1__' + it.id] || {}).s1 || {}).checks || {}).length);
    ok('a task ticked with it on is ticked on every initiative', counts.every(n => n > 0)); }
  await p.evaluate(() => document.querySelector('.fixed button[aria-label="Close"]').click()); await p.waitForTimeout(100);
  { const before = await p.evaluate(() => document.querySelectorAll('[data-testid=ov-doc]').length);
    await p.evaluate(() => document.querySelector('[data-testid=hide-doc]').click()); await p.waitForTimeout(100);
    ok('hiding a batch document offers Apply to all initiatives', await p.evaluate(() => !!document.querySelector('[data-testid=hide-all]')));
    await p.evaluate(() => document.querySelector('[data-testid=hide-all] input').click());
    await click(p, '.fixed button', 'Hide document'); await p.waitForTimeout(300);
    const after = await p.evaluate(() => document.querySelectorAll('[data-testid=ov-doc]').length);
    ok('hidden documents leave the project, one per initiative', after === before - 2 && await p.evaluate(() => /2 hidden documents/.test(document.querySelector('[data-testid=hidden-docs]').innerText)));
    await p.evaluate(() => [...document.querySelectorAll('[data-testid=hidden-docs] button')][0].click()); await p.waitForTimeout(100);
    await p.evaluate(() => document.querySelector('[data-testid=unhide-doc]').click()); await p.waitForTimeout(300);
    ok('show again brings one back', await p.evaluate(() => document.querySelectorAll('[data-testid=ov-doc]').length) === before - 1); }

  console.log('\nNarrow window');
  await p.setViewportSize({ width: 1100, height: 900 });
  await p.evaluate(() => { location.hash = '#/'; }); await p.waitForTimeout(300);
  ok('below 1280px the sidebar is the icon rail', await p.evaluate(() => !!document.querySelector('[data-testid=rail]')));
  ok('rail shows each project as initials', await p.evaluate(() => /^CE$/.test(document.querySelector('[data-testid=rail-project]').innerText.trim()) || document.querySelector('[data-testid=rail-project]').innerText.trim().length === 2));
  ok('Needs your attention comes first, compact, without its explanation', await p.evaluate(() => { const a = document.querySelector('[data-testid=attention]'), c = document.querySelector('[data-testid=tiles]'); return (a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.innerText.includes('active or next'); }));
  ok('narrow cards are one slim line', await p.evaluate(() => [...document.querySelectorAll('[data-testid=tiles] > button')].every(b => b.offsetHeight <= 34)));
  ok('search and New project share the first toolbar line', await p.evaluate(() => { const s = document.querySelector('[data-testid=projects] input').getBoundingClientRect(), n = document.querySelector('[data-testid=new-project]').getBoundingClientRect(), f = document.querySelector('[data-testid=filters]').getBoundingClientRect(); return Math.abs(s.top - n.top) < 12 && f.top > s.bottom; }));
  await p.evaluate(() => document.querySelector('[data-testid=card-dates]').click()); await p.waitForTimeout(150);
  ok('a report card drops its panel open', await p.evaluate(() => !!document.querySelector('[data-testid=report-drop] [data-testid=report-dates]')));
  await p.evaluate(() => document.querySelector('[data-testid=card-dates]').click()); await p.waitForTimeout(150);
  ok('clicking it again closes it', await p.evaluate(() => !document.querySelector('[data-testid=report-drop]')));
  const held = () => p.evaluate(() => [...document.querySelectorAll('[data-testid=tiles] button')].find(b => b.innerText.includes('Held up')).click());
  await held(); await p.waitForTimeout(100);
  ok('a stat tile switches its filter on', await p.evaluate(() => /Status\s*1/.test(document.querySelector('[data-testid=f-status]').innerText)));
  await held(); await p.waitForTimeout(100);
  ok('clicking the tile again switches it off', await p.evaluate(() => /Status\s*5/.test(document.querySelector('[data-testid=f-status]').innerText)));
  await p.evaluate(() => document.querySelector('[data-testid=rail-expand] button').click()); await p.waitForTimeout(200);
  ok('opening the sidebar on a narrow window overlays the page', await p.evaluate(() => !!document.querySelector('[data-testid=sidebar-backdrop]') && !!document.querySelector('[data-testid=nav-dashboard]')));
  await p.evaluate(() => document.querySelector('[data-testid=sidebar-backdrop]').click()); await p.waitForTimeout(150);
  ok('clicking away closes it', await p.evaluate(() => !!document.querySelector('[data-testid=rail]')));
  await p.setViewportSize({ width: 1400, height: 900 }); await p.waitForTimeout(200);
  ok('a wide window opens the full sidebar again', await p.evaluate(() => !document.querySelector('[data-testid=rail]')));

  console.log('\nIcons');
  ok('no emoji in the rendered page', await p.evaluate(() => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(document.body.innerText)));

  console.log('\nErrors');
  ok('no console or page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
