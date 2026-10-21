import { describe, expect, it } from 'vitest';
import { ARTICLES, imageUrls, matches, parseArticle } from './articles';
import { renderMarkdown } from './render';

describe('الدليل المكتوب', () => {
  it('يقرأ الترويسة والنص', () => {
    const a = parseArticle(
      'x',
      '---\ntitle: عنوان\nsummary: ملخص\nroles: hr, admin, bogus\norder: 5\n---\nنص',
    );
    expect(a).toMatchObject({ id: 'x', title: 'عنوان', summary: 'ملخص', order: 5, body: 'نص' });
    expect(a.roles).toEqual(['hr', 'admin']);
  });

  it('كل مقال له عنوان وملخص ودور وترتيب فريد المعرّف', () => {
    expect(ARTICLES.length).toBeGreaterThan(10);
    const ids = new Set<string>();
    for (const a of ARTICLES) {
      expect(a.title, a.id).not.toBe(a.id);
      expect(a.summary, a.id).not.toBe('');
      expect(a.roles.length, a.id).toBeGreaterThan(0);
      expect(a.body.trim().length, a.id).toBeGreaterThan(20);
      expect(ids.has(a.id), `معرّف مكرر ${a.id}`).toBe(false);
      ids.add(a.id);
    }
  });

  it('الروابط الداخلية والصور تشير إلى موارد موجودة', () => {
    const ids = new Set(ARTICLES.map((a) => a.id));
    for (const a of ARTICLES) {
      for (const m of a.body.matchAll(/\]\(#([^)]+)\)/g))
        expect(ids.has(m[1]!), `${a.id} → #${m[1]}`).toBe(true);
      for (const m of a.body.matchAll(/\]\((?:\.\/)?images\/([^)]+)\)/g))
        expect(imageUrls[m[1]!], `${a.id} صورة ${m[1]}`).toBeTruthy();
    }
  });

  it('البحث والعرض المعقَّم', () => {
    const a = ARTICLES[0]!;
    expect(matches(a, a.title)).toBe(true);
    expect(matches(a, 'zzzz-لا-يوجد')).toBe(false);
    const html = renderMarkdown('# س\n<script>alert(1)</script>\n[ر](#x)');
    expect(html).toContain('<h1');
    expect(html).not.toContain('<script');
  });
});
