import { describe, expect, it } from 'vitest';
import { computeDay, pair, type DayInput, type Punch } from './engine';

const p = (minute: number, direction: 'in' | 'out' | null = null): Punch<number> => ({
  minute,
  direction,
  ref: minute,
});
const hm = (h: number, m = 0) => h * 60 + m;

const work = (over: Partial<DayInput<number>> = {}): DayInput<number> => ({
  kind: 'work',
  segments: [{ start: hm(8), end: hm(16) }],
  lateGrace: 10,
  earlyLeaveGrace: 5,
  holiday: false,
  leaveUnits: 0,
  isPast: true,
  punches: [],
  ...over,
});

describe('محرك الحضور', () => {
  it('يوم كامل في موعده: حاضر بلا تأخير', () => {
    const r = computeDay(work({ punches: [p(hm(7, 55)), p(hm(16, 5))] }));
    expect(r).toMatchObject({
      status: 'present',
      workedMinutes: 480,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      scheduledMinutes: 480,
    });
    expect(r.surplusMinutes).toBe(10); // 5 قبل + 5 بعد
  });

  it('السماح: 10 دقائق لا تُحتسب، و11 تُحتسب كاملة من بداية الوردية', () => {
    const ok = computeDay(work({ punches: [p(hm(8, 10)), p(hm(16))] }));
    expect(ok.lateMinutes).toBe(0);
    const late = computeDay(work({ punches: [p(hm(8, 11)), p(hm(16))] }));
    expect(late.lateMinutes).toBe(11);
    expect(late.workedMinutes).toBe(469);
  });

  it('انصراف مبكر بعد السماح', () => {
    const r = computeDay(work({ punches: [p(hm(8)), p(hm(15, 30))] }));
    expect(r.earlyLeaveMinutes).toBe(30);
    expect(r.workedMinutes).toBe(450);
  });

  it('غياب (يوم مضى) أو بانتظار (اليوم) عند عدم وجود بصمات', () => {
    expect(computeDay(work()).status).toBe('absent');
    expect(computeDay(work({ isPast: false })).status).toBe('pending');
  });

  it('بصمة واحدة أو فترة مستحيلة = ناقص', () => {
    expect(computeDay(work({ punches: [p(hm(8))] })).status).toBe('incomplete');
    expect(computeDay(work({ punches: [p(hm(1)), p(hm(23, 30))] })).status).toBe('incomplete');
  });

  it('الإجازة الكاملة والعطلة تغلبان الغياب', () => {
    expect(computeDay(work({ leaveUnits: 1 })).status).toBe('leave');
    expect(computeDay(work({ holiday: true })).status).toBe('holiday');
    // نصف يوم إجازة بلا بصمات = إجازة وليس غياباً
    expect(computeDay(work({ leaveUnits: 0.5 })).status).toBe('leave');
  });

  it('الراحة وبلا جدول: لا غياب، والبصمات تُسجَّل عملاً', () => {
    const off = computeDay(work({ kind: 'off', segments: [], punches: [p(hm(9)), p(hm(13))] }));
    expect(off).toMatchObject({ status: 'off', workedMinutes: 240, scheduledMinutes: 0 });
    expect(computeDay(work({ kind: 'none', segments: [] })).status).toBe('unscheduled');
    expect(computeDay(work({ kind: 'off', segments: [] })).status).toBe('off');
  });

  it('الدوام المقسوم: العمل داخل الفترتين فقط (الاستراحة لا تُحتسب)', () => {
    const r = computeDay(
      work({
        segments: [
          { start: hm(8), end: hm(12) },
          { start: hm(16), end: hm(20) },
        ],
        punches: [p(hm(8)), p(hm(20))],
      }),
    );
    expect(r).toMatchObject({ status: 'present', workedMinutes: 480, scheduledMinutes: 480 });
    expect(r.surplusMinutes).toBe(240); // استراحة 12–16 داخل البصمتين خارج الفترات
  });

  it('الدوام الليلي يعبر منتصف الليل', () => {
    const r = computeDay(
      work({
        segments: [{ start: hm(22), end: 1440 + hm(6) }],
        lateGrace: 15,
        punches: [p(hm(21, 50)), p(1440 + hm(6, 2))],
      }),
    );
    expect(r).toMatchObject({ status: 'present', workedMinutes: 480, lateMinutes: 0 });
  });

  describe('مزاوجة البصمات', () => {
    it('بلا نوع: الأولى دخول والأخيرة خروج ويُتجاهل ما بينهما', () => {
      const { inP, outP } = pair([p(hm(13)), p(hm(8)), p(hm(10)), p(hm(17))]);
      expect([inP?.minute, outP?.minute]).toEqual([hm(8), hm(17)]);
    });
    it('مع النوع: أول in وآخر out، وخروج قبل الدخول لا يصلح', () => {
      const ok = pair([p(hm(8), 'in'), p(hm(12), 'out'), p(hm(13), 'in'), p(hm(17), 'out')]);
      expect([ok.inP?.minute, ok.outP?.minute]).toEqual([hm(8), hm(17)]);
      const bad = pair([p(hm(7), 'out'), p(hm(8), 'in')]);
      expect(bad.outP).toBeNull();
    });
  });
});
