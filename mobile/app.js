"use strict";

/* Kaisho Cloud — Mobile clock app
 *
 * Self-contained vanilla JS app. All dynamic content
 * is escaped through DOM textContent before rendering.
 */

var API = window.location.origin;
var token = localStorage.getItem("k_token") || "";
var refreshToken = localStorage.getItem("k_refresh") || "";
var userEmail = localStorage.getItem("k_email") || "";
var customers = [];
var tasks = [];
var timerInterval = null;
var activeTimer = null;
var entries = [];
var activeView = "timer";
var authMode = "login";

// ── Helpers ──────────────────────────────────────────

function esc(str) {
  var d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function elapsed(startIso) {
  var ms = Date.now() - new Date(startIso).getTime();
  var totalSec = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var s = totalSec % 60;
  return pad(h) + ":" + pad(m) + ":" + pad(s);
}

function fmtDur(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return h + ":" + pad(m);
}

function $(sel) {
  return document.querySelector(sel);
}

// ── API layer ────────────────────────────────────────

function api(method, path, body) {
  var opts = {
    method: method,
    headers: { "Content-Type": "application/json" },
  };
  if (token) {
    opts.headers["Authorization"] = "Bearer " + token;
  }
  if (body) opts.body = JSON.stringify(body);

  return fetch(API + path, opts).then(function (res) {
    if (res.status === 401 && refreshToken) {
      return doRefresh().then(function (ok) {
        if (ok) return api(method, path, body);
        doLogout();
        return null;
      });
    }
    if (res.status === 204) return {};
    return res.json();
  });
}

function doRefresh() {
  return fetch(API + "/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  })
    .then(function (res) {
      if (!res.ok) return false;
      return res.json().then(function (data) {
        token = data.access_token;
        refreshToken = data.refresh_token;
        localStorage.setItem("k_token", token);
        localStorage.setItem("k_refresh", refreshToken);
        return true;
      });
    })
    .catch(function () {
      return false;
    });
}

function doLogout() {
  token = "";
  refreshToken = "";
  userEmail = "";
  localStorage.removeItem("k_token");
  localStorage.removeItem("k_refresh");
  localStorage.removeItem("k_email");
  render();
}

// Expose for onclick
window.doLogout = doLogout;

// ── Data loading ─────────────────────────────────────

function loadData() {
  return Promise.all([
    loadActive(),
    loadEntries(),
    loadRef(),
  ]).then(function () {
    switchView(activeView);
  });
}

function loadActive() {
  return api("GET", "/clocks/active").then(function (d) {
    activeTimer = d && d.active ? d : null;
  });
}

function loadEntries() {
  return api("GET", "/clocks/entries?period=week").then(
    function (d) {
      entries = Array.isArray(d) ? d : [];
    },
  );
}

function loadRef() {
  return Promise.all([
    api("GET", "/ref/customers"),
    api("GET", "/ref/tasks"),
  ])
    .then(function (results) {
      customers = Array.isArray(results[0])
        ? results[0] : [];
      tasks = Array.isArray(results[1])
        ? results[1] : [];
    })
    .catch(function () {
      customers = [];
      tasks = [];
    });
}

// ── Rendering ────────────────────────────────────────

function render() {
  var app = $("#app");
  if (!token) {
    renderAuth(app);
  } else {
    renderApp(app);
    loadData();
  }
}

// ── Auth ─────────────────────────────────────────────

function renderAuth(container) {
  var isSignup = authMode === "signup";

  container.textContent = "";
  var box = document.createElement("div");
  box.className = "auth-box";

  var title = document.createElement("h2");
  title.textContent = "KAISHO";
  box.appendChild(title);

  var emailLabel = document.createElement("label");
  var emailSpan = document.createElement("span");
  emailSpan.className = "lbl";
  emailSpan.textContent = "Email";
  var emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.id = "a-email";
  emailInput.autocomplete = "email";
  emailLabel.appendChild(emailSpan);
  emailLabel.appendChild(emailInput);
  box.appendChild(emailLabel);

  var passLabel = document.createElement("label");
  var passSpan = document.createElement("span");
  passSpan.className = "lbl";
  passSpan.textContent = "Password";
  var passInput = document.createElement("input");
  passInput.type = "password";
  passInput.id = "a-pass";
  passInput.autocomplete = isSignup
    ? "new-password" : "current-password";
  passLabel.appendChild(passSpan);
  passLabel.appendChild(passInput);
  box.appendChild(passLabel);

  var submitBtn = document.createElement("button");
  submitBtn.className = "btn";
  submitBtn.textContent = isSignup ? "Sign Up" : "Log In";
  box.appendChild(submitBtn);

  var errDiv = document.createElement("div");
  errDiv.className = "err";
  errDiv.id = "a-err";
  box.appendChild(errDiv);

  var linkDiv = document.createElement("div");
  linkDiv.className = "link";
  var toggleLink = document.createElement("a");
  toggleLink.textContent = isSignup
    ? "Log in" : "Sign up";
  linkDiv.appendChild(
    document.createTextNode(
      isSignup ? "Have an account? " : "No account? ",
    ),
  );
  linkDiv.appendChild(toggleLink);
  box.appendChild(linkDiv);

  container.appendChild(box);

  toggleLink.onclick = function () {
    authMode = authMode === "login" ? "signup" : "login";
    render();
  };

  function doSubmit() {
    var email = emailInput.value.trim();
    var pass = passInput.value;
    if (!email || !pass) return;
    submitBtn.disabled = true;
    errDiv.textContent = "";

    var endpoint = authMode === "signup"
      ? "/auth/signup" : "/auth/login";

    api("POST", endpoint, {
      email: email,
      password: pass,
    }).then(function (data) {
      if (!data || data.error) {
        errDiv.textContent = data
          ? data.error : "Connection failed";
        submitBtn.disabled = false;
        return;
      }
      if (data.access_token) {
        token = data.access_token;
        refreshToken = data.refresh_token;
        userEmail = data.email || email;
        localStorage.setItem("k_token", token);
        localStorage.setItem("k_refresh", refreshToken);
        localStorage.setItem("k_email", userEmail);
        render();
      } else if (data.api_key) {
        alert(
          "Account created! Your sync API key " +
          "(save it!):\n\n" + data.api_key,
        );
        authMode = "login";
        render();
      }
    }).catch(function () {
      errDiv.textContent = "Connection failed";
      submitBtn.disabled = false;
    });
  }

  submitBtn.onclick = doSubmit;
  passInput.onkeydown = function (e) {
    if (e.key === "Enter") doSubmit();
  };
}

// ── App shell ────────────────────────────────────────

function renderApp(container) {
  container.textContent = "";

  var header = document.createElement("div");
  header.className = "header";
  var h1 = document.createElement("h1");
  h1.textContent = "KAISHO";
  header.appendChild(h1);
  var userSpan = document.createElement("span");
  userSpan.className = "user";
  userSpan.textContent = userEmail;
  header.appendChild(userSpan);
  var logoutBtn = document.createElement("button");
  logoutBtn.textContent = "Logout";
  logoutBtn.onclick = doLogout;
  header.appendChild(logoutBtn);
  container.appendChild(header);

  var main = document.createElement("div");
  main.className = "main";
  main.id = "main-content";
  container.appendChild(main);
}

// ── View switching ───────────────────────────────────

function switchView(v) {
  activeView = v;
  var main = $("#main-content");
  if (!main) return;
  main.textContent = "";

  // Tab bar
  var tabs = document.createElement("div");
  tabs.className = "tabs";
  ["timer", "book", "entries"].forEach(function (id) {
    var btn = document.createElement("button");
    btn.className = "tab" + (v === id ? " tab--active" : "");
    btn.textContent = id.charAt(0).toUpperCase() + id.slice(1);
    btn.onclick = function () { switchView(id); };
    tabs.appendChild(btn);
  });
  main.appendChild(tabs);

  // Content
  if (v === "timer") renderTimerView(main);
  else if (v === "book") renderBookView(main);
  else renderEntriesView(main);
}

window.switchView = switchView;

// ── Timer view ───────────────────────────────────────

function renderTimerView(container) {
  if (activeTimer) {
    var card = document.createElement("div");
    card.className = "timer-card";

    var custDiv = document.createElement("div");
    custDiv.className = "timer-customer";
    custDiv.textContent =
      activeTimer.customer || "No customer";
    card.appendChild(custDiv);

    var timeDiv = document.createElement("div");
    timeDiv.className = "timer-time";
    timeDiv.id = "timer-display";
    timeDiv.textContent = elapsed(activeTimer.start);
    card.appendChild(timeDiv);

    var descDiv = document.createElement("div");
    descDiv.className = "timer-desc";
    descDiv.textContent = activeTimer.description || "";
    card.appendChild(descDiv);

    var stopBtn = document.createElement("button");
    stopBtn.className = "stop-btn";
    stopBtn.textContent = "Stop";
    stopBtn.onclick = function () {
      stopBtn.disabled = true;
      api("POST", "/clocks/stop").then(function () {
        activeTimer = null;
        clearInterval(timerInterval);
        loadEntries().then(function () {
          switchView("timer");
        });
      });
    };
    card.appendChild(stopBtn);
    container.appendChild(card);

    clearInterval(timerInterval);
    timerInterval = setInterval(function () {
      var el = $("#timer-display");
      if (el && activeTimer) {
        el.textContent = elapsed(activeTimer.start);
      }
    }, 1000);
    return;
  }

  // Start form
  var form = document.createElement("div");
  form.className = "form-card";

  var h3 = document.createElement("h3");
  h3.textContent = "Start Timer";
  form.appendChild(h3);

  // Customer select
  var custField = document.createElement("div");
  custField.className = "field";
  var custSel = document.createElement("select");
  custSel.id = "s-customer";
  var noCust = document.createElement("option");
  noCust.value = "";
  noCust.textContent = "No customer";
  custSel.appendChild(noCust);
  customers.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    custSel.appendChild(opt);
  });
  custField.appendChild(custSel);
  form.appendChild(custField);

  // Description
  var descField = document.createElement("div");
  descField.className = "field";
  var descInput = document.createElement("input");
  descInput.id = "s-desc";
  descInput.placeholder = "Description";
  descInput.autocomplete = "off";
  descField.appendChild(descInput);
  form.appendChild(descField);

  // Task select
  var taskField = document.createElement("div");
  taskField.className = "field";
  var taskSel = document.createElement("select");
  taskSel.id = "s-task";
  var noTask = document.createElement("option");
  noTask.value = "";
  noTask.textContent = "No task";
  taskSel.appendChild(noTask);
  taskField.appendChild(taskSel);
  form.appendChild(taskField);

  // Contract select (hidden by default)
  var contractField = document.createElement("div");
  contractField.className = "field";
  contractField.style.display = "none";
  var contractSel = document.createElement("select");
  contractSel.id = "s-contract";
  var noContract = document.createElement("option");
  noContract.value = "";
  noContract.textContent = "No contract";
  contractSel.appendChild(noContract);
  contractField.appendChild(contractSel);
  form.appendChild(contractField);

  // Customer change handler
  custSel.onchange = function () {
    var cust = custSel.value;
    var filtered = cust
      ? tasks.filter(function (t) {
          return t.customer === cust;
        })
      : tasks;
    taskSel.textContent = "";
    var noT = document.createElement("option");
    noT.value = "";
    noT.textContent = "No task";
    taskSel.appendChild(noT);
    filtered.forEach(function (t) {
      var opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.title;
      taskSel.appendChild(opt);
    });

    var c = customers.find(function (x) {
      return x.name === cust;
    });
    var contracts = c ? c.contracts || [] : [];
    if (contracts.length) {
      contractField.style.display = "";
      contractSel.textContent = "";
      var noCon = document.createElement("option");
      noCon.value = "";
      noCon.textContent = "No contract";
      contractSel.appendChild(noCon);
      contracts.forEach(function (x) {
        var opt = document.createElement("option");
        opt.value = x.name;
        opt.textContent = x.name;
        contractSel.appendChild(opt);
      });
    } else {
      contractField.style.display = "none";
    }
  };

  // Start button
  var startBtn = document.createElement("button");
  startBtn.className = "btn";
  startBtn.textContent = "Start";
  startBtn.onclick = function () {
    startBtn.disabled = true;
    api("POST", "/clocks/start", {
      customer: custSel.value || null,
      description: descInput.value || "",
      task_id: taskSel.value || null,
      contract: contractSel.value || null,
    }).then(function (data) {
      if (data && data.error) {
        alert(data.error);
        startBtn.disabled = false;
        return;
      }
      activeTimer = data;
      switchView("timer");
    });
  };
  form.appendChild(startBtn);
  container.appendChild(form);
}

