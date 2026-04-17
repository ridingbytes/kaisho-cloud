import { useRef, useState } from "react"
import type { Customer } from "../types"

interface Props {
  value: string
  customers: Customer[]
  onChange: (v: string) => void
  placeholder?: string
  synced: boolean
}

/**
 * Combobox-style customer picker.
 *
 * Lets the user pick from the ``/ref/customers`` list or
 * type an ad-hoc name. The local kaisho app will
 * auto-create the customer record on the next pull.
 *
 * ``synced=false`` (cloud unreachable / no customers
 * loaded) disables ad-hoc input so we never create an
 * entry referencing a customer the local app hasn't
 * heard of.
 */
export function CustomerPicker(props: Props) {
  const {
    value, customers, onChange,
    placeholder = "Customer", synced,
  } = props
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const lower = value.toLowerCase()
  const matches = customers.filter(
    (c) => c.name.toLowerCase().includes(lower),
  )
  const exact = customers.some(
    (c) => c.name === value.trim(),
  )
  const canCreate =
    synced && value.trim().length > 0 && !exact

  return (
    <div className="customer-picker">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => setOpen(false), 150)
        }
      />
      {open && (matches.length > 0 || canCreate) && (
        <ul className="customer-picker-list">
          {matches.slice(0, 10).map((c) => (
            <li
              key={c.name}
              className="customer-picker-item"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(c.name)
                setOpen(false)
              }}
            >
              {c.name}
            </li>
          ))}
          {canCreate && (
            <li
              className={
                "customer-picker-item " +
                "customer-picker-item--new"
              }
              onMouseDown={(e) => {
                e.preventDefault()
                setOpen(false)
              }}
            >
              Use &quot;{value.trim()}&quot;
              <span className="customer-picker-hint">
                new customer
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
