export const hasPermission = (permissions: readonly string[], code: string | undefined): boolean =>
  code === undefined || permissions.includes(code);

export const hasAnyPermission = (
  permissions: readonly string[],
  codes: readonly string[] | undefined,
): boolean => !codes || codes.length === 0 || codes.some((c) => permissions.includes(c));
