/**
 * One labelled form control with its hint and error message.
 *
 * Errors are rendered under the input and tied to it with aria-describedby, so
 * a screen reader announces the problem when focus lands on the broken field.
 */
export function Field({ label, htmlFor, hint, error, children }) {
  const hintId = hint ? `${htmlFor}-hint` : undefined
  const errId = error ? `${htmlFor}-err` : undefined
  return (
    <div className="field" data-invalid={error ? 'true' : 'false'}>
      <label htmlFor={htmlFor}>{label}</label>
      {hint && <span className="hint" id={hintId}>{hint}</span>}
      {children({ id: htmlFor, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })}
      {error && <span className="field-error" id={errId} role="alert">{error}</span>}
    </div>
  )
}

/** Tap-target-sized alternative to a <select>. Faster on a phone. */
export function Segmented({ options, value, onChange, name, multiple = false }) {
  const selected = multiple ? (value ?? []) : value
  const isOn = (v) => (multiple ? selected.includes(v) : selected === v)

  const toggle = (v) => {
    if (!multiple) return onChange(v)
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  }

  return (
    <div className="seg" role="group" aria-label={name}>
      {options.map(({ value: v, label }) => (
        <button key={v} type="button" className="seg-option"
          aria-pressed={isOn(v)} onClick={() => toggle(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
