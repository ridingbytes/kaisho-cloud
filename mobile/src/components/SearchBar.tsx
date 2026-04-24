import { useRef, useEffect } from "react"
import type { TagDef } from "./TagEditor"
import { tagBadgeStyle } from "../utils/tagColors"

/**
 * Toggleable search bar with fulltext input and
 * removable tag filter chips.
 *
 * When hidden, renders a magnifier button.
 * When open, replaces the add form area with a
 * search input containing active tag chips.
 */
export function SearchBar({
  searchText,
  onSearchChange,
  activeTags,
  onTagToggle,
  visible,
  onToggle,
  allTags,
}: {
  searchText: string
  onSearchChange: (text: string) => void
  activeTags: string[]
  onTagToggle: (tag: string) => void
  visible: boolean
  onToggle: () => void
  allTags: TagDef[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (visible) inputRef.current?.focus()
  }, [visible])

  if (!visible) {
    return (
      <button
        className="search-toggle-btn"
        onClick={onToggle}
        title="Search"
      >
        <svg
          width="16" height="16"
          viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <line x1="13" y1="13" x2="18" y2="18" />
        </svg>
      </button>
    )
  }

  function colorFor(name: string) {
    return allTags.find((t) => t.name === name)
      ?.color || ""
  }

  return (
    <div className="search-bar">
      <div className="search-bar-inner">
        <svg
          className="search-bar-icon"
          width="14" height="14"
          viewBox="0 0 20 20"
          fill="none" stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <line x1="13" y1="13" x2="18" y2="18" />
        </svg>
        {activeTags.map((tag) => {
          const c = colorFor(tag)
          return (
            <span
              key={tag}
              className="search-tag-chip"
              style={c ? tagBadgeStyle(c) : undefined}
            >
              {tag}
              <button
                className="search-tag-remove"
                onClick={() => onTagToggle(tag)}
              >
                &times;
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={searchText}
          onChange={(e) =>
            onSearchChange(e.target.value)
          }
          placeholder="Search..."
        />
      </div>
      <button
        className="search-close-btn"
        onClick={() => {
          onSearchChange("")
          onToggle()
        }}
      >
        &times;
      </button>
    </div>
  )
}
