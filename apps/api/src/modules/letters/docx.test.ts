import { describe, expect, it } from 'vitest';
import { docxText, makeDocx } from '../../test/docx.js';
import { fillDocx, inspectDocx } from './docx.js';

const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    return (e as { details?: { problems?: string[] } }).details?.problems ?? ['?'];
  }
  return [];
};

describe('قوالب DOCX: الفحص والملء', () => {
  it('يستخرج المتغيرات ولو قُسّمت بين مقاطع Word', () => {
    const d = makeDocx([
      ['تشهد {{company.na', 'me}} بأن {{ employee.fullName }}'],
      'رقم {{document.number}}',
    ]);
    expect(inspectDocx(d).variables.sort()).toEqual([
      'company.name',
      'document.number',
      'employee.fullName',
    ]);
  });

  it('يرفض: متغيراً مجهولاً، وسوماً مركّبة، وQR، وأقواساً غير متوازنة، وما ليس DOCX', () => {
    expect(problemsOf(() => inspectDocx(makeDocx(['{{nope.x}}'])))).toEqual([
      'متغير غير معروف: nope.x',
    ]);
    expect(
      problemsOf(() => inspectDocx(makeDocx(['{{#employee.fullName}}x{{/employee.fullName}}']))),
    ).toHaveLength(2);
    expect(problemsOf(() => inspectDocx(makeDocx(['{{document.qr}}']))).join()).toContain(
      'document.qr',
    );
    expect(problemsOf(() => inspectDocx(makeDocx(['{{employee.fullName']))).join()).toContain(
      'متوازنة',
    );
    expect(problemsOf(() => inspectDocx(Buffer.from('not a zip at all')))).toEqual([
      'الملف ليس DOCX صالحاً',
    ]);
  });

  it('يرفض الماكرو والكائنات المضمّنة والموارد الخارجية ويقبل الروابط', () => {
    const macro = makeDocx(['x'], { files: { 'word/vbaProject.bin': 'zz' } });
    expect(problemsOf(() => inspectDocx(macro))).toContain('ممنوع الماكرو (VBA)');
    const docm = makeDocx(['x'], {
      contentTypes:
        '<Override PartName="/x" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>',
    });
    expect(problemsOf(() => inspectDocx(docm)).join()).toContain('docm');
    const ole = makeDocx(['x'], { files: { 'word/embeddings/o.bin': 'zz' } });
    expect(problemsOf(() => inspectDocx(ole)).join()).toContain('OLE');
    const rel = (type: string) =>
      makeDocx(['x'], {
        files: {
          'word/_rels/document.xml.rels': `<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="http://evil.test/a" TargetMode="External"/></Relationships>`,
        },
      });
    expect(problemsOf(() => inspectDocx(rel('image'))).join()).toContain('الموارد الخارجية');
    expect(problemsOf(() => inspectDocx(rel('hyperlink')))).toEqual([]);
  });

  it('يملأ القيم ويعزل التواريخ والأكواد بـ LRI/PDI ويضع «—» للناقص', () => {
    const d = makeDocx([['{{employee.ful', 'lName}} منذ {{employee.hireDate}}'], '{{job.title}}']);
    const out = fillDocx(d, {
      'employee.fullName': 'أحمد <الخطيب> & ابنه',
      'employee.hireDate': '2024-03-01',
      'job.title': null,
    });
    const t = docxText(out);
    expect(t).toContain('أحمد &lt;الخطيب&gt; &amp; ابنه');
    expect(t).toContain('⁦2024-03-01⁩');
    expect(t).toContain('—');
    expect(t).not.toContain('{{');
  });
});
