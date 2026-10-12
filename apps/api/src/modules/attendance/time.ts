const DAY_MS = 86_400_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

const formatter = (tz: string): Intl.DateTimeFormat => {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
};

/** التاريخ المحلي (YYYY-MM-DD) والدقائق منذ منتصف الليل المحلي في منطقة زمنية. */
export const localParts = (ts: Date, tz: string): { date: string; minute: number } => {
  const p: Record<string, string> = {};
  for (const x of formatter(tz).formatToParts(ts)) p[x.type] = x.value;
  return {
    date: `${p['year']}-${p['month']}-${p['day']}`,
    minute: Number(p['hour']) * 60 + Number(p['minute']),
  };
};

export const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** فرق الأيام a - b (تواريخ ISO). */
export const diffDays = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);

/** اللحظة (UTC) التي يكون عندها التوقيت المحلي في المنطقة هو date + HH:MM. */
export const localToUtc = (date: string, hhmm: string, tz: string): Date => {
  const want = Date.parse(`${date}T${hhmm}:00Z`);
  let guess = want;
  for (let i = 0; i < 3; i += 1) {
    const lp = localParts(new Date(guess), tz);
    const got = Date.parse(`${lp.date}T00:00:00Z`) + lp.minute * 60_000;
    const delta = want - got;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
};

export const minutesOf = (hhmm: string): number =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
