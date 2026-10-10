import { z } from 'zod';

export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export const NOTIFICATION_LOCALES = ['ar', 'en'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

/** فئات الإشعارات: الإلزامية لا يستطيع المستخدم تعطيلها */
export const NOTIFICATION_CATEGORIES = [
  { key: 'approvals', mandatory: false },
  { key: 'archive', mandatory: false },
  { key: 'system', mandatory: false },
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['key'];

export type NotificationText = { subject: string; body: string };

export type NotificationEventDef = {
  key: string;
  category: NotificationCategory;
  /** المتغيرات المسموحة في القوالب: {{name}} */
  variables: readonly string[];
  /** النصوص الافتراضية (تُستعمل للقناتين ما لم يوجد تخصيص في القاعدة) */
  defaults: Record<NotificationLocale, NotificationText>;
};

/** أحداث النظام. المراحل اللاحقة تضيف أحداثها هنا (الإجازات، الحضور، الرواتب...). */
export const NOTIFICATION_EVENTS: readonly NotificationEventDef[] = [
  {
    key: 'approval.assigned',
    category: 'approvals',
    variables: ['requester', 'entity'],
    defaults: {
      ar: {
        subject: 'طلب موافقة جديد',
        body: 'لديك طلب موافقة بانتظارك: {{entity}} مقدَّم من {{requester}}.',
      },
      en: {
        subject: 'New approval request',
        body: 'You have an approval waiting: {{entity}} submitted by {{requester}}.',
      },
    },
  },
  {
    key: 'approval.approved',
    category: 'approvals',
    variables: ['entity', 'approver'],
    defaults: {
      ar: { subject: 'تمت الموافقة على طلبك', body: 'وافق {{approver}} على طلبك: {{entity}}.' },
      en: {
        subject: 'Your request was approved',
        body: '{{approver}} approved your request: {{entity}}.',
      },
    },
  },
  {
    key: 'approval.rejected',
    category: 'approvals',
    variables: ['entity', 'approver', 'reason'],
    defaults: {
      ar: {
        subject: 'تم رفض طلبك',
        body: 'رفض {{approver}} طلبك: {{entity}}. السبب: {{reason}}',
      },
      en: {
        subject: 'Your request was rejected',
        body: '{{approver}} rejected your request: {{entity}}. Reason: {{reason}}',
      },
    },
  },
  {
    key: 'approval.returned',
    category: 'approvals',
    variables: ['entity', 'approver', 'reason'],
    defaults: {
      ar: {
        subject: 'أُعيد طلبك للتعديل',
        body: 'أعاد {{approver}} طلبك للتعديل: {{entity}}. الملاحظة: {{reason}}',
      },
      en: {
        subject: 'Your request needs changes',
        body: '{{approver}} returned your request: {{entity}}. Note: {{reason}}',
      },
    },
  },
  {
    key: 'archive.reminder',
    category: 'archive',
    variables: ['documentType', 'owner', 'dueDate'],
    defaults: {
      ar: {
        subject: 'تذكير بوثيقة قاربت على الانتهاء',
        body: 'الوثيقة «{{documentType}}» الخاصة بـ {{owner}} تستحق بتاريخ {{dueDate}}.',
      },
      en: {
        subject: 'Document due soon',
        body: 'The document "{{documentType}}" for {{owner}} is due on {{dueDate}}.',
      },
    },
  },
  {
    key: 'digest.daily',
    category: 'system',
    variables: ['user', 'summary'],
    defaults: {
      ar: { subject: 'ملخصك اليومي', body: 'مرحباً {{user}}،\n{{summary}}' },
      en: { subject: 'Your daily digest', body: 'Hello {{user}},\n{{summary}}' },
    },
  },
  {
    key: 'system.test',
    category: 'system',
    variables: ['user'],
    defaults: {
      ar: { subject: 'إشعار تجريبي', body: 'مرحباً {{user}}، هذا إشعار تجريبي من النظام.' },
      en: { subject: 'Test notification', body: 'Hello {{user}}, this is a test notification.' },
    },
  },
];

export const notificationEvent = (key: string): NotificationEventDef | undefined =>
  NOTIFICATION_EVENTS.find((e) => e.key === key);

export const isMandatoryCategory = (category: string): boolean =>
  NOTIFICATION_CATEGORIES.some((c) => c.key === category && c.mandatory);

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** يستبدل {{name}} بالقيمة (فارغ إن غابت) */
export const renderTemplate = (text: string, vars: Record<string, string | undefined>): string =>
  text.replace(PLACEHOLDER, (_m, name: string) => vars[name] ?? '');

/** المتغيرات المستعملة في نص قالب */
export const templateVariables = (text: string): string[] => [
  ...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string)),
];

export const notificationListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const preferencesInput = z.object({
  items: z
    .array(
      z.object({
        category: z.string().min(1).max(50),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

export const templateInput = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  isActive: z.boolean().default(true),
});

export type NotificationDto = {
  id: string;
  eventKey: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export type PreferenceMatrix = {
  category: string;
  mandatory: boolean;
  channels: Record<NotificationChannel, boolean>;
}[];
