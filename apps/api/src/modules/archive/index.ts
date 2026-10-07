import type { RequestHandler, Router } from 'express';
import type { Db } from '../../db/index.js';
import type { FieldCrypto } from '../../shared/crypto.js';
import type { FileDeps } from '../../shared/stored-files.js';
import { createDocumentsRouter, createRemindersRouter } from './documents.routes.js';
import { createDocumentTypesRouter } from './types.routes.js';

/** يركّب مسارات الأرشيف تحت /api/v1 */
export const mountArchiveRoutes = (
  api: Router,
  db: Db,
  authenticate: RequestHandler,
  files: FileDeps,
  crypto: FieldCrypto | undefined,
): void => {
  api.use('/document-types', createDocumentTypesRouter(db, authenticate));
  api.use('/document-reminders', createRemindersRouter(db, authenticate));
  api.use('/documents', createDocumentsRouter(db, authenticate, files, crypto));
};
