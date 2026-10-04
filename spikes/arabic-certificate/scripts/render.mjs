// نموذج أولي: يولّد شهادة عربية بطريقتين ويقارن النتيجة
//   1) HTML -> PDF  (Chromium عبر playwright-core)
//   2) DOCX (docxtemplater) -> PDF (LibreOffice)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { chromium } from 'playwright-core';
import QRCode from 'qrcode';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));

const chromePath = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find((p) => p && existsSync(p));
if (!chromePath) throw new Error('لم يُعثر على Chromium (اضبط CHROMIUM_PATH)');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const time = async (label, fn) => {
  const t = Date.now();
  await fn();
  console.log(`${label}: ${Date.now() - t}ms`);
};

// ---- 1) HTML -> PDF
await time('HTML->PDF', async () => {
  const qr = await QRCode.toDataURL(data.verify_url, { margin: 0, width: 256 });
  let html = readFileSync(join(root, 'templates/certificate.ar.html'), 'utf8');
  html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => (k === 'qr_data_url' ? qr : esc(data[k] ?? '')));
  const htmlPath = join(root, 'templates/.rendered.html'); // بجوار الخطوط لتعمل المسارات النسبية
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: join(out, 'certificate.html.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();
});

// ---- 2) DOCX -> PDF
await time('DOCX fill', async () => {
  const zip = new PizZip(readFileSync(join(root, 'templates/certificate.ar.docx')));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{', end: '}' } });
  // الأرقام/التواريخ/الأكواد اللاتينية داخل فقرة RTL تنعكس (2026-10-04 -> 04-10-2026)؛ نحصرها في سياق LTR
  const MARKS = { lre: ['\u202A', '\u202C'], lrm: ['\u200E', '\u200E'], lri: ['\u2066', '\u2069'] };
  const [LRE, PDF] = MARKS[process.env.WRAP ?? 'lri'];
  const isLatinToken = (v) => /^[\x20-\x7E]+$/.test(v) && /[0-9A-Za-z]/.test(v);
  const docxData = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, typeof v === 'string' && isLatinToken(v) ? `${LRE}${v}${PDF}` : v]),
  );
  doc.render(docxData);
  writeFileSync(join(out, 'certificate.docx'), doc.getZip().generate({ type: 'nodebuffer' }));
});
await time('DOCX->PDF (LibreOffice)', async () => {
  execFileSync(
    'soffice',
    ['--headless', '--norestore', '-env:UserInstallation=file:///tmp/lo-profile', '--convert-to', 'pdf', '--outdir', out, join(out, 'certificate.docx')],
    { stdio: 'inherit', timeout: 120_000 },
  );
});
// الاسم الناتج certificate.pdf -> نعيد تسميته ليتميز
execFileSync('mv', [join(out, 'certificate.pdf'), join(out, 'certificate.docx.pdf')]);

// ---- 3) فحوصات
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' });
for (const f of ['certificate.html.pdf', 'certificate.docx.pdf']) {
  const pdf = join(out, f);
  console.log(`\n=== ${f} ===`);
  console.log(run('pdfinfo', [pdf]).split('\n').filter((l) => /Pages|Page size/.test(l)).join('\n'));
  console.log(run('pdffonts', [pdf]));
  run('pdftoppm', ['-png', '-r', '70', '-singlefile', pdf, pdf.replace(/\.pdf$/, '')]);
}
console.log('تم. افحص ملفات PNG في out/ بصرياً (اتصال الحروف، اتجاه الأرقام، الجدول).');
