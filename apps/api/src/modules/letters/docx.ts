import { createHash } from 'node:crypto';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { LETTER_VARIABLES, LETTER_VARIABLE_KEYS } from '@hrms/shared';
import { AppError } from '../../shared/errors.js';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_ENTRIES = 300;
const MAX_UNZIPPED = 50 * 1024 * 1024;
const TAG_RE = /\{\{([^{}]*)\}\}/g;
const KEY_RE = /^[A-Za-z0-9_.]+$/;
const LRI = '⁦';
const PDI = '⁩';

const bad = (problems: string[]) =>
  new AppError('INVALID_TEMPLATE', 400, 'ملف DOCX غير صالح', { problems });

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const textParts = (name: string) =>
  name === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(name);

/** نص كل فقرة (تُدمج أجزاء w:t المتجاورة لأن Word يقسّم المتغير بين مقاطع). */
const paragraphTexts = (xml: string): string[] =>
  [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) =>
    [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
  );

/**
 * يفحص ملف DOCX المرفوع: بنية سليمة، بلا ماكرو ولا كائنات مضمّنة ولا روابط خارجية
 * للموارد، وكل متغيراته معروفة. يعيد المتغيرات المستعملة.
 */
export const inspectDocx = (buf: Buffer): { variables: string[] } => {
  let zip: PizZip;
  try {
    zip = new PizZip(buf);
  } catch {
    throw bad(['الملف ليس DOCX صالحاً']);
  }
  const names = Object.keys(zip.files);
  const problems: string[] = [];
  if (!zip.files['word/document.xml'] || !zip.files['[Content_Types].xml'])
    throw bad(['الملف ليس مستند Word']);
  if (names.length > MAX_ENTRIES) problems.push('عدد مكونات الملف كبير جداً');
  let total = 0;
  for (const n of names) {
    const d = (zip.files[n] as unknown as { _data?: { uncompressedSize?: number } })._data;
    total += d?.uncompressedSize ?? 0;
  }
  if (total > MAX_UNZIPPED) problems.push('حجم المحتوى بعد الفك كبير جداً');
  if (problems.length) throw bad(problems);

  if (names.some((n) => /vbaProject|vbaData|macros?\//i.test(n)))
    problems.push('ممنوع الماكرو (VBA)');
  if (names.some((n) => /^word\/(embeddings|activeX)\//i.test(n)))
    problems.push('ممنوع الكائنات المضمّنة (OLE/ActiveX)');
  const types = zip.file('[Content_Types].xml')?.asText() ?? '';
  if (/macroEnabled/i.test(types)) problems.push('ممنوع المستندات الممكّنة للماكرو (docm)');
  for (const n of names.filter((x) => x.endsWith('.rels'))) {
    const rels = zip.file(n)?.asText() ?? '';
    for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/i.test(r[0]) && !/\/hyperlink"/i.test(r[0]))
        problems.push('ممنوع الموارد الخارجية (قالب مرتبط أو صور بعيدة)');
    }
  }

  const used = new Set<string>();
  for (const n of names.filter(textParts)) {
    for (const para of paragraphTexts(zip.file(n)?.asText() ?? '')) {
      for (const m of para.matchAll(TAG_RE)) {
        const key = (m[1] ?? '').trim();
        if (!KEY_RE.test(key)) problems.push(`وسم غير مسموح: {{${key}}} (المتغيرات البسيطة فقط)`);
        else if (key === 'document.qr')
          problems.push(
            'document.qr غير مدعوم في قوالب DOCX؛ استعمل document.number وdocument.verifyUrl',
          );
        else if (!LETTER_VARIABLE_KEYS.has(key)) problems.push(`متغير غير معروف: ${key}`);
        else used.add(key);
      }
      const stripped = para.replace(TAG_RE, '');
      if (/\{\{|\}\}/.test(stripped)) problems.push('أقواس {{ }} غير متوازنة');
    }
  }
  if (problems.length) throw bad([...new Set(problems)]);
  return { variables: [...used] };
};

/** يملأ المتغيرات في DOCX مع عزل اتجاه التواريخ والأكواد (LRI…PDI) وإبقاء الباقي كما هو. */
export const fillDocx = (buf: Buffer, values: Record<string, string | null>): Buffer => {
  const data: Record<string, string> = {};
  for (const v of LETTER_VARIABLES) {
    const raw = values[v.key];
    data[v.key] =
      raw === null || raw === undefined || raw === ''
        ? '—'
        : v.kind === 'date' || v.kind === 'code'
          ? `${LRI}${raw}${PDI}`
          : raw;
  }
  try {
    const doc = new Docxtemplater(new PizZip(buf), {
      delimiters: { start: '{{', end: '}}' },
      paragraphLoop: true,
      linebreaks: true,
      parser: (tag: string) => ({ get: () => data[tag.trim()] ?? '—' }),
      nullGetter: () => '—',
    });
    doc.render();
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch {
    throw new AppError('DOCX_FILL_FAILED', 422, 'تعذّر ملء قالب DOCX');
  }
};
