// الدليل المكتوب: مقالات Markdown في docs/guide/articles، مصدر واحد للمستودع والتطبيق.
// The written guide: Markdown articles in docs/guide/articles, a single source for the repo and the app.
// لإضافة مقال: أنشئ ملفاً جديداً بترويسة (انظر docs/guide/README.md) ولا حاجة لأي كود.
// To add an article: create a new file with front matter (see docs/guide/README.md); no code needed.

export const GUIDE_ROLES = ['employee', 'manager', 'hr', 'admin'] as const;
export type GuideRole = (typeof GUIDE_ROLES)[number];

export type Article = {
  id: string;
  title: string;
  summary: string;
  roles: GuideRole[];
  order: number;
  body: string;
};

/** يقرأ ترويسة `---` البسيطة (مفتاح: قيمة) ويفصلها عن النص / parses simple `---` front matter */
export const parseArticle = (id: string, raw: string): Article => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const roles = (meta['roles'] ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is GuideRole => (GUIDE_ROLES as readonly string[]).includes(r));
  return {
    id,
    title: meta['title'] || id,
    summary: meta['summary'] ?? '',
    roles,
    order: Number(meta['order']) || 999,
    body: m ? (m[2] ?? '') : raw,
  };
};

const files = import.meta.glob('../../../../../docs/guide/articles/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const images = import.meta.glob('../../../../../docs/guide/images/*.{png,jpg,jpeg,gif,webp,svg}', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** اسم الملف بلا مسار/امتداد ← رابط الصورة بعد البناء / bare file name -> built image URL */
export const imageUrls: Record<string, string> = Object.fromEntries(
  Object.entries(images).map(([p, url]) => [p.split('/').pop() ?? p, url]),
);

export const ARTICLES: Article[] = Object.entries(files)
  .map(([p, raw]) => parseArticle((p.split('/').pop() ?? p).replace(/\.md$/, ''), raw))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ar'));

export const matches = (a: Article, q: string): boolean => {
  const s = q.trim().toLowerCase();
  return !s || `${a.title}\n${a.summary}\n${a.body}`.toLowerCase().includes(s);
};
