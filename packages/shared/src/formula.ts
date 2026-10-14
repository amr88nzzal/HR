import { Decimal } from 'decimal.js';

/**
 * مفسّر صيغ الرواتب: محلل يدوي بلا eval فوق decimal.js.
 * أرقام وأسماء متغيرات وعمليات (+ - * / %) ومقارنات ودوال محدودة فقط.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Num = InstanceType<typeof D>;
export const num = (v: Decimal.Value): Num => new D(v);

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

export type Node =
  | { t: 'num'; v: string }
  | { t: 'var'; name: string }
  | { t: 'str'; v: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

export const FORMULA_MAX_LENGTH = 500;
const MAX_DEPTH = 30;

/** الدوال المسموحة وعدد وسائطها (الحد الأدنى والأقصى). */
const FUNCTIONS: Record<string, [number, number]> = {
  min: [2, 8],
  max: [2, 8],
  abs: [1, 1],
  floor: [1, 1],
  ceil: [1, 1],
  round: [1, 2],
  if: [3, 3],
  // base('رمز') مبلغ أساس احتساب، table('رمز', قيمة) بحث في جدول نسب
  base: [1, 1],
  table: [2, 2],
};

type Tok = { k: 'num' | 'id' | 'str' | 'op' | 'end'; v: string };

const tokenize = (src: string): Tok[] => {
  if (src.length > FORMULA_MAX_LENGTH) throw new FormulaError('الصيغة طويلة جداً');
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d+)?|\.\d+)/.exec(src.slice(i));
      if (!m) throw new FormulaError('رقم غير صالح');
      out.push({ k: 'num', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ k: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new FormulaError('نص غير مغلق');
      const v = src.slice(i + 1, end);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(v))
        throw new FormulaError('رمز غير صالح داخل علامات الاقتباس');
      out.push({ k: 'str', v });
      i = end + 1;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!='].includes(two)) {
        out.push({ k: 'op', v: two });
        i += 2;
      } else if ('+-*/%(),<>'.includes(c)) {
        out.push({ k: 'op', v: c });
        i++;
      } else throw new FormulaError(`محرف غير مسموح: ${c}`);
    }
  }
  out.push({ k: 'end', v: '' });
  return out;
};

export const parseFormula = (src: string): Node => {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p] as Tok;
  const eat = (v?: string): Tok => {
    const t = peek();
    if (v !== undefined && !(t.k === 'op' && t.v === v)) throw new FormulaError(`متوقع «${v}»`);
    p++;
    return t;
  };
  const isOp = (...ops: string[]) => peek().k === 'op' && ops.includes(peek().v);

  const primary = (depth: number): Node => {
    if (depth > MAX_DEPTH) throw new FormulaError('الصيغة متداخلة أكثر من اللازم');
    const t = peek();
    if (t.k === 'num') {
      p++;
      return { t: 'num', v: t.v };
    }
    if (t.k === 'str') {
      p++;
      return { t: 'str', v: t.v };
    }
    if (t.k === 'id') {
      p++;
      if (isOp('(')) {
        const spec = FUNCTIONS[t.v];
        if (!spec) throw new FormulaError(`دالة غير مسموحة: ${t.v}`);
        eat('(');
        const args: Node[] = [];
        if (!isOp(')')) {
          args.push(compare(depth + 1));
          while (isOp(',')) {
            eat(',');
            args.push(compare(depth + 1));
          }
        }
        eat(')');
        if (args.length < spec[0] || args.length > spec[1])
          throw new FormulaError(`عدد وسائط غير صحيح في ${t.v}`);
        if ((t.v === 'base' || t.v === 'table') && args[0]?.t !== 'str')
          throw new FormulaError(`${t.v} تأخذ رمزاً بين علامتي اقتباس`);
        return { t: 'call', fn: t.v, args };
      }
      return { t: 'var', name: t.v };
    }
    if (isOp('(')) {
      eat('(');
      const e = compare(depth + 1);
      eat(')');
      return e;
    }
    throw new FormulaError('تعبير ناقص');
  };
  const unary = (depth: number): Node => {
    if (isOp('-')) {
      eat('-');
      return { t: 'neg', a: unary(depth + 1) };
    }
    if (isOp('+')) {
      eat('+');
      return unary(depth + 1);
    }
    return primary(depth);
  };
  const mul = (depth: number): Node => {
    let a = unary(depth);
    while (isOp('*', '/', '%')) {
      const op = eat().v;
      a = { t: 'bin', op, a, b: unary(depth) };
    }
    return a;
  };
  const add = (depth: number): Node => {
    let a = mul(depth);
    while (isOp('+', '-')) {
      const op = eat().v;
      a = { t: 'bin', op, a, b: mul(depth) };
    }
    return a;
  };
  const compare = (depth: number): Node => {
    const a = add(depth);
    if (isOp('<', '<=', '>', '>=', '==', '!=')) {
      const op = eat().v;
      return { t: 'bin', op, a, b: add(depth) };
    }
    return a;
  };
  const root = compare(0);
  if (peek().k !== 'end') throw new FormulaError('بقي نص غير مفهوم بعد نهاية الصيغة');
  return root;
};

