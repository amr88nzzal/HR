import sharp from 'sharp';

/**
 * أصول الهوية البصرية التجريبية: شعار وختم لشركة وهمية، بأشكال هندسية فقط (بلا نص كي لا تتوقف على الخطوط).
 * Demo brand assets: a logo and a stamp for a fictional company, geometric shapes only (no text, so no font dependency).
 */
const mark = (fill: string, glyph: string) => `
  <rect x="10" y="10" width="180" height="180" rx="38" fill="${fill}"/>
  <rect x="48" y="104" width="26" height="54" rx="6" fill="${glyph}"/>
  <rect x="87" y="70" width="26" height="88" rx="6" fill="${glyph}"/>
  <rect x="126" y="42" width="26" height="116" rx="6" fill="${glyph}"/>`;

const logoSvg = (
  dark: boolean,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 600 200">
  <g>${mark('#0f766e', '#ffffff')}</g>
  <rect x="220" y="62" width="330" height="34" rx="17" fill="${dark ? '#f1f5f9' : '#0f2f2c'}"/>
  <rect x="220" y="114" width="210" height="22" rx="11" fill="${dark ? '#5eead4' : '#14b8a6'}"/>
</svg>`;

/** ختم دائري بحلقتين وحلقة شرطات ونجمة، بلون الحبر الأزرق. / A round stamp: two rings, a dash ring and a star, in blue ink. */
const stampSvg = () => {
  const dashes = Array.from({ length: 48 }, (_, i) => {
    const a = (i * 360) / 48;
    return `<rect x="298" y="62" width="4" height="22" rx="2" fill="#1d3b8b" transform="rotate(${a} 300 300)"/>`;
  }).join('');
  const star = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 92 : 38;
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    return `${(300 + r * Math.cos(a)).toFixed(1)},${(300 + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <g opacity="0.88" fill="none" stroke="#1d3b8b">
    <circle cx="300" cy="300" r="280" stroke-width="12"/>
    <circle cx="300" cy="300" r="256" stroke-width="3"/>
    <circle cx="300" cy="300" r="150" stroke-width="6"/>
  </g>
  <g opacity="0.88">${dashes}<polygon points="${star}" fill="#1d3b8b"/></g>
</svg>`;
};

export type DemoBrandImages = { logo: Buffer; logoDark: Buffer; stamp: Buffer };

export const demoBrandImages = async (): Promise<DemoBrandImages> => {
  const png = (svg: string) => sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
  return {
    logo: await png(logoSvg(false)),
    logoDark: await png(logoSvg(true)),
    stamp: await png(stampSvg()),
  };
};

/** صورة فاتورة تجريبية بأشكال هندسية (ورقة وأسطر وشريط إجمالي) بلا نص. / A demo invoice picture in geometric shapes (page, lines, total bar), no text. */
export const demoInvoiceImage = (): Promise<Buffer> => {
  const lines = Array.from(
    { length: 6 },
    (_, i) =>
      `<rect x="60" y="${190 + i * 44}" width="${i % 2 ? 260 : 330}" height="14" rx="7" fill="#cbd5e1"/><rect x="380" y="${190 + i * 44}" width="60" height="14" rx="7" fill="#94a3b8"/>`,
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="640" viewBox="0 0 500 640">
  <rect width="500" height="640" fill="#e2e8f0"/>
  <rect x="20" y="20" width="460" height="600" rx="14" fill="#ffffff"/>
  <rect x="60" y="56" width="120" height="44" rx="10" fill="#0f766e"/>
  <rect x="300" y="64" width="140" height="12" rx="6" fill="#94a3b8"/><rect x="340" y="86" width="100" height="12" rx="6" fill="#cbd5e1"/>
  <rect x="60" y="140" width="380" height="2" fill="#e2e8f0"/>${lines}
  <rect x="60" y="480" width="380" height="2" fill="#e2e8f0"/>
  <rect x="270" y="510" width="170" height="40" rx="10" fill="#fd7e14"/>
</svg>`;
  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
};
