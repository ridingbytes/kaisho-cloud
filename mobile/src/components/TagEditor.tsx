import { useState } from "react"
import { useTranslation } from "react-i18next"

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

  function colorFor(name: string): string {
    return (
      allTags.find((t) => t.name === name)?.color
      || ""
    )
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
        {tags.map((tag) => {
          const c = colorFor(tag)
          return (
            <button
              key={tag}
              className="tag-chip tag-chip-active"
              style={c ? {
                background: c + "22",
                color: c,
                borderColor: c + "55",
              } : undefined}
              onClick={
                editing
                  ? () => toggle(tag)
                  : undefined
              }
              disabled={!editing}
            >
              {tag}
            </button>
          )
        })}
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
                style={td.color ? {
                  borderColor: td.color + "55",
                  color: td.color,
                } : undefined}
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
