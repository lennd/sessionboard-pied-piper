import { messages, type MessageKey } from '../i18n/messages';
import { ApiError } from './api';

export const errorText = (t: (key: MessageKey) => string, error: unknown): string => {
  const key = `errors.${error instanceof ApiError ? error.code : 'unknown'}`;
  return key in messages.en ? t(key as MessageKey) : t('errors.unknown' as MessageKey);
};
