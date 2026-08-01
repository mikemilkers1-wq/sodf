"use client";

import { useEffect, useMemo, useState } from "react";

const roleLabels = {
  sheriff_admin: "Sheriff Administrator",
  supervisor: "Supervisor",
  deputy: "Deputy",
  dispatcher: "Dispatcher",
  read_only: "Nur Lesen"
};

function nowIso() {
  return new Date().toISOString();
}

function fmt(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function nextId(prefix, records) {
  const year = new Date().getFullYear();
  let max = 0;
  const rx = new RegExp(`^${prefix}-${year}-(\\d+)$`, "i");
  for (const record of records) {
    const match = String(record.id || "").match(rx);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

export default function Portal() {
  const [employee, setEmployee] = useState(null);
  const [state, setState] = useState({
    bolos: [],
    files: [],
    arrests: [],
    complaints: [],
    notices: []
  });
  const [version, setVersion] = useState(null);
  const [tab, setTab] = useState("home");
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState("");
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!employee) return;
    const timer = setInterval(() => refreshState(false), 8000);
    return () => clearInterval(timer);
  }, [employee, version]);

  async function bootstrap() {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setEmployee(payload.employee);
    await refreshState(true);
  }

  async function refreshState(force = false) {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (force || version === null || Number(payload.version) > Number(version)) {
      setState(payload.state);
      setVersion(Number(payload.version));
    }
  }

  async function login(event) {
    event.preventDefault();
    setMessage("Anmeldung wird geprüft …");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeKey: form.get("employeeKey"),
        validationCode: form.get("validationCode")
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error || "Anmeldung fehlgeschlagen.");
      return;
    }
    setEmployee(payload.employee);
    setMessage("");
    await refreshState(true);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setEmployee(null);
    setVersion(null);
    setTab("home");
  }

  async function save(nextState, action, details = {}) {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: nextState,
        version,
        action,
        details
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      setMessage("Ein anderer Mitarbeiter hat den Datenbestand verändert. Die neueste Version wird geladen.");
      await refreshState(true);
      return false;
    }
    if (!response.ok) {
      setMessage(payload.error || "Speichern fehlgeschlagen.");
      return false;
    }
    setState(nextState);
    setVersion(Number(payload.version));
    setMessage("Änderung gespeichert.");
    setTimeout(() => setMessage(""), 2500);
    return true;
  }

  function addRecord(kind, record) {
    const collection = [...state[kind], record];
    const next = { ...state, [kind]: collection };
    save(next, `${kind.toUpperCase()}_CREATED`, { id: record.id });
  }

  function updateRecord(kind, id, changes) {
    const collection = state[kind].map(item => item.id === id ? { ...item, ...changes, updatedAt: nowIso() } : item);
    const next = { ...state, [kind]: collection };
    save(next, `${kind.toUpperCase()}_UPDATED`, { id, changes });
  }

  function removeRecord(kind, id) {
    if (!confirm("Datensatz wirklich löschen?")) return;
    const next = { ...state, [kind]: state[kind].filter(item => item.id !== id) };
    save(next, `${kind.toUpperCase()}_DELETED`, { id });
    setSelected(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const results = [];
    for (const [kind, records] of Object.entries({
      bolos: state.bolos,
      files: state.files,
      arrests: state.arrests,
      complaints: state.complaints
    })) {
      for (const item of records) {
        const text = JSON.stringify(item).toLowerCase();
        if (text.includes(q)) results.push({ kind, item });
      }
    }
    return results;
  }, [search, state]);

  if (!employee) {
    return (
      <main className="login-screen">
        <div className="seal">RCSO</div>
        <h1>RIVERSIDE COUNTY SHERIFF&apos;S OFFICE</h1>
        <p className="subtitle">LAW ENFORCEMENT RECORDS TERMINAL</p>
        <form className="login-panel" onSubmit={login}>
          <div className="panel-header">AUTORISIERTER ZUGANG</div>
          <label>Mitarbeiterkennung<input name="employeeKey" placeholder="z. B. Walker 2041" required /></label>
          <label>Validierungscode<input name="validationCode" type="password" required /></label>
          <button type="submit">Zugang prüfen</button>
          <div className="message">{message}</div>
        </form>
      </main>
    );
  }

  return (
    <main className="terminal">
      <header className="terminal-header">
        <div>
          <strong>RIVERSIDE COUNTY SHERIFF&apos;S OFFICE</strong>
          <small>INTERNAL RECORDS TERMINAL</small>
        </div>
        <div className="user-box">
          {employee.displayName} · {roleLabels[employee.role] || employee.role}
          <button onClick={logout}>Abmelden</button>
        </div>
      </header>

      <nav className="tabs">
        {[
          ["home","⌂","Homepage"],
          ["employees","▦","Mitarbeiterliste"],
          ["bolos","⚑","BOLOs"],
          ["files","▤","Akten"],
          ["arrests","▣","Festnahmen"],
          ["complaints","▧","Strafanzeigen"],
          ["admin","⚙","Admin-Menü"]
        ].map(([id,symbol,label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => { setTab(id); setSelected(null); }}>
            <span>{symbol}</span>{label}
          </button>
        ))}
      </nav>

      <div className="system-strip">
        <span>RCSO-NET</span>
        <span>Datenversion {version ?? "—"}</span>
        <label className="global-search">⌕ <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Terminal durchsuchen" /></label>
        <span className="ready">● SYSTEM READY</span>
      </div>

      {message && <div className="status-message">{message}</div>}

      <section className="workspace">
        {search.trim() && (
          <div className="search-results">
            <div className="panel-header">SUCHERGEBNISSE</div>
            {(filtered || []).map(({ kind, item }) => (
              <button key={`${kind}-${item.id}`} onClick={() => { setTab(kind); setSelected(item.id); setSearch(""); }}>
                <strong>{item.id}</strong><span>{item.subject || item.person || item.title || item.name || "Datensatz"}</span>
              </button>
            ))}
            {filtered && filtered.length === 0 && <p>Keine Treffer.</p>}
          </div>
        )}

        {!search.trim() && tab === "home" && <Home state={state} employee={employee} setTab={setTab} />}
        {!search.trim() && tab === "employees" && <EmployeeDirectory />}
        {!search.trim() && tab === "bolos" && <RecordModule
          title="BOLOs"
          kind="bolos"
          records={state.bolos}
          selected={selected}
          setSelected={setSelected}
          addRecord={addRecord}
          updateRecord={updateRecord}
          removeRecord={removeRecord}
          prefix="RCSO-BOLO"
          fields={[
            ["person","Gesuchte Person / Fahrzeug"],
            ["reason","Grund / Gefahrenhinweis"],
            ["status","Status"],
            ["officer","Ausstellender Beamter"]
          ]}
        />}
        {!search.trim() && tab === "files" && <RecordModule
          title="Akten"
          kind="files"
          records={state.files}
          selected={selected}
          setSelected={setSelected}
          addRecord={addRecord}
          updateRecord={updateRecord}
          removeRecord={removeRecord}
          prefix="RCSO-FILE"
          fields={[
            ["title","Aktenbezeichnung"],
            ["subject","Betroffene Person / Organisation"],
            ["classification","Klassifikation"],
            ["status","Status"]
          ]}
        />}
        {!search.trim() && tab === "arrests" && <RecordModule
          title="Festnahmen"
          kind="arrests"
          records={state.arrests}
          selected={selected}
          setSelected={setSelected}
          addRecord={addRecord}
          updateRecord={updateRecord}
          removeRecord={removeRecord}
          prefix="RCSO-ARR"
          fields={[
            ["person","Festgenommene Person"],
            ["reason","Festnahmegrund"],
            ["location","Ort"],
            ["officer","Festnehmender Beamter"]
          ]}
        />}
        {!search.trim() && tab === "complaints" && <RecordModule
          title="Strafanzeigen"
          kind="complaints"
          records={state.complaints}
          selected={selected}
          setSelected={setSelected}
          addRecord={addRecord}
          updateRecord={updateRecord}
          removeRecord={removeRecord}
          prefix="RCSO-CR"
          fields={[
            ["person","Beschuldigte Person"],
            ["offense","Tatvorwurf"],
            ["complainant","Anzeigenerstatter"],
            ["status","Verfahrensstatus"]
          ]}
        />}
        {!search.trim() && tab === "admin" && <Admin employee={employee} employees={employees} setEmployees={setEmployees} />}
      </section>
    </main>
  );
}

