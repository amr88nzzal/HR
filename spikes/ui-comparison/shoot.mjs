import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const apps = [['mantine', 4301], ['antd', 4302]];
const procs = apps.map(([a, p]) => spawn('npx', ['vite', 'preview', '--port', String(p), '--strictPort'], { cwd: a, stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 3000));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
for (const [a, p] of apps) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(`http://localhost:${p}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `shots/${a}-list.png` });
  // منتقي التاريخ
  const dp = a === 'mantine' ? page.getByLabel('تاريخ التعيين من') : page.locator('.ant-picker input').first();
  await dp.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `shots/${a}-datepicker.png` });
  await page.keyboard.press('Escape');
  await page.getByText('إضافة موظف').click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `shots/${a}-modal.png` });
  await page.close();
}
await browser.close();
procs.forEach((p) => p.kill());
console.log('ok');
