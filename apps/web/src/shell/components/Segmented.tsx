type Option<T> = { value: T; label: string };

type SegmentedProps<T extends string | null> = { value: T; options: Option<T>[]; onChange: (value: T) => void; disabled?: boolean; testid: string };

export const Segmented = <T extends string | null>({ value, options, onChange, disabled = false, testid }: SegmentedProps<T>) => (
  <div className="segmented" role="group" data-testid={testid}>
    {options.map((o) => (
      <button key={String(o.value)} type="button" data-testid={`${testid}-${o.value ?? 'default'}`} aria-pressed={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
        {o.label}
      </button>
    ))}
  </div>
);
