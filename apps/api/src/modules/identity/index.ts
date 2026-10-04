export { createAuthRouter, REFRESH_COOKIE, type IdentityRoutesDeps } from './routes.js';
export {
  allowedBranchIds,
  createAuthenticate,
  hasPermission,
  requirePermission,
  type AuthContext,
} from './middleware.js';
export type { AuthSettings } from './auth.service.js';
export {
  seedDefaultRoles,
  syncPermissionCatalog,
  clearSnapshotCache,
  invalidateSnapshot,
} from './permissions.service.js';
export { hashPassword, checkPasswordPolicy } from './password.js';
export { PERMISSION_CATALOG, DEFAULT_ROLES } from './catalog.js';