// ── Book view ────────────────────────────────────────

function renderBookView(container) {
  var form = document.createElement("div");
  form.className = "form-card";

  var h3 = document.createElement("h3");
  h3.textContent = "Book Time";
  form.appendChild(h3);

  var durField = document.createElement("div");
  durField.className = "field";
  var durInput = document.createElement("input");
  durInput.placeholder = "Duration (e.g. 2h, 30m)";
  durInput.autocomplete = "off";
  durField.appendChild(durInput);
  form.appendChild(durField);

  var custField = document.createElement("div");
  custField.className = "field";
  var custSel = document.createElement("select");
  var noCust = document.createElement("option");
  noCust.value = "";
  noCust.textContent = "No customer";
  custSel.appendChild(noCust);
  customers.forEach(function (c) {
    var opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    custSel.appendChild(opt);
  });
  custField.appendChild(custSel);
  form.appendChild(custField);

  var descField = document.createElement("div");
  descField.className = "field";
  var descInput = document.createElement("input");
  descInput.placeholder = "Description";
  descInput.autocomplete = "off";
  descField.appendChild(descInput);
  form.appendChild(descField);

  var dateField = document.createElement("div");
  dateField.className = "field";
  var dateInput = document.createElement("input");
  dateInput.type = "date";
  dateField.appendChild(dateInput);
  form.appendChild(dateField);

  var errDiv = document.createElement("div");
  errDiv.className = "err";

  var bookBtn = document.createElement("button");
  bookBtn.className = "btn";
  bookBtn.textContent = "Book";
  bookBtn.onclick = function () {
    var dur = durInput.value.trim();
    if (!dur) {
      errDiv.textContent = "Duration is required";
      return;
    }
    bookBtn.disabled = true;
    api("POST", "/clocks/quick-book", {
      duration: dur,
      customer: custSel.value || null,
      description: descInput.value || "",
      date: dateInput.value || null,
    }).then(function (data) {
      if (data && data.error) {
        errDiv.textContent = data.error;
        bookBtn.disabled = false;
        return;
      }
      loadEntries().then(function () {
        switchView("entries");
      });
    });
  };
  form.appendChild(bookBtn);
  form.appendChild(errDiv);
  container.appendChild(form);
}

