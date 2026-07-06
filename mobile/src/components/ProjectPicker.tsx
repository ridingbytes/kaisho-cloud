import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { Project } from "../types"
import { projectColor } from "../utils/projects"

interface Props {
  value: string
  projects: Project[]
  onChange: (id: string) => void
}

/**
 * Project selector used across every editor. A styled
 * trigger showing the current project's colour dot + name,
 * opening an in-flow list (no portal, so it works inside
 * the Modal without z-index fights). Archived projects are
 * hidden unless one is already selected.
 */
export function ProjectPicker(props: Props) {
  const { value, projects, onChange } = props
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const selected = projects.find((p) => p.id === value)
  const options = projects.filter(
    (p) => p.status !== "ARCHIVED" || p.id === value,
  )

  function pick(id: string) {
    onChange(id)
    setOpen(false)
  }

  return (
    <div className="project-picker">
      <button
        type="button"
        className="project-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {selected ? (
          <>
            <span
              className="project-dot"
              style={{
                background: projectColor(selected),
              }}
            />
            <span className="project-picker-name">
              {selected.name}
            </span>
          </>
        ) : (
          <span className="project-picker-placeholder">
            {t("projects.none")}
          </span>
        )}
        <svg
          className="select-caret" width="14" height="14"
          viewBox="0 0 20 20" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>

      {open && (
        <ul className="project-picker-list" role="listbox">
          <li
            className={
              "project-picker-item" +
              (value ? "" : " active")
            }
            onClick={() => pick("")}
          >
            <span className="project-dot project-dot--none" />
            {t("projects.none")}
          </li>
          {options.map((p) => (
            <li
              key={p.id}
              className={
                "project-picker-item" +
                (p.id === value ? " active" : "")
              }
              onClick={() => pick(p.id)}
            >
              <span
                className="project-dot"
                style={{ background: projectColor(p) }}
              />
              <span className="project-picker-name">
                {p.name}
              </span>
              {p.customer && (
                <span className="project-picker-sub">
                  {p.customer}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Small inline badge used on task/note/entry rows to show
 * which project the item belongs to. Renders nothing when
 * the project id does not resolve (e.g. deleted project).
 */
export function ProjectBadge(props: {
  projectId?: string | null
  projects: Project[]
}) {
  const { projectId, projects } = props
  if (!projectId) return null
  const project = projects.find((p) => p.id === projectId)
  if (!project) return null
  const color = projectColor(project)
  return (
    <span
      className="project-badge"
      style={{
        color,
        background: color + "1f",
        borderColor: color + "44",
      }}
    >
      <span
        className="project-dot"
        style={{ background: color }}
      />
      {project.name}
    </span>
  )
}
