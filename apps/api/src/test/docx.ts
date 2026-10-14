import PizZip from 'pizzip';

const CT = (extra = '') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra}</Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

/** DOCX أدنى للاختبار: كل عنصر في paragraphs فقرة، والعنصر المصفوفة يُقسَّم إلى مقاطع w:r (كما يفعل Word). */
export const makeDocx = (
  paragraphs: (string | string[])[],
  opts: { files?: Record<string, string>; contentTypes?: string } = {},
): Buffer => {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = paragraphs
    .map((p) => {
      const runs = (Array.isArray(p) ? p : [p])
        .map((t) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`)
        .join('');
      return `<w:p><w:pPr><w:bidi/></w:pPr>${runs}</w:p>`;
    })
    .join('');
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CT(opts.contentTypes));
  zip.file('_rels/.rels', RELS);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  for (const [n, c] of Object.entries(opts.files ?? {})) zip.file(n, c);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

export const docxText = (buf: Buffer): string =>
  [
    ...(new PizZip(buf).file('word/document.xml')?.asText() ?? '').matchAll(
      /<w:t[^>]*>([^<]*)<\/w:t>/g,
    ),
  ]
    .map((m) => m[1])
    .join('|');
