export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size * (30 / 36)} viewBox="0 0 36 30" aria-hidden>
    <path d="M6 22 L18 8 L30 22" style={{ stroke: 'var(--accent)' }} strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <circle cx="6" cy="22" r="4.5" style={{ fill: 'var(--accent)' }} />
    <circle cx="18" cy="8" r="4.5" style={{ fill: 'var(--token)' }} />
    <circle cx="30" cy="22" r="4.5" style={{ fill: 'var(--accent)' }} />
  </svg>
);
