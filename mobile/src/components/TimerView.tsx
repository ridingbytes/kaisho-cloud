import {
  useCallback, useEffect, useRef, useState,
} from "react"
import { useTranslation } from "react-i18next"
import type { ActiveTimer, Customer, Task } from "../types"
import {
  getActive,
  getCustomers,
  getTasks,
  startTimer,
  stopTimer,
  ApiError,
} from "../api"
import { onWsEvent } from "../ws"
import { useToast } from "../toast"
import { ErrorBanner } from "./ErrorBanner"
import { CustomerPicker } from "./CustomerPicker"
import { UpgradeBanner } from "./UpgradeBanner"
import { formatElapsed } from "../utils/formatElapsed"

export function TimerView() {
  const { t } = useTranslation()
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
  // Suppress WS refreshes while a local mutation is
  // in-flight or recently completed. Prevents the
  // optimistic UI from flickering when the server's
  // broadcast arrives after our own API response.
  const suppressUntilRef = useRef(0)

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

  // Real-time updates via WebSocket. Refresh active
  // timer when another device starts or stops.
  // Visibility fallback for iOS PWA background resume.
  useEffect(() => {
    const offStart = onWsEvent(
      "timer:started", () => {
        if (Date.now() > suppressUntilRef.current) refreshActive()
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
          contract: detail.contract || null,
        })
        // Fire API call in background
        startTimer({
          customer: detail.customer || undefined,
          description: detail.description || "",
          task_id: detail.task_id || undefined,
          contract: detail.contract || undefined,
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
    setError(null)
    // Optimistic: clear timer immediately
    suppressUntilRef.current = Date.now() + 3000
    const prev = timer
    setTimer(null)
    toast(t("timer.stopped"))
    try {
      await stopTimer()
    } catch (err) {
      // Revert on failure
      setTimer(prev)
      if (err instanceof ApiError) {
        setError(err.message)
      }
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
            {t("timer.stop")}
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
