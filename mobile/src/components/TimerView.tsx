import {
  useCallback, useEffect, useRef, useState,
} from "react"
import { useTranslation } from "react-i18next"
import type { Customer, Project, TaskRef } from "../types"
import {
  getActive,
  getCustomers,
  getTasks,
  getSyncedProjects,
  startTimer,
  stopTimer,
  updateEntry,
  ApiError,
} from "../api"
import { onWsEvent } from "../ws"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { CustomerPicker } from "./CustomerPicker"
import { ProjectPicker } from "./ProjectPicker"
import { EditEntrySheet } from "./EditEntrySheet"
import { Markdown } from "./Markdown"
import { UpgradeBanner } from "./UpgradeBanner"
import { formatElapsed } from "../utils/formatElapsed"
import type { ActiveTimer, ClockEntry } from "../types"

/** Adapt a running ``ActiveTimer`` to the
 * ``ClockEntry`` shape ``EditEntrySheet`` expects.
 * The sheet only reads ``id``, ``start``, ``end``,
 * ``customer``, ``description``, ``task_id``,
 * ``contract``, ``notes``, ``invoiced``; we hand it
 * sensible defaults for the rest so TypeScript stays
 * happy without inventing data. */
function activeTimerToEntry(t: ActiveTimer): ClockEntry {
  return {
    id: t.id ?? "",
    start: t.start ?? new Date().toISOString(),
    end: null,
    customer: t.customer ?? null,
    description: t.description ?? "",
    duration_minutes: null,
    task_id: t.task_id ?? null,
    contract: t.contract ?? null,
    notes: t.notes ?? "",
    invoiced: t.invoiced ?? false,
    updated_at: t.updated_at,
  }
}

