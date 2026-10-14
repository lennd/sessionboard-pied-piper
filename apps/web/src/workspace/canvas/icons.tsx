import type { Role } from '@rdi/scene';

/** Monochrome role icons drawn in a 24×24 box; stroke-based so they read at small sizes. */
const ROLE_PATHS: Record<Role, string> = {
  actor: 'M3 5h18v11H3z M8 20h8 M12 16v4',
  compute: 'M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4',
  storage: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  channel: 'M4 7h16 M4 12h16 M4 17h16 M18 5l2 2-2 2 M18 15l2 2-2 2',
  external: 'M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9a3.5 3.5 0 0 1 .5 7H7z',
  logic: 'M14 4c-2 0-3 1-3.4 3L9.4 17c-.3 1.6-1 2.6-2.6 3 M6 10h9',
  data: 'M8 4c-2 0-3 1-3 3v2c0 1.5-1 2.5-2 3 1 .5 2 1.5 2 3v2c0 2 1 3 3 3 M16 4c2 0 3 1 3 3v2c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3v2c0 2-1 3-3 3',
};

export const RoleIcon = ({ role, size = 18 }: { role: Role; size?: number }) => (
  <svg className={`role-icon role-${role}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={ROLE_PATHS[role]} />
  </svg>
);

export const REPO_ICON_PATH = 'M4 4h16v16H4z M4 9h16 M9 9v11';

export const RepoIcon = ({ size = 18 }: { size?: number }) => (
  <svg className="role-icon role-repo" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={REPO_ICON_PATH} />
  </svg>
);
