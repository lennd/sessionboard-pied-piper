import type { ReactNode } from 'react';
import '../aurora.css';

export const AuroraBackground = ({ children, soft = false }: { children: ReactNode; soft?: boolean }) => (
  <div className={soft ? 'aurora aurora-soft' : 'aurora'}>
    <div className="aurora-blob b1" aria-hidden />
    <div className="aurora-blob b2" aria-hidden />
    <div className="aurora-blob b3" aria-hidden />
    <div className="aurora-grain" aria-hidden />
    <div className="aurora-content">{children}</div>
  </div>
);
