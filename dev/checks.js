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
  ok('hiding detail removes it', !bare.includes('Prepares/Presents'));
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

  console.log('\nErrors');
  ok('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
