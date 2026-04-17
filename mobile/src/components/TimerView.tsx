import { useCallback, useEffect, useState } from "react"
import type { ActiveTimer, Customer, Task } from "../types"
import {
  getActive,
  getCustomers,
  getTasks,
  startTimer,
  stopTimer,
  ApiError,
} from "../api"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { CustomerPicker } from "./CustomerPicker"
import { UpgradeBanner } from "./UpgradeBanner"

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return [h, m, s]
    .map((n) => String(n).padStart(2, "0"))
    .join(":")
}

export function TimerView() {
  const { toast } = useToast()
  const [timer, setTimer] = useState<ActiveTimer | null>(
    null,
  )
  const [elapsed, setElapsed] = useState("00:00:00")
  const [customers, setCustomers] = useState<Customer[]>(
    [],
  )
  const [tasks, setTasks] = useState<Task[]>([])
  const [customer, setCustomer] = useState("")
  const [contract, setContract] = useState("")
  const [taskId, setTaskId] = useState("")
  const [desc, setDesc] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)
  const [loading, setLoading] = useState(false)

  const refreshActive = useCallback(async () => {
    try {
      const active = await getActive()
      setTimer(active.active ? active : null)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [active, custs, tsks] = await Promise.all([
        getActive(),
        getCustomers(),
        getTasks(),
      ])
      setTimer(active.active ? active : null)
      setCustomers(custs)
      setTasks(tsks)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Poll /clocks/active every 5s so a timer started or
  // stopped on another device propagates quickly. Also
  // re-fetch when the tab regains focus — iOS PWAs pause
  // timers while backgrounded.
  useEffect(() => {
    const id = setInterval(refreshActive, 5000)
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshActive()
      }
    }
    document.addEventListener(
      "visibilitychange", onVisible,
    )
    return () => {
      clearInterval(id)
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
          autoStart?: boolean
        }>
      ).detail
      setCustomer(detail.customer || "")
      setDesc(detail.description || "")
      setTaskId(detail.task_id || "")
      setContract(detail.contract || "")
      if (detail.autoStart && !timer) {
        // Delay slightly so React commits the state
        // updates before we trigger the start.
        setTimeout(async () => {
          setLoading(true)
          setError(null)
          try {
            const result = await startTimer({
              customer: detail.customer || undefined,
              description: detail.description || "",
              task_id: detail.task_id || undefined,
              contract: detail.contract || undefined,
            })
            setTimer(result)
            toast("Timer started")
          } catch (err) {
            if (err instanceof ApiError) {
              setError(err.message)
            }
          } finally {
            setLoading(false)
          }
        }, 100)
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
    try {
      const result = await startTimer({
        customer: customer || undefined,
        description: desc,
        task_id: taskId || undefined,
        contract: contract || undefined,
      })
      setTimer(result)
      toast("Timer started")
      setDesc("")
      // Re-sync so we pick up any server-side
      // reconciliation (e.g. another device won the
      // start race).
      setTimeout(refreshActive, 500)
    } catch (err) {
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
    setError(null)
    setLoading(true)
    try {
      await stopTimer()
      setTimer(null)
      toast("Timer stopped")
      setTimeout(refreshActive, 500)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (timer) {
    return (
      <div className="view">
        <div className="timer-active card">
          <div className="timer-elapsed">{elapsed}</div>
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
          <ErrorBanner
            message={error}
            onDismiss={() => setError(null)}
          />
          <button
            className="btn-danger"
            onClick={handleStop}
            disabled={loading}
          >
            Stop
          </button>
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
          placeholder="Customer"
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
              Contract (optional)
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
          <option value="">Task (optional)</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {t.customer ? ` (${t.customer})` : ""}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Description (optional)"
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
            {loading ? "..." : "Start timer"}
          </button>
        )}
      </form>
    </div>
  )
}
