/**
 * Form field primitives shared by every editor.
 *
 * One label style, one control style, one grid rhythm —
 * so the clock editor, task editor, note editor, and
 * project editor all look like the same app instead of
 * four hand-rolled forms.
 */

interface FieldProps {
  label: string
  /** Optional hint shown to the right of the label. */
  hint?: string
  children: React.ReactNode
  /** Grow to fill remaining modal height (textareas). */
  grow?: boolean
}

/** Labelled wrapper around any control. */
export function Field(props: FieldProps) {
  const { label, hint, children, grow } = props
  return (
    <div className={"field" + (grow ? " field--grow" : "")}>
      <div className="field-label-row">
        <label className="field-label">{label}</label>
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** Two fields side by side (start/duration, dates). */
export function FieldRow(
  { children }: { children: React.ReactNode },
) {
  return <div className="field-row">{children}</div>
}

interface SelectProps {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}

/** Styled native select (keeps native picker UX). */
export function Select(props: SelectProps) {
  const { value, onChange, children } = props
  return (
    <div className="select-wrap">
      <select
        className="field-control"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <svg
        className="select-caret" width="14" height="14"
        viewBox="0 0 20 20" fill="none"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      >
        <polyline points="5 8 10 13 15 8" />
      </svg>
    </div>
  )
}
