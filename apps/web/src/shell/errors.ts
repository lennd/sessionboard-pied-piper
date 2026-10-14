import { messages, type MessageKey } from '../i18n/messages';
import { ApiError } from './api';

const WITH_DETAIL = new Set(['gh_failed']);

/** Localized text for an error; unexplained GitHub failures also carry GitHub's own reason so the user can act on it. */
export const errorText = (t: (key: MessageKey) => string, error: unknown): string => {
  const api = error instanceof ApiError ? error : null;
  const key = `errors.${api ? api.code : 'unknown'}`;
  const text = key in messages.en ? t(key as MessageKey) : t('errors.unknown' as MessageKey);
  return api && WITH_DETAIL.has(api.code) && api.extra.detail ? `${text} ${api.extra.detail}` : text;
};

/** Link the server attached to the error (for example the pending review that blocks a new one), when there is one. */
export const errorLink = (error: unknown): string | null => (error instanceof ApiError && error.extra.url) || null;
