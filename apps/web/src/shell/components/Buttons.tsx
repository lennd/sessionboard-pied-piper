import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean };

export const PrimaryButton = ({ loading = false, children, disabled, className, ...rest }: Props) => (
  <button {...rest} className={['btn-primary', className].filter(Boolean).join(' ')} disabled={loading || disabled} aria-busy={loading}>
    {loading ? '…' : children}
  </button>
);

export const GhostButton = ({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button {...rest} type={type} className={['btn-ghost', className].filter(Boolean).join(' ')} />
);
