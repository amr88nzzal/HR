import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@hrms/shared';

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', 404, `المسار غير موجود: ${req.method} ${req.path}`));
};

export const createErrorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (err, req, res, _next) => {
    const requestId = req.requestId ?? 'unknown';
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'حدث خطأ غير متوقع';
    let details: unknown;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof ZodError) {
      status = 400;
      code = 'VALIDATION_ERROR';
      message = 'بيانات غير صالحة';
      details = err.flatten();
    }

    if (status >= 500) logger.error({ err, requestId }, 'unhandled error');

    const body: ApiErrorBody = { error: { code, status, message, details, requestId } };
    res.status(status).json(body);
  };
