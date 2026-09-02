// Headless checks against dev/.out/preview.html. Each one exists because the
// thing it checks has actually broken at least once.
const path = require('path');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '.out', 'preview.html');
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const launch = () => chromium.launch(require('fs').existsSync(EXEC) ? { executablePath: EXEC } : {});

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
};
// Earlier checks leave the canvas scrolled, which pushes the top bar and
// toolbar out of view and makes every later click "not visible".
const resetScroll = p => p.evaluate(() => {
  window.scrollTo(0, 0);
  document.querySelectorAll('*').forEach(el => {
    if (el.scrollTop) el.scrollTop = 0;
    if (el.scrollLeft) el.scrollLeft = 0;
  });
});
const text = p => p.evaluate(() => document.body.innerText);   // innerText, not textContent:
                                                               // textContent includes the inlined
                                                               // <script> source and matches anything.

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1500, height: 950 });

  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
  p.on('dialog', d => d.accept());

  console.log('\nApp');
  await p.goto(PAGE); await p.waitForTimeout(1400);
  const t0 = await text(p);
  ok('boots and renders the Documents view', t0.includes('Add Document') || t0.includes('Add Step'));
  ok('no in-app print button (printing is via the published page)', !t0.includes('Print / Export PDF'));

  console.log('\nDocuments view — detail toggles');
  const details = p.locator('button', { hasText: 'Details' }).first();
  await details.click(); await p.waitForTimeout(200);
  await p.click('text=Hide all'); await p.waitForTimeout(250);
  await details.click(); await p.waitForTimeout(250);
  const bare = await text(p);
  ok('hiding detail removes it', !bare.includes('PRESENTS') && !bare.includes('Presents'));
  ok('hiding detail keeps step names', /JCCS|Review|Upload/.test(bare));
  await details.click(); await p.waitForTimeout(150);
  await p.click('text=Show all'); await p.waitForTimeout(250);
  await details.click(); await p.waitForTimeout(250);

  console.log('\nRow Lock');
  const rowLock = p.locator('button', { hasText: 'Row Lock' });
  const dragBefore = await p.evaluate(() => { const c = document.querySelector('.step-card'); return c && c.getAttribute('draggable'); });
  await rowLock.click(); await p.waitForTimeout(600);
  const dragAfter = await p.evaluate(() => { const c = document.querySelector('.step-card'); return c && c.getAttribute('draggable'); });
  ok('drag enabled normally, disabled in Row Lock', dragBefore === 'true' && dragAfter === 'false', `${dragBefore} -> ${dragAfter}`);
  const rows = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.step-card')].map(c => {
      const r = c.getBoundingClientRect(); return { top: Math.round(r.top / 6) * 6, h: Math.round(r.height) };
    });
    const by = {}; cards.forEach(c => (by[c.top] = by[c.top] || []).push(c.h));
    return Object.values(by).filter(g => g.length > 1).map(g => new Set(g).size);
  });
  ok('cards in a row share a height', rows.length > 0 && rows.every(n => n === 1), JSON.stringify(rows));
  await rowLock.click(); await p.waitForTimeout(500);

  console.log('\nStep Flow');
  await p.click('text=🪜 Step Flow'); await p.waitForTimeout(600);
  const flow = await text(p);
  ok('renders bypass markers', flow.includes('bypassed'));
  ok('renders START markers', /START/.test(flow));
  await p.click('text=▤ Documents'); await p.waitForTimeout(500);

  console.log('\nPublishing');
  await p.locator('button', { hasText: /Publish/ }).first().click(); await p.waitForTimeout(400);
  const url = await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find(x => x.readOnly); return i ? i.value : ''; });
  ok('offers both card flow layouts', (await text(p)).includes('Serpentine'));
  await p.locator('.fade-in button').last().click(); await p.waitForTimeout(900);
  await p.locator('.fade-in button', { hasText: 'Close' }).first().click(); await p.waitForTimeout(2600);
  ok('chip reads current after publishing', (await text(p)).includes('Published · current'));

  // A display preference must NOT make a publication look stale.
  await details.click(); await p.waitForTimeout(150);
  await p.click('text=Hide all'); await p.waitForTimeout(250);
  await details.click(); await p.waitForTimeout(400);
  ok('display preferences do not mark it stale', (await text(p)).includes('Published · current'));

  const card = p.locator('.step-card').first();
  await card.hover(); await p.waitForTimeout(200);
  await card.locator('button[title="Edit step"]').click(); await p.waitForTimeout(400);
  await p.locator('.fade-in input').first().fill('Renamed by checks.js');
  await p.locator('.fade-in button', { hasText: 'Save Changes' }).click(); await p.waitForTimeout(900);
  ok('content edits do mark it stale', (await text(p)).includes('out of date'));

  await p.locator('button', { hasText: /Publish/ }).first().click(); await p.waitForTimeout(400);
  await p.locator('.fade-in button', { hasText: 'Copy link' }).click(); await p.waitForTimeout(400);
  ok('copy link puts the URL on the clipboard', (await p.evaluate(() => navigator.clipboard.readText())) === url);
  await p.locator('.fade-in button', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);

  console.log('\nPublished page');
  await p.goto(PAGE + '?p=' + url.split('?p=')[1]); await p.waitForTimeout(1600);
  const pubText = await text(p);
  ok('loads with no sign-in gate', pubText.includes('Read-only'));
  ok('title is the project, not the tool', !(await p.title()).includes('Pipeline Tool'), await p.title());
  ok('step matrix appears exactly once', (await p.evaluate(() => document.querySelectorAll('.pub-mx').length)) === 1);
  ok('has a document section per document', (await p.evaluate(() => document.querySelectorAll('.pub-doc').length)) > 0);
  ok('connectors have a rule, not just an arrowhead',
     (await p.evaluate(() => [...document.querySelectorAll('.pub-conn:not(.spacer) i')].length)) > 0);

  // Marks must survive a printer that drops background colours.
  await p.addStyleTag({ content: '*{background-color:transparent!important;background-image:none!important}' });
  await p.waitForTimeout(300);
  const coloured = await p.evaluate(() => {
    const cols = el => getComputedStyle(el).borderTopColor;
    const dots = [...document.querySelectorAll('.pub-mx .nd')];
    return dots.length > 0 && dots.every(d => { const c = cols(d); return c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)'; });
  });
  ok('step dots keep their colour without background printing', coloured);

  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(300);
  const printBg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok('print background is white (no grey block on the last page)', printBg === 'rgb(255, 255, 255)', printBg);


  console.log('\nVisual pass');
  // The publishing checks above navigate to the published page — come back, and
  // clear the display preferences the earlier checks left in localStorage.
  await p.goto(PAGE); await p.waitForTimeout(600);
  await p.evaluate(() => { localStorage.removeItem('cs_pipeline_doc_prefs_v1'); });
  await p.goto(PAGE); await p.waitForTimeout(1400);
  await p.evaluate(() => window.scrollTo(0, 0));
  ok('no emoji left in the step cards', await p.evaluate(() => {
    // card content only — the hover controls use typographic glyphs (v, x, arrows)
    const t = [...document.querySelectorAll('.step-card')].map(c => {
      const clone = c.cloneNode(true);
      clone.querySelectorAll('.step-controls').forEach(n => n.remove());
      return clone.innerText || clone.textContent;
    }).join(' ');
    return !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t);
  }));
  ok('action rows carry an svg icon, not a text glyph',
    await p.locator('.step-card svg').count() > 0);
  ok('roles render as pills', await p.locator('.role-pill').count() > 0);
  ok('filed location keeps its icon', await p.evaluate(() =>
    [...document.querySelectorAll('.filed-chip')].every(c => !!c.querySelector('svg'))));
  // Read the grid definition rather than a box: widths are still settling while
  // Tailwind's CDN build and Babel finish, and a transient 0 is not a failure.
  const tracks = () => p.evaluate(() => {
    const g = document.querySelector('.doc-grid');
    return g ? getComputedStyle(g).gridTemplateColumns : '';
  });
  const t1 = await tracks();
  ok('columns are a grid that shares the canvas, not fixed 260px columns',
    /px/.test(t1) && t1.split(' ').length > 1 && !/260px/.test(t1), t1);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Wide');
    if (b) b.click();
  });
  await p.waitForTimeout(400);
  const t2 = await tracks();
  ok('the width preference changes the column minimum', t2 !== t1, `${t1} -> ${t2}`);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Standard');
    if (b) b.click();
  });
  await p.waitForTimeout(300);

  console.log('\nWorkflows rename');
  // Scoped to the sidebar: textContent is safe here because the inlined program
  // source lives outside <aside>, and innerText drops content the harness has
  // scrolled out of view.
  const shell = await p.evaluate(() => {
    const a = document.querySelector('aside');
    return a ? a.textContent : '';
  });
  ok('sidebar and menus say Workflows, not Project Types',
    /Workflows/.test(shell) && /Manage Workflows/.test(shell) && !/project type/i.test(shell),
    (shell.match(/.{0,30}project type.{0,30}/i) || ['sidebar text: ' + shell.slice(0, 60)])[0]);
  ok('workflow list is drag-reorderable, with no up/down buttons', await p.evaluate(() => {
    const rows = [...document.querySelectorAll('aside div[draggable="true"]')];
    return rows.length > 1 && !rows.some(r => /▲|▼/.test(r.textContent));
  }));

  console.log('\nWorkflow notes');
  // Clicked through the DOM: by this point the harness has scrolled the canvas,
  // and this checks behaviour, not hit-testing.
  const clickNotes = () => p.evaluate(() => {
    const b = document.querySelector('button[title="Add notes for this workflow"], button[title="This workflow has notes"]');
    if (b) b.click();
    return !!b;
  });
  await resetScroll(p); await p.waitForTimeout(150);
  ok('toolbar carries a workflow Notes button', await clickNotes());
  await p.waitForTimeout(300);
  ok('notes panel opens from the toolbar', await p.locator('textarea').count() > 0);
  await p.evaluate(() => {
    const ta = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, 'Allow two weeks for AQA scheduling.');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(400);
  ok('a workflow with notes flags them on the button',
    await p.locator('button[title="This workflow has notes"]').count() > 0);
  await clickNotes(); await p.waitForTimeout(250);
  ok('notes panel collapses again (closed by default)',
    await p.locator('textarea').count() === 0);

  console.log('\nStep Flow');
  // Fresh load: these assertions hit-test real coordinates, so they need a page
  // the earlier checks have not scrolled.
  await p.goto(PAGE); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Step Flow'));
    if (b) b.click();
  });
  await p.waitForTimeout(800);
  // The panel used to be painted over by the sticky matrix header (z-30) and
  // the sticky document column (z-40), because its toolbar was also z-30.
  // Compare the stacking levels rather than hit-testing: deterministic, and it
  // is exactly what regressed.
  const zs = await p.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Details'));
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 350));
    const panel = document.querySelector('.fade-in');
    if (!panel) return null;
    let bar = panel.parentElement;               // nearest ancestor that sets a z-index
    while (bar && !(parseInt(getComputedStyle(bar).zIndex, 10) > 0)) bar = bar.parentElement;
    const sticky = [...document.querySelectorAll('.sticky')]
      .map(e => parseInt(getComputedStyle(e).zIndex, 10) || 0);
    return { toolbar: bar ? parseInt(getComputedStyle(bar).zIndex, 10) || 0 : 0, maxSticky: Math.max(0, ...sticky) };
  });
  ok('Details panel outranks the sticky matrix header',
    !!zs && zs.toolbar > zs.maxSticky, zs ? `toolbar z${zs.toolbar} vs sticky z${zs.maxSticky}` : 'no panel');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('clicking a cell opens read-only step detail', await p.evaluate(async () => {
    const cell = document.querySelector('[title="Click for the full step detail"]');
    if (!cell) return false;
    cell.click();
    await new Promise(r => setTimeout(r, 350));
    const t = document.body.innerText;
    return t.includes('Read-only') || t.includes('steps at this stage');
  }));
  ok('that detail cannot edit the step', await p.evaluate(() =>
    !document.body.innerText.includes('Save Changes')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().endsWith('Documents'));
    if (b) b.click();
  });
  await p.waitForTimeout(500);

  console.log('\nErrors');
  ok('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
