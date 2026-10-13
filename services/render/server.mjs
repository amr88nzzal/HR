// خدمة تحويل HTML إلى PDF (Chromium). داخلية فقط: لا منفذ منشور، ولا اتصال بالإنترنت من الصفحات.
//   POST /pdf  {"html": "<!doctype html>..."}  ->  application/pdf
//   GET  /health
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT ?? 3100);
const MAX_BODY = 1_000_000;
const chromePath = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/opt/pw-browsers/chromium',
].find((p) => p && existsSync(p));
if (!chromePath) throw new Error('لم يُعثر على Chromium (اضبط CHROMIUM_PATH)');

let browser;
const getBrowser = async () => {
  if (!browser || !browser.isConnected())
    browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  return browser;
};

// تحويل واحد في كل مرة بسياق معزول؛ بلا جافاسكربت ولا شبكة
let queue = Promise.resolve();
const toPdf = (html) => {
  const job = queue.then(async () => {
    const ctx = await (await getBrowser()).newContext({ javaScriptEnabled: false, offline: true });
    try {
      const page = await ctx.newPage();
      await page.route('**/*', (r) =>
        r.request().url().startsWith('data:') ? r.continue() : r.abort(),
      );
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready).catch(() => undefined);
      return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await ctx.close();
    }
  });
  queue = job.catch(() => undefined);
  return job;
};

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/pdf') {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      res.writeHead(413).end();
      req.destroy();
    } else chunks.push(c);
  });
  req.on('end', async () => {
    try {
      const { html } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof html !== 'string' || !html) throw new Error('html مطلوب');
      const pdf = await toPdf(html);
      res
        .writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length })
        .end(pdf);
    } catch (err) {
      console.error('render failed:', err?.message);
      res.writeHead(500, { 'content-type': 'text/plain' }).end('render failed');
    }
  });
});
server.listen(PORT, () => console.log(`render listening on ${PORT} (${chromePath})`));
process.on('SIGTERM', () => {
  server.close();
  void browser?.close();
  process.exit(0);
});
