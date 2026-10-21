import { describe, expect, it } from 'vitest';
import { NAV, isGroup } from './layout/nav';
import { router, screenPaths } from './routes';

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

  it('لكل عنصر في القائمة شاشة فعلية وليس «قيد التطوير»', () => {
    const leaves = NAV.flatMap((n) => (isGroup(n) ? n.items : [n]));
    const screens = new Set(screenPaths());
    // الرئيسية لها مسار فهرس مستقل / the home page has its own index route
    const missing = leaves.map((l) => l.path).filter((p) => p !== '/' && !screens.has(p));
    expect(missing).toEqual([]);
  });
});
