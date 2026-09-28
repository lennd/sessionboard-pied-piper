import { useId, type InputHTMLAttributes } from 'react';

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: string };

export const Field = ({ label, error, hint, className, ...input }: FieldProps) => {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={['input', error && 'has-error', className].filter(Boolean).join(' ')}
        aria-invalid={Boolean(error)}
        aria-describedby={note ? noteId : undefined}
        {...input}
      />
      {error ? (
        <span id={noteId} className="field-error" role="alert">{error}</span>
      ) : (
        hint && <span id={noteId} className="field-hint">{hint}</span>
      )}
    </div>
  );
};