function Home({ state, employee, setTab }) {
  const cards = [
    ["Aktive BOLOs", state.bolos.filter(x => x.status !== "Closed").length, "bolos"],
    ["Offene Akten", state.files.filter(x => x.status !== "Closed").length, "files"],
    ["Festnahmen", state.arrests.length, "arrests"],
    ["Strafanzeigen", state.complaints.length, "complaints"]
  ];
  return (
    <div className="home-grid">
      <section className="welcome-panel">
        <div className="panel-header">RCSO TERMINAL</div>
        <h2>Willkommen, {employee.displayName}</h2>
        <p>Dieses Terminal dient der internen Bearbeitung von Fahndungen, Akten, Festnahmen und Strafanzeigen des Riverside County Sheriff&apos;s Office.</p>
        <p>Jede Änderung wird serverseitig gespeichert und im Prüfprotokoll erfasst.</p>
      </section>
      <div className="stats-grid">
        {cards.map(([label,count,target]) => <button key={label} onClick={() => setTab(target)}><strong>{count}</strong><span>{label}</span></button>)}
      </div>
    </div>
  );
}

function EmployeeDirectory() {
  const [employees, setEmployees] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/employees", { cache: "no-store" })
      .then(async r => {
        const p = await r.json();
        if (!r.ok) throw new Error(p.error);
        setEmployees(p.employees);
      })
      .catch(e => setError(e.message));
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">MITARBEITERLISTE</div>
      {error ? <p>{error}</p> : (
        <table><thead><tr><th>Kennung</th><th>Name</th><th>Rolle</th><th>Status</th><th>Letzte Anmeldung</th></tr></thead>
        <tbody>{employees.map(e => <tr key={e.id}><td>{e.employee_key}</td><td>{e.display_name}</td><td>{roleLabels[e.role]}</td><td>{e.status}</td><td>{fmt(e.last_login_at)}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

function RecordModule({ title, kind, records, selected, setSelected, addRecord, updateRecord, removeRecord, prefix, fields }) {
  const current = records.find(item => item.id === selected);

  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const record = {
      id: nextId(prefix, records),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    for (const [key] of fields) record[key] = form.get(key);
    record.notes = form.get("notes");
    addRecord(kind, record);
    event.currentTarget.reset();
  }

  return (
    <div className="record-layout">
      <section className="panel list-panel">
        <div className="panel-header">{title.toUpperCase()}</div>
        <form className="record-form" onSubmit={submit}>
          {fields.map(([key,label]) => <label key={key}>{label}<input name={key} required /></label>)}
          <label>Notizen<textarea name="notes" rows="3" /></label>
          <button type="submit">＋ Datensatz anlegen</button>
        </form>
        <div className="record-list">
          {records.map(item => (
            <button key={item.id} className={selected === item.id ? "selected" : ""} onClick={() => setSelected(item.id)}>
              <strong>{item.id}</strong>
              <span>{item.person || item.subject || item.title || item.name || item.offense}</span>
            </button>
          ))}
          {records.length === 0 && <p>Keine Datensätze vorhanden.</p>}
        </div>
      </section>

      <section className="panel detail-panel">
        <div className="panel-header">DETAILANSICHT</div>
        {!current ? <p>Datensatz auswählen.</p> : (
          <div className="record-detail">
            <h2>{current.id}</h2>
            {fields.map(([key,label]) => <p key={key}><strong>{label}:</strong> {current[key] || "—"}</p>)}
            <p><strong>Erstellt:</strong> {fmt(current.createdAt)}</p>
            <p><strong>Notizen:</strong><br />{current.notes || "—"}</p>
            <div className="detail-actions">
              <button onClick={() => {
                const changes = {};
                for (const [key,label] of fields) {
                  const value = prompt(label, current[key] || "");
                  if (value === null) return;
                  changes[key] = value;
                }
                updateRecord(kind, current.id, changes);
              }}>Bearbeiten</button>
              <button className="danger" onClick={() => removeRecord(kind, current.id)}>Löschen</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Admin({ employee }) {
  const [employees, setEmployees] = useState([]);
  const [message, setMessage] = useState("");

  async function load() {
    const response = await fetch("/api/admin/employees", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error || "Keine Berechtigung.");
      return;
    }
    setEmployees(payload.employees);
  }

  useEffect(() => {
    if (employee.role === "sheriff_admin") load();
  }, [employee.role]);

  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeKey: form.get("employeeKey"),
        displayName: form.get("displayName"),
        validationCode: form.get("validationCode"),
        role: form.get("role")
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(payload.error || "Fehler");
    event.currentTarget.reset();
    setMessage("Mitarbeiterkonto angelegt.");
    await load();
  }

  if (employee.role !== "sheriff_admin") {
    return <section className="panel"><div className="panel-header">ADMIN-MENÜ</div><p>Keine Administratorberechtigung.</p></section>;
  }

  return (
    <div className="admin-layout">
      <section className="panel">
        <div className="panel-header">MITARBEITER ANLEGEN</div>
        <form className="record-form" onSubmit={create}>
          <label>Mitarbeiterkennung<input name="employeeKey" required /></label>
          <label>Anzeigename<input name="displayName" required /></label>
          <label>Validierungscode<input name="validationCode" type="password" minLength="8" required /></label>
          <label>Rolle<select name="role">
            <option value="deputy">Deputy</option>
            <option value="supervisor">Supervisor</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="read_only">Nur Lesen</option>
            <option value="sheriff_admin">Sheriff Administrator</option>
          </select></label>
          <button type="submit">Mitarbeiterkonto anlegen</button>
        </form>
        <p>{message}</p>
      </section>
      <section className="panel">
        <div className="panel-header">KONTEN</div>
        <table><thead><tr><th>Kennung</th><th>Name</th><th>Rolle</th><th>Status</th></tr></thead>
        <tbody>{employees.map(e => <tr key={e.id}><td>{e.employee_key}</td><td>{e.display_name}</td><td>{roleLabels[e.role]}</td><td>{e.status}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
