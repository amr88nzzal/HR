import { describe, expect, it } from 'vitest';
import { NAV, isGroup } from './layout/nav';
import { router } from './routes';

describe('المسارات', () => {
  it('لكل عنصر في القائمة (مستقلاً كان أو داخل مجموعة) مسار فعلي', () => {
    const leaves = NAV.flatMap((n) => (isGroup(n) ? n.items : [n]));
    const missing = leaves
      .map((l) => l.path)
      .filter(
        (path) =>
          !router
            .matchRoutes(path)
            .some((m) => m.pathname === path && !['__root__', '/auth'].includes(m.routeId)),
      );
    expect(missing).toEqual([]);
  });
});