export function TimerView() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [timer, setTimer] = useState<ActiveTimer | null>(
    null,
  )
  // After Stop, we keep the just-finished timer in the
  // UI with its frozen elapsed time so the user can
  // resume the same customer/task/description with one
  // tap. A second tap on the (now-Clear) button flushes
  // this local state and returns to the empty start
  // form. The underlying entry is already persisted —
  // this state only controls what the running-timer
  // card shows.
  const [stopped, setStopped] = useState<{
    timer: ActiveTimer
    finalElapsed: string
  } | null>(null)
  const [elapsed, setElapsed] = useState("00:00:00")
  const [customers, setCustomers] = useState<Customer[]>(
    [],
  )
  const [tasks, setTasks] = useState<TaskRef[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [customer, setCustomer] = useState("")
  const [contract, setContract] = useState("")
  const [taskId, setTaskId] = useState("")
  const [projectId, setProjectId] = useState("")
  const [desc, setDesc] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)
  const [loading, setLoading] = useState(false)
  // Suppress WS refreshes while a local mutation is
  // in-flight or recently completed. Prevents the
  // optimistic UI from flickering when the server's
  // broadcast arrives after our own API response.
  const suppressUntilRef = useRef(0)

  // Inline notes capture on the running timer. The
  // backend already accepts notes on PATCH /clocks/{id};
  // we save the local value, then debounce-flush via
  // the existing API. Sync propagates the notes back to
  // the desktop the same way as any other clock-entry
  // edit — no new endpoint required.
  const [notes, setNotes] = useState("")
  const notesDebounceRef = useRef<number | null>(null)
  const notesAreaRef = useRef<HTMLTextAreaElement>(null)
  // Markdown preview / edit toggle. Idle state shows
  // the rendered markdown; tapping it switches into the
  // raw textarea so the user can edit. Auto-flips back
  // on blur if there's saved content to render.
  const [editingNotes, setEditingNotes] = useState(false)

  // Edit sheet for the running entry — reuses the same
  // bottom-sheet editor as the historical Entries view
  // so we have one canonical place to change customer,
  // contract, task, description, notes.
  const [editing, setEditing] = useState(false)

  const refreshActive = useCallback(async () => {
    try {
      const active = await getActive()
      const newTimer = active.active ? active : null
      setTimer(newTimer)
      // If a new active timer arrived while we were
      // showing a local "stopped" snapshot (e.g. another
      // device started one), drop the snapshot so the
      // user is not stuck in paused mode.
      if (newTimer) setStopped(null)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [active, custs, tsks, projs] =
        await Promise.all([
          getActive(),
          getCustomers(),
          getTasks(),
          getSyncedProjects().catch(() => []),
        ])
      setTimer(active.active ? active : null)
      setCustomers(custs)
      setTasks(tsks)
      setProjects(projs)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Real-time updates via WebSocket. Refresh active
  // timer when another device starts or stops.
  // Visibility fallback for iOS PWA background resume.
  //
  // ``suppressUntilRef`` is honoured for ``timer:stopped``
  // (avoid flickering our own optimistic UI when the
  // server's echo arrives a moment later) but NOT for
  // ``timer:started``: a start event after a local stop
  // means another device picked up — we always want to
  // act on it, otherwise the user is stuck in the
  // pinned-stopped view while the desktop is tracking.
  useEffect(() => {
    const offStart = onWsEvent(
      "timer:started", () => {
        refreshActive()
      },
    )
    const offStop = onWsEvent(
      "timer:stopped", () => {
        if (Date.now() > suppressUntilRef.current) refreshActive()
      },
    )
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshActive()
      }
    }
    document.addEventListener(
      "visibilitychange", onVisible,
    )
    return () => {
      offStart()
      offStop()
      document.removeEventListener(
        "visibilitychange", onVisible,
      )
    }
  }, [refreshActive])

  useEffect(() => {
    if (!timer?.start) return
    const tick = () =>
      setElapsed(formatElapsed(timer.start!))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timer?.start])

  // Pin a stopped snapshot whenever the running timer
  // disappears — covers both the user's own Stop click
  // (handleStop already sets `stopped`, so the !stopped
  // guard makes this branch a no-op) AND a stop initiated
  // by another device, where only the WS event fires
  // setTimer(null) without setting the snapshot.
  const prevTimerRef = useRef<ActiveTimer | null>(null)
  useEffect(() => {
    const prev = prevTimerRef.current
    prevTimerRef.current = timer
    const wasRunning = !!(prev && prev.start)
    const stillRunning = !!(timer && timer.start)
    if (wasRunning && !stillRunning && !stopped) {
      setStopped({
        timer: prev as ActiveTimer,
        finalElapsed: formatElapsed(prev!.start!),
      })
    }
  }, [timer, stopped])

  // Sync the local notes textarea with the active
  // timer's notes whenever the timer object changes
  // (e.g. WS refresh, page reload). We never overwrite
  // a draft the user is currently typing — only when the
  // timer id changes.
  const lastTimerIdRef = useRef<string | null>(null)
  useEffect(() => {
    const newId = timer?.id ?? null
    if (newId !== lastTimerIdRef.current) {
      setNotes(timer?.notes ?? "")
      lastTimerIdRef.current = newId
    }
  }, [timer?.id, timer?.notes])

  function handleNotesChange(next: string) {
    setNotes(next)
    if (!timer?.id) return
    const entryId = timer.id
    if (notesDebounceRef.current) {
      window.clearTimeout(notesDebounceRef.current)
    }
    notesDebounceRef.current = window.setTimeout(() => {
      suppressUntilRef.current = Date.now() + 2000
      updateEntry(entryId, { notes: next })
        .catch((err) => {
          if (err instanceof ApiError) setError(err.message)
        })
    }, 600)
  }

  // Resume: pre-fill form from an Entries-view tap.
  // When ``autoStart`` is set, submit the form
  // automatically so the timer fires immediately.
  useEffect(() => {
    function onResume(event: Event) {
      const detail = (
        event as CustomEvent<{
          customer: string
          description: string
          task_id: string
          contract: string
          project?: string
          autoStart?: boolean
        }>
      ).detail
      setCustomer(detail.customer || "")
      setDesc(detail.description || "")
      setTaskId(detail.task_id || "")
      setContract(detail.contract || "")
      setProjectId(detail.project || "")
      if (detail.autoStart && !timer) {
        // Optimistic: show timer immediately
        suppressUntilRef.current = Date.now() + 3000
        setTimer({
          active: true,
          id: "",
          customer: detail.customer || null,
          description: detail.description || "",
          start: new Date().toISOString(),
          end: null,
          task_id: detail.task_id || null,
          project: detail.project || null,
          contract: detail.contract || null,
        })
        // Fire API call in background
        startTimer({
          customer: detail.customer || undefined,
          description: detail.description || "",
          task_id: detail.task_id || undefined,
          contract: detail.contract || undefined,
          project: detail.project || undefined,
        })
          .then((result) => {
            setTimer(result)
            toast(t("timer.started"))
          })
          .catch((err) => {
            setTimer(null)
            if (err instanceof ApiError) {
              setError(err.message)
            }
          })
      }
    }
    window.addEventListener(
      "resume-entry", onResume as EventListener,
    )
    return () => {
      window.removeEventListener(
        "resume-entry", onResume as EventListener,
      )
    }
  }, [timer, toast])

  const selectedCustomer = customers.find(
    (c) => c.name === customer,
  )
  const contracts = selectedCustomer?.contracts ?? []

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // Optimistic UI: show timer immediately so the
    // user gets instant feedback while the API call
    // completes in the background.
    suppressUntilRef.current = Date.now() + 3000
    const optimistic: ActiveTimer = {
      active: true,
      id: "",
      customer: customer || null,
      description: desc,
      start: new Date().toISOString(),
      end: null,
      task_id: taskId || null,
      project: projectId || null,
      contract: contract || null,
    }
    setTimer(optimistic)
    setDesc("")

    try {
      const result = await startTimer({
        customer: customer || undefined,
        description: desc,
        task_id: taskId || undefined,
        contract: contract || undefined,
        project: projectId || undefined,
      })
      setTimer(result)
      toast(t("timer.started"))
    } catch (err) {
      // Revert optimistic update
      setTimer(null)
      if (err instanceof ApiError) {
        if (
          err.status === 403 &&
          err.message.toLowerCase()
            .includes("plan")
        ) {
          setNeedsUpgrade(true)
        } else {
          setError(err.message)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleStop() {
    if (!timer) return
    setError(null)
    suppressUntilRef.current = Date.now() + 3000
    const prev = timer
    // Snapshot the timer for the "stopped, ready to
    // resume" view. We freeze the elapsed text at the
    // moment of stop so the displayed duration matches
    // what was actually recorded.
    setStopped({ timer: prev, finalElapsed: elapsed })
    setTimer(null)
    toast(t("timer.stopped"))
    try {
      await stopTimer()
    } catch (err) {
      // Revert on failure: restore the running timer
      // and drop the stopped snapshot.
      setStopped(null)
      setTimer(prev)
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }

  function handleClearStopped() {
    setStopped(null)
  }

  async function handleResume() {
    if (!stopped) return
    const src = stopped.timer
    setError(null)
    setLoading(true)
    suppressUntilRef.current = Date.now() + 3000
    setStopped(null)
    // Optimistic: pop the running-timer card immediately
    // with the same fields so the user does not see a
    // flash of the empty start form.
    const optimistic: ActiveTimer = {
      active: true,
      id: "",
      customer: src.customer ?? null,
      description: src.description ?? "",
      start: new Date().toISOString(),
      end: null,
      task_id: src.task_id ?? null,
      contract: src.contract ?? null,
    }
    setTimer(optimistic)
    try {
      const result = await startTimer({
        customer: src.customer || undefined,
        description: src.description ?? "",
        task_id: src.task_id || undefined,
        contract: src.contract || undefined,
      })
      setTimer(result)
      toast(t("timer.started"))
    } catch (err) {
      setTimer(null)
      // Restore the stopped card so the user can try
      // again or clear it.
      setStopped({
        timer: src, finalElapsed: stopped.finalElapsed,
      })
      if (err instanceof ApiError) setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (timer) {
    return (
      <div className="view view--timer-running">
        <div className="timer-active card">
          {/* Elapsed counter + inline Stop. Stop is the
              primary action while a timer runs, so it
              sits right next to the readout instead of
              hiding at the bottom of the card. */}
          <div className="timer-header-row">
            <div className="timer-elapsed-line">
              <div className="timer-elapsed">
                {elapsed}
              </div>
              <button
                type="button"
                className="timer-icon-btn timer-icon-btn--stop"
                onClick={handleStop}
                disabled={loading}
                title={t("timer.stop")}
                aria-label={t("timer.stop")}
              >
                <svg
                  width="14" height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect
                    x="6" y="6" width="12" height="12"
                    rx="1"
                  />
                </svg>
              </button>
            </div>
            <div className="timer-active-indicator">
              <span className="timer-active-dot" />
              <span>{t("timer.active")}</span>
            </div>
          </div>

          {timer.customer && (
            <div className="timer-meta">
              {timer.customer}
            </div>
          )}
          {timer.description && (
            <div className="timer-desc">
              {timer.description}
            </div>
          )}

          {/* Notes: rendered markdown when idle, raw
              textarea when editing. Tapping the rendered
              view (or the empty placeholder) switches to
              edit mode. Blur returns to preview if any
              content is saved; otherwise we keep the
              textarea visible so the user can start
              typing without an extra tap. */}
          {editingNotes || !notes.trim() ? (
            <textarea
              ref={notesAreaRef}
              className="timer-notes-area"
              value={notes}
              onChange={(e) =>
                handleNotesChange(e.target.value)
              }
              onBlur={() => {
                if (notes.trim()) setEditingNotes(false)
              }}
              placeholder={t("timer.notes_placeholder")}
              autoFocus={editingNotes}
            />
          ) : (
            <button
              type="button"
              className="timer-notes-preview"
              onClick={() => {
                setEditingNotes(true)
                setTimeout(
                  () => notesAreaRef.current?.focus(), 0,
                )
              }}
              title={t("timer.notes_edit_hint")}
            >
              <Markdown>{notes}</Markdown>
            </button>
          )}

          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />

          <button
            type="button"
            className="btn-secondary timer-edit-btn"
            onClick={() => setEditing(true)}
            disabled={!timer.id}
          >
            {t("timer.edit")}
          </button>
        </div>
        {editing && timer.id && (
          <EditEntrySheet
            entry={activeTimerToEntry(timer)}
            onClose={() => setEditing(false)}
            onSaved={(updated) => {
              suppressUntilRef.current = Date.now() + 2000
              setTimer({
                ...timer,
                customer: updated.customer,
                description: updated.description,
                contract: updated.contract ?? null,
                task_id: updated.task_id ?? null,
                notes: updated.notes,
              })
              setEditing(false)
            }}
          />
        )}
      </div>
    )
  }

  if (stopped) {
    return (
      <div className="view view--timer-running">
        <div className="timer-active card">
          <div className="timer-header-row">
            <div className="timer-elapsed-line">
              <div className="timer-elapsed">
                {stopped.finalElapsed}
              </div>
              <button
                type="button"
                className="timer-icon-btn timer-icon-btn--resume"
                onClick={handleResume}
                disabled={loading}
                title={t("timer.resume")}
                aria-label={t("timer.resume")}
              >
                <svg
                  width="14" height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <button
                type="button"
                className="timer-icon-btn timer-icon-btn--clear"
                onClick={handleClearStopped}
                title={t("timer.clear")}
                aria-label={t("timer.clear")}
              >
                <svg
                  width="14" height="14"
                  viewBox="0 0 24 24"
                  fill="none" stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line
                    x1="18" y1="6" x2="6" y2="18"
                  />
                  <line
                    x1="6" y1="6" x2="18" y2="18"
                  />
                </svg>
              </button>
            </div>
            <span className="timer-stopped-badge">
              {t("timer.stopped_badge")}
            </span>
          </div>
          {stopped.timer.customer && (
            <div className="timer-meta">
              {stopped.timer.customer}
            </div>
          )}
          {stopped.timer.description && (
            <div className="timer-desc">
              {stopped.timer.description}
            </div>
          )}
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="view">
      <form className="card form" onSubmit={handleStart}>
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
        />
        <CustomerPicker
          value={customer}
          customers={customers}
          onChange={(v) => {
            setCustomer(v)
            setContract("")
          }}
          placeholder={t("timer.customer")}
          synced={customers.length > 0}
        />
        {contracts.length > 0 && (
          <select
            value={contract}
            onChange={(e) =>
              setContract(e.target.value)
            }
          >
            <option value="">
              {t("timer.contract_optional")}
            </option>
            {contracts.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
        >
          <option value="">
            {t("timer.task_optional")}
          </option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {t.customer ? ` (${t.customer})` : ""}
            </option>
          ))}
        </select>
        {projects.length > 0 && (
          <ProjectPicker
            value={projectId}
            projects={projects}
            onChange={setProjectId}
          />
        )}
        <input
          type="text"
          placeholder={t("timer.description_optional")}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        {needsUpgrade ? (
          <UpgradeBanner />
        ) : (
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
          >
            {loading ? "..." : t("timer.start")}
          </button>
        )}
      </form>
    </div>
  )
}
