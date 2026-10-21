import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { imageUrls } from './articles';

/**
 * Markdown ← HTML معقَّم. الصور تُكتب `images/اسم.png` وتُحوَّل إلى روابط الحزمة؛
 * الروابط `#مقال` تبقى داخلية.
 * Markdown -> sanitized HTML. Images are written `images/name.png` and resolved to bundle URLs;
 * `#article` links stay internal.
 */
export const renderMarkdown = (md: string): string => {
  const html = marked.parse(md, { async: false, gfm: true }) as string;
  const withImages = html.replace(/src="(?:\.\/)?images\/([^"]+)"/g, (whole, name: string) => {
    const url = imageUrls[name];
    return url ? `src="${url}"` : whole;
  });
  return DOMPurify.sanitize(withImages);
};