// ── Entries view ─────────────────────────────────────

function renderEntriesView(container) {
  if (!entries.length) {
    var empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No entries this week";
    container.appendChild(empty);
    return;
  }

  var card = document.createElement("div");
  card.className = "form-card";
  card.style.padding = "0";
  card.style.overflow = "hidden";

  entries.forEach(function (e) {
    var row = document.createElement("div");
    row.className = "entry";

    var startDate = new Date(e.start);
    var timeSpan = document.createElement("span");
    timeSpan.className = "entry-time";
    timeSpan.textContent =
      pad(startDate.getHours()) + ":" +
      pad(startDate.getMinutes());
    row.appendChild(timeSpan);

    var infoSpan = document.createElement("span");
    infoSpan.style.flex = "1";
    var custSpan = document.createElement("span");
    custSpan.className = "entry-customer";
    custSpan.textContent =
      e.customer || "unassigned";
    infoSpan.appendChild(custSpan);
    infoSpan.appendChild(document.createElement("br"));
    var descSpan = document.createElement("span");
    descSpan.className = "entry-desc";
    descSpan.textContent = e.description || "";
    infoSpan.appendChild(descSpan);
    row.appendChild(infoSpan);

    var durSpan = document.createElement("span");
    durSpan.className = "entry-dur";
    durSpan.textContent = e.duration_minutes != null
      ? fmtDur(e.duration_minutes) : "...";
    row.appendChild(durSpan);

    var dot = document.createElement("span");
    dot.className = e.synced
      ? "synced-dot" : "unsynced-dot";
    dot.title = e.synced ? "Synced" : "Pending";
    row.appendChild(dot);

    card.appendChild(row);
  });

  container.appendChild(card);
}

// ── Boot ─────────────────────────────────────────────

render();
