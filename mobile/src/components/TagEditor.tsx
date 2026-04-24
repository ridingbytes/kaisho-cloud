import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  tagBadgeStyle, hexToRgba,
} from "../utils/tagColors"

export interface TagDef {
  name: string
  color: string
}

/**
 * Tag editor with toggle chips.
 *
 * View mode: shows selected tags as filled pills.
 * Edit mode: shows selected tags as filled pills,
 * with a toggle to reveal unselected tags as outlined
 * pills that can be tapped to add.
 */
export function TagEditor({
  tags,
  editing,
  onChange,
  allTags,
}: {
  tags: string[]
  editing: boolean
  onChange: (tags: string[]) => void
  allTags: TagDef[]
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const unselected = allTags.filter(
    (td) => !tags.includes(td.name),
  )

  function styleFor(name: string) {
    const c = allTags.find(
      (t) => t.name === name,
    )?.color
    return c ? tagBadgeStyle(c) : undefined
  }

  function inactiveStyle(hex: string) {
    if (!hex) return undefined
    return {
      background: hexToRgba(hex, 0.06),
      color: hexToRgba(hex, 0.7),
      borderColor: hexToRgba(hex, 0.25),
    }
  }

  function toggle(name: string) {
    if (tags.includes(name)) {
      onChange(tags.filter((t) => t !== name))
    } else {
      onChange([...tags, name])
    }
  }

  if (
    tags.length === 0
    && (!editing || allTags.length === 0)
  ) {
    return null
  }

  return (
    <div className="detail-field">
      <div className="detail-label">
        {t("detail.tags")}
      </div>
      <div className="tag-editor">
        {tags.map((tag) => (
          <button
            key={tag}
            className="tag-chip tag-chip-active"
            style={styleFor(tag)}
            onClick={
              editing
                ? () => toggle(tag)
                : undefined
            }
            disabled={!editing}
          >
            {tag}
          </button>
        ))}
        {editing && unselected.length > 0 && (
          <>
            <button
              className="tag-toggle-btn"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "-" : "+"}
              {!expanded && (
                <span className="tag-toggle-count">
                  {unselected.length}
                </span>
              )}
            </button>
            {expanded && unselected.map((td) => (
              <button
                key={td.name}
                className="tag-chip tag-chip-inactive"
                style={inactiveStyle(td.color)}
                onClick={() => toggle(td.name)}
              >
                {td.name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
