export { createNotificationsRouter, createNotificationTemplatesRouter } from './routes.js';
export { createNotifier, resolveTexts, type Notifier, type NotifyInput } from './service.js';
export { createSmtpTransport, toHtml, type MailTransport, type MailMessage } from './mail.js';
export { createChannelsRouter, createTelegramWebhookRouter } from './channels.routes.js';
export {
  createMailProvider,
  createTelegramProvider,
  type MailProvider,
  type TelegramProvider,
} from './channels.js';
export { createTelegramApi, type TelegramApi } from './telegram.js';
export { notificationJobs } from './jobs.js';
