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

type PgError = { code: string; constraint?: string; detail?: string; message: string };
const isPgError = (err: unknown): err is PgError =>
  typeof err === 'object' &&
  err !== null &&
  typeof (err as PgError).code === 'string' &&
  /^[0-9A-Z]{5}$/.test((err as PgError).code);

const mapPgError = (err: PgError): { status: number; code: string; message: string } | null => {
  switch (err.code) {
    case '23505':
      return { status: 409, code: 'DUPLICATE', message: 'القيمة موجودة مسبقاً (رمز أو اسم مكرر)' };
    case '23503':
      return { status: 409, code: 'REFERENCE_CONFLICT', message: 'السجل مرتبط ببيانات أخرى' };
    case '23P01':
      return { status: 409, code: 'OVERLAP', message: 'تتداخل الفترة مع سجل آخر للموظف' };
    case '23514':
      return { status: 400, code: 'CONSTRAINT_VIOLATION', message: err.message };
    default:
      return null;
  }
};

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
    } else if (isPgError(err)) {
      const mapped = mapPgError(err);
      if (mapped) ({ status, code, message } = mapped);
    }

    if (status >= 500) logger.error({ err, requestId }, 'unhandled error');

    const body: ApiErrorBody = { error: { code, status, message, details, requestId } };
    res.status(status).json(body);
  };
