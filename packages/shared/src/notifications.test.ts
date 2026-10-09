import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_EVENTS,
  notificationEvent,
  renderTemplate,
  templateVariables,
} from './notifications.js';

describe('الإشعارات (المشترك)', () => {
  it('يستبدل المتغيرات ويترك الغائب فارغاً', () => {
    expect(renderTemplate('أهلاً {{ name }} — {{x}}', { name: 'عمرو' })).toBe('أهلاً عمرو — ');
  });
  it('يستخرج المتغيرات بلا تكرار', () => {
    expect(templateVariables('{{a}} و{{b}} و{{a}}')).toEqual(['a', 'b']);
  });
  it('كل نص افتراضي لا يستعمل غير متغيرات حدثه، وللحدث لغتان', () => {
    for (const e of NOTIFICATION_EVENTS) {
      for (const loc of ['ar', 'en'] as const) {
        const d = e.defaults[loc];
        for (const v of templateVariables(`${d.subject} ${d.body}`))
          expect(e.variables, `${e.key}/${loc}`).toContain(v);
      }
    }
  });
  it('مفاتيح الأحداث فريدة ويُعثر عليها', () => {
    const keys = NOTIFICATION_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(notificationEvent('system.test')?.category).toBe('system');
    expect(notificationEvent('nope')).toBeUndefined();
  });
});
