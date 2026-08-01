"use strict"

// Minimal admin console. Talks to /admin/* with the operator's
// ADMIN_API_KEY as a bearer token, held in sessionStorage only.

const KEY = "kaisho_admin_key"
const $ = (id) => document.getElementById(id)

function getKey() { return sessionStorage.getItem(KEY) || "" }
function setKey(v) { sessionStorage.setItem(KEY, v) }
function clearKey() { sessionStorage.removeItem(KEY) }

function showMsg(text, kind) {
  const el = $("msg")
  el.textContent = text
  el.className = "msg " + (kind || "info")
  if (kind !== "err") setTimeout(() => { el.className = "msg" }, 4000)
}

async function api(path, method = "GET", body) {
  const res = await fetch("/admin" + path, {
    method,
    headers: {
      "Authorization": "Bearer " + getKey(),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { /* noop */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) ||
      `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data
}

function fmtDate(s) {
  if (!s) return "—"
  const d = new Date(s)
  return d.toLocaleString()
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;",
  }[c]))
}

function showToken(token) {
  $("tokenVal").value = token
  $("tokenDlg").showModal()
}

function rowHtml(a) {
  const status = a.disabled_at
    ? '<span class="pill off">disabled</span>'
    : '<span class="pill ok">active</span>'
  const toggle = a.disabled_at
    ? `<button data-act="enable" data-id="${a.id}">Enable</button>`
    : `<button data-act="disable" data-id="${a.id}">Disable</button>`
  return `<tr>
    <td>${esc(a.email) || '<span class="muted">no email</span>'}</td>
    <td>${status}</td>
    <td>${a.clock_entries ?? 0}</td>
    <td>${a.tasks ?? 0}</td>
    <td>${a.notes ?? 0}</td>
    <td class="muted">${fmtDate(a.last_change_at)}</td>
    <td><div class="acts">
      <button data-act="password" data-id="${a.id}"
              data-email="${esc(a.email)}">Password</button>
      <button data-act="rotate" data-id="${a.id}">Token</button>
      ${toggle}
      <button class="danger" data-act="delete" data-id="${a.id}"
              data-email="${esc(a.email)}">Delete</button>
    </div></td>
  </tr>`
}

async function load() {
  try {
    const { accounts } = await api("/accounts")
    $("rows").innerHTML = accounts.map(rowHtml).join("")
    $("whoami").textContent = `${accounts.length} account(s)`
  } catch (err) {
    if (String(err.message).match(/401|Unauthorized/)) {
      clearKey(); showLogin()
      showMsg("Invalid admin key.", "err")
    } else {
      showMsg(err.message, "err")
    }
  }
}

async function onAction(act, id, email) {
  try {
    if (act === "disable") {
      await api(`/accounts/${id}/disable`, "POST")
      showMsg("Account disabled.")
    } else if (act === "enable") {
      await api(`/accounts/${id}/enable`, "POST")
      showMsg("Account enabled.")
    } else if (act === "rotate") {
      const r = await api(`/accounts/${id}/rotate-token`, "POST")
      showToken(r.sync_token)
    } else if (act === "password") {
      const pw = prompt(`New password for ${email || id} (min 8):`)
      if (!pw) return
      await api(`/accounts/${id}/password`, "POST", { password: pw })
      showMsg("Password changed.")
    } else if (act === "delete") {
      if (!confirm(`Delete ${email || id} and ALL its data? This ` +
        "cannot be undone.")) return
      await api(`/accounts/${id}`, "DELETE")
      showMsg("Account deleted.")
    }
    await load()
  } catch (err) {
    showMsg(err.message, "err")
  }
}

async function onAdd() {
  const email = $("newEmail").value.trim()
  const password = $("newPw").value
  if (!email || password.length < 8) {
    showMsg("Email and a password of at least 8 characters " +
      "are required.", "err")
    return
  }
  try {
    const r = await api("/accounts", "POST", { email, password })
    $("newEmail").value = ""; $("newPw").value = ""
    showToken(r.sync_token)
    await load()
  } catch (err) {
    showMsg(err.message, "err")
  }
}

function showApp() {
  $("login").classList.add("hidden")
  $("app").classList.remove("hidden")
  load()
}

function showLogin() {
  $("app").classList.add("hidden")
  $("login").classList.remove("hidden")
  $("whoami").textContent = ""
}

function init() {
  $("connect").onclick = () => {
    const v = $("key").value.trim()
    if (!v) return
    setKey(v); $("key").value = ""; showApp()
  }
  $("key").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("connect").click()
  })
  $("add").onclick = onAdd
  $("refresh").onclick = load
  $("tokenClose").onclick = () => $("tokenDlg").close()
  $("rows").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]")
    if (!b) return
    onAction(b.dataset.act, b.dataset.id, b.dataset.email)
  })
  if (getKey()) showApp(); else showLogin()
}

init()
