import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { pino, type Logger } from 'pino';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export const createLogger = (level: string): Logger =>
  pino({ level, redact: ['req.headers.authorization', 'req.headers.cookie'] });

/** يعيّن requestId لكل طلب (من الترويسة إن وُجدت) ويعيده في الاستجابة. */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};
