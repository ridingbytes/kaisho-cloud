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
  const [activeIdx, setActiveIdx] = useState(-1)
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

  const visible = matches.slice(0, 10)
  const optionCount =
    visible.length + (canCreate ? 1 : 0)
  const showList = open && optionCount > 0

  function selectIndex(idx: number) {
    if (idx < visible.length) {
      onChange(visible[idx].name)
    }
    setOpen(false)
    setActiveIdx(-1)
  }

  function handleKeyDown(
    e: React.KeyboardEvent,
  ) {
    if (!showList) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) =>
        i < optionCount - 1 ? i + 1 : 0,
      )
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) =>
        i > 0 ? i - 1 : optionCount - 1,
      )
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault()
      selectIndex(activeIdx)
    } else if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      setActiveIdx(-1)
    }
  }

  return (
    <div className="customer-picker">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        value={value}
        placeholder={placeholder}
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIdx >= 0
            ? `cp-option-${activeIdx}`
            : undefined
        }
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActiveIdx(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() =>
          setTimeout(() => setOpen(false), 150)
        }
        onKeyDown={handleKeyDown}
      />
      {showList && (
        <ul
          className="customer-picker-list"
          role="listbox"
        >
          {visible.map((c, i) => (
            <li
              key={c.name}
              id={`cp-option-${i}`}
              role="option"
              aria-selected={i === activeIdx}
              className={
                "customer-picker-item" +
                (i === activeIdx ? " active" : "")
              }
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(c.name)
                setOpen(false)
                setActiveIdx(-1)
              }}
            >
              {c.name}
            </li>
          ))}
          {canCreate && (
            <li
              id={`cp-option-${visible.length}`}
              role="option"
              aria-selected={
                visible.length === activeIdx
              }
              className={
                "customer-picker-item " +
                "customer-picker-item--new" +
                (visible.length === activeIdx
                  ? " active"
                  : "")
              }
              onMouseDown={(e) => {
                e.preventDefault()
                setOpen(false)
                setActiveIdx(-1)
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
