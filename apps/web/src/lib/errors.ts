import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';

/** رسالة خطأ مترجمة من رمز الخطأ؛ رسائل الخادم المحددة (مثل كلمة المرور) تمر كما هي. */
export const errorMessage = (err: unknown, t: TFunction): string => {
  if (!(err instanceof ApiError)) return t('apiErrors.generic');
  // رسائل الخادم المحددة (تذكر الحقل المخالف) تمر كما هي
  if (['WEAK_PASSWORD', 'CUSTOM_FIELD_INVALID', 'DOCUMENT_FIELD_INVALID'].includes(err.code))
    return err.message;
  return t(`apiErrors.${err.code}`, { defaultValue: t('apiErrors.generic') });
};