export type FormulaRefs = { vars: Set<string>; bases: Set<string>; tables: Set<string> };

/** المتغيرات والأسس والجداول التي تذكرها الصيغة (للتحقق عند الحفظ وكشف الحلقات). */
export const formulaRefs = (root: Node): FormulaRefs => {
  const refs: FormulaRefs = { vars: new Set(), bases: new Set(), tables: new Set() };
  const walk = (n: Node): void => {
    if (n.t === 'var') refs.vars.add(n.name);
    else if (n.t === 'neg') walk(n.a);
    else if (n.t === 'bin') {
      walk(n.a);
      walk(n.b);
    } else if (n.t === 'call') {
      const first = n.args[0];
      if (n.fn === 'base' && first?.t === 'str') refs.bases.add(first.v);
      else if (n.fn === 'table' && first?.t === 'str') refs.tables.add(first.v);
      n.args.forEach((a, i) => {
        if (!(i === 0 && (n.fn === 'base' || n.fn === 'table'))) walk(a);
      });
    }
  };
  walk(root);
  return refs;
};

export type FormulaEnv = {
  variable: (name: string) => Num | undefined;
  base: (code: string) => Num;
  table: (code: string, value: Num) => Num;
};

export const evalFormula = (root: Node, env: FormulaEnv): Num => {
  const ev = (n: Node): Num => {
    switch (n.t) {
      case 'num':
        return num(n.v);
      case 'str':
        throw new FormulaError('نص في موضع رقم');
      case 'var': {
        const v = env.variable(n.name);
        if (v === undefined) throw new FormulaError(`متغير غير معروف: ${n.name}`);
        return v;
      }
      case 'neg':
        return ev(n.a).neg();
      case 'bin': {
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case '+':
            return a.plus(b);
          case '-':
            return a.minus(b);
          case '*':
            return a.times(b);
          case '/':
            if (b.isZero()) throw new FormulaError('القسمة على صفر');
            return a.div(b);
          case '%':
            if (b.isZero()) throw new FormulaError('القسمة على صفر');
            return a.mod(b);
          case '<':
            return num(a.lt(b) ? 1 : 0);
          case '<=':
            return num(a.lte(b) ? 1 : 0);
          case '>':
            return num(a.gt(b) ? 1 : 0);
          case '>=':
            return num(a.gte(b) ? 1 : 0);
          case '==':
            return num(a.eq(b) ? 1 : 0);
          default:
            return num(a.eq(b) ? 0 : 1);
        }
      }
      case 'call': {
        const [first] = n.args;
        if (n.fn === 'base') return env.base((first as { v: string }).v);
        if (n.fn === 'table') return env.table((first as { v: string }).v, ev(n.args[1] as Node));
        if (n.fn === 'if')
          return ev(first as Node).isZero() ? ev(n.args[2] as Node) : ev(n.args[1] as Node);
        const xs = n.args.map(ev);
        const x = xs[0] as Num;
        switch (n.fn) {
          case 'min':
            return D.min(...xs);
          case 'max':
            return D.max(...xs);
          case 'abs':
            return x.abs();
          case 'floor':
            return x.floor();
          case 'ceil':
            return x.ceil();
          default: {
            const dp = xs[1] ? xs[1].toNumber() : 0;
            if (!Number.isInteger(dp) || dp < 0 || dp > 6)
              throw new FormulaError('خانات التقريب بين 0 و6');
            return x.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
          }
        }
      }
    }
  };
  return ev(root);
};

// ───── جداول النسب (شرائح قانونية قابلة للضبط) ─────
export type RateBracket = { from: string; to: string | null; rate: string; fixed: string };

/**
 * progressive: ضريبة تصاعدية (كل شريحة على الجزء الواقع فيها).
 * slab: الشريحة التي يقع فيها المبلغ تُطبَّق على كامل المبلغ.
 * كل شريحة: الناتج = fixed + rate × (الجزء أو المبلغ) (rate نسبة مئوية).
 */
export const applyRateTable = (
  mode: 'progressive' | 'slab',
  brackets: readonly RateBracket[],
  value: Num,
): Num => {
  if (value.lte(0)) return num(0);
  const sorted = [...brackets].sort((a, b) => num(a.from).cmp(num(b.from)));
  if (mode === 'slab') {
    const hit = [...sorted]
      .reverse()
      .find((b) => value.gte(num(b.from)) && (b.to === null || value.lt(num(b.to))));
    return hit ? num(hit.fixed).plus(value.times(num(hit.rate)).div(100)) : num(0);
  }
  let total = num(0);
  for (const b of sorted) {
    const lo = num(b.from);
    if (value.lte(lo)) break;
    const hi = b.to === null ? value : D.min(value, num(b.to));
    total = total.plus(num(b.fixed)).plus(hi.minus(lo).times(num(b.rate)).div(100));
  }
  return total;
};
