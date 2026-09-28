const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800], ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
];

export const formatRelative = (iso: string | null, locale: string, now: Date = new Date()): string | null => {
  if (!iso) return null;
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ['second', 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(seconds / size), unit);
};

export const formatDate = (iso: string, locale: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
