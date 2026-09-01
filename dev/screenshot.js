// Screenshots the preview so a visual change can actually be looked at.
//   node screenshot.js documents|flow|rowlock|published [outfile.png]
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PAGE = 'file://' + path.join(__dirname, '.out', 'preview.html');
const EXEC = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const view = process.argv[2] || 'documents';
const out = process.argv[3] || path.join(__dirname, '.out', view + '.png');

(async () => {
  const browser = await chromium.launch(fs.existsSync(EXEC) ? { executablePath: EXEC } : {});
  const p = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
  await p.goto(PAGE); await p.waitForTimeout(1400);

  if (view === 'flow') { await p.click('text=🪜 Step Flow'); await p.waitForTimeout(600); }
  if (view === 'rowlock') { await p.locator('button', { hasText: 'Row Lock' }).click(); await p.waitForTimeout(700); }
  if (view === 'published') {
    await p.locator('button', { hasText: /Publish/ }).first().click(); await p.waitForTimeout(400);
    const url = await p.evaluate(() => { const i = [...document.querySelectorAll('input')].find(x => x.readOnly); return i ? i.value : ''; });
    await p.locator('.fade-in button').last().click(); await p.waitForTimeout(900);
    await p.goto(PAGE + '?p=' + url.split('?p=')[1]); await p.waitForTimeout(1600);
    await p.pdf({ path: out.replace(/\.png$/, '.pdf'), width: '11in', height: '8.5in', printBackground: true,
                  margin: { top: '0.35in', bottom: '0.35in', left: '0.35in', right: '0.35in' } });
    console.log('wrote', out.replace(/\.png$/, '.pdf'));
  }
  await p.screenshot({ path: out, fullPage: view === 'published' });
  console.log('wrote', out);
  await browser.close();
})();
