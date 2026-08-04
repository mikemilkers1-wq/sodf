"use client";
import { useEffect, useMemo, useState } from "react";

const roleLabels = {
  sheriff_admin: "Sheriff Administrator",
  supervisor: "Supervisor",
  deputy: "Deputy",
  dispatcher: "Dispatcher",
  read_only: "Nur Lesen"
};

const roleDescriptions = {
  sheriff_admin: "Vollständiger operativer Zugriff und Mitarbeiterverwaltung nach zusätzlicher Admin-Freigabe.",
  supervisor: "Darf alle operativen Datensätze anlegen, bearbeiten und löschen.",
  deputy: "Darf BOLOs, Akten, Festnahmen und Strafanzeigen anlegen und bearbeiten.",
  dispatcher: "Darf BOLOs anlegen und aktualisieren; andere Module sind nur lesbar.",
  read_only: "Kann Datensätze ausschließlich ansehen."
};

const permissions = {
  sheriff_admin: new Set(["create","edit","delete","admin"]),
  supervisor: new Set(["create","edit","delete"]),
  deputy: new Set(["create","edit"]),
  dispatcher: new Set(["bolo_create","bolo_edit"]),
  read_only: new Set()
};

function can(employee, action, kind) {
  const p = permissions[employee?.role] || new Set();
  return p.has(action) || (kind === "bolos" && p.has(`bolo_${action}`));
}
function nowIso(){return new Date().toISOString()}
function fmt(v){return v?new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"—"}
function nextId(prefix, records){
  const year=new Date().getFullYear(); let max=0;
  const rx=new RegExp(`^${prefix}-${year}-(\\d+)$`,"i");
  for(const r of records){const m=String(r.id||"").match(rx);if(m)max=Math.max(max,Number(m[1])||0)}
  return `${prefix}-${year}-${String(max+1).padStart(4,"0")}`;
}

async function personApi(payload, method="POST"){
  const response = await fetch(
    method === "GET" ? `/api/person-register?${new URLSearchParams(payload)}` : "/api/person-register",
    method === "GET"
      ? { cache: "no-store" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
  const result = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error || "Personregister-Aktion fehlgeschlagen.");
  return result;
}

async function syncPersonLink(kind, record){
  if(!record?.personId) return;
  return personApi({
    action:"link_record",
    personId:record.personId,
    department:"RCSO",
    recordType:kind==="bolos"?"BOLO":kind.toUpperCase(),
    recordId:record.id,
    recordStatus:record.status||null,
    summary:record.reason||record.title||record.offense||record.subject||null,
    occurredAt:record.createdAt||record.updatedAt||new Date().toISOString(),
    metadata:{ boloType:record.boloType||null, officer:record.officer||null },
    purpose:"RCSO record synchronization"
  });
}

async function unlinkPersonRecord(kind, record){
  if(!record?.personId) return;
  return personApi({
    action:"unlink_record",
    personId:record.personId,
    department:"RCSO",
    recordType:kind==="bolos"?"BOLO":kind.toUpperCase(),
    recordId:record.id,
    purpose:"RCSO record deletion or reassignment"
  });
}


function pdfEscape(value){return String(value??"").replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)")}
function wrapPdf(lines,max=92){const out=[];for(const raw of lines){let line=String(raw??"");if(!line){out.push("");continue}while(line.length>max){let cut=line.lastIndexOf(" ",max);if(cut<20)cut=max;out.push(line.slice(0,cut));line=line.slice(cut).trimStart()}out.push(line)}return out}
function downloadPersonPdf(person){
  const lines=wrapPdf([`PERSON PROFILE — ${person.public_id}`,"Riverside County Shared Person Register","",`Legal name: ${[person.legal_first_name,person.legal_middle_name,person.legal_last_name,person.suffix].filter(Boolean).join(" ")}`,`Status: ${person.status}`,`DOB: ${person.date_of_birth||"—"}`,`Sex: ${person.sex||"—"}`,`SSN: ${person.ssn_masked||"—"}`,`Driver License: ${person.driver_license_masked||"—"}`,"","ADDRESSES",...(person.addresses||[]).map(a=>`- ${a.line1}, ${a.city}, ${a.state_code} ${a.postal_code||""}${a.is_current?" (current)":""}`),"","ROLES",...(person.roles||[]).map(r=>`- ${r.organization} — ${r.title_or_rank||r.role_type}${r.badge_number?` — Badge ${r.badge_number}`:""}`),"","DEPARTMENT LINKS",...(person.links||[]).map(l=>`- ${l.department} / ${l.record_type} / ${l.record_id} / ${l.record_status||"—"} / ${l.summary||"—"}`),"","EVENTS",...(person.events||[]).map(e=>`- ${e.event_category}: ${e.title} / ${e.event_status||"—"} / ${e.department} / ${e.summary||"—"}`),"",`Exported: ${new Date().toISOString()}`]);
  const pages=[];for(let i=0;i<lines.length;i+=48)pages.push(lines.slice(i,i+48));const objects=[null],add=v=>(objects.push(v),objects.length-1),font=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),pageIds=[],contentIds=[];
  for(const page of pages){const cmds=["BT","/F1 10 Tf","42 760 Td","12 TL"];page.forEach((line,i)=>{if(i)cmds.push("T*");cmds.push(`(${pdfEscape(line)}) Tj`)});cmds.push("ET");const stream=cmds.join("\n");contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));pageIds.push(add(""))}
  const pagesId=add("");pageIds.forEach((id,i)=>objects[id]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`);objects[pagesId]=`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] >>`;const catalog=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);let pdf="%PDF-1.4\n",offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=pdf.length;pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`}const xref=pdf.length;pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;const blob=new Blob([pdf],{type:"application/pdf"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${person.public_id}-person-profile.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export default function Portal(){
  const [employee,setEmployee]=useState(null);
  const [state,setState]=useState({bolos:[],files:[],arrests:[],complaints:[],notices:[]});
  const [version,setVersion]=useState(null);
  const [tab,setTab]=useState("home");
  const [selected,setSelected]=useState(null);
  const [message,setMessage]=useState("");
  const [search,setSearch]=useState("");
  const [showLoginPassword,setShowLoginPassword]=useState(false);

  useEffect(()=>{bootstrap()},[]);
  useEffect(()=>{if(!employee)return;const t=setInterval(()=>refreshState(false),8000);return()=>clearInterval(t)},[employee,version]);

  async function bootstrap(){
    const r=await fetch("/api/auth/session",{cache:"no-store"});if(!r.ok)return;
    const p=await r.json();setEmployee(p.employee);await refreshState(true);
  }
  async function refreshState(force=false){
    const r=await fetch("/api/state",{cache:"no-store"});if(!r.ok)return;
    const p=await r.json();if(force||version===null||Number(p.version)>Number(version)){setState(p.state);setVersion(Number(p.version))}
  }
  async function login(e){
    e.preventDefault();setMessage("Anmeldung wird geprüft …");const f=new FormData(e.currentTarget);
    const r=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employeeKey:f.get("employeeKey"),validationCode:f.get("validationCode")})});
    const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Anmeldung fehlgeschlagen.");
    setEmployee(p.employee);setMessage("");await refreshState(true);
  }
  async function logout(){
    await fetch("/api/admin/lock",{method:"POST"});await fetch("/api/auth/logout",{method:"POST"});
    setEmployee(null);setVersion(null);setTab("home");
  }
  async function save(next,action,details={}){
    const r=await fetch("/api/state",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state:next,version,action,details})});
    const p=await r.json().catch(()=>({}));
    if(r.status===409){setMessage("Ein anderer Mitarbeiter hat den Datenbestand verändert. Neueste Version wird geladen.");await refreshState(true);return false}
    if(!r.ok){setMessage(p.error||"Speichern fehlgeschlagen.");return false}
    setState(next);setVersion(Number(p.version));setMessage("Änderung gespeichert.");setTimeout(()=>setMessage(""),2200);return true;
  }
  async function addRecord(kind,record){
    const ok=await save({...state,[kind]:[...state[kind],record]},`${kind.toUpperCase()}_CREATED`,{id:record.id});
    if(ok&&record.personId){try{await syncPersonLink(kind,record)}catch(error){setMessage(`Datensatz gespeichert; Personregister-Synchronisierung fehlgeschlagen: ${error.message}`)}}
  }
  async function updateRecord(kind,id,changes){
    const previous=state[kind].find(x=>x.id===id);
    const updated={...previous,...changes,updatedAt:nowIso()};
    const ok=await save({...state,[kind]:state[kind].map(x=>x.id===id?updated:x)},`${kind.toUpperCase()}_UPDATED`,{id,changes});
    if(!ok)return;
    try{
      if(previous?.personId&&previous.personId!==updated.personId)await unlinkPersonRecord(kind,previous);
      if(updated.personId)await syncPersonLink(kind,updated);
    }catch(error){setMessage(`Datensatz gespeichert; Personregister-Synchronisierung fehlgeschlagen: ${error.message}`)}
  }
  async function removeRecord(kind,id){
    const record=state[kind].find(x=>x.id===id);
    if(!record||!confirm("Datensatz wirklich löschen?"))return;
    const ok=await save({...state,[kind]:state[kind].filter(x=>x.id!==id)},`${kind.toUpperCase()}_DELETED`,{id});
    if(!ok)return;
    try{await unlinkPersonRecord(kind,record)}catch(error){setMessage(`Datensatz gelöscht; alter Personregister-Verweis konnte nicht entfernt werden: ${error.message}`)}
    setSelected(null);
  }
  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();if(!q)return null;const result=[];
    for(const [kind,records] of Object.entries({bolos:state.bolos,files:state.files,arrests:state.arrests,complaints:state.complaints}))
      for(const item of records)if(JSON.stringify(item).toLowerCase().includes(q))result.push({kind,item});
    return result;
  },[search,state]);

  if(!employee)return <main className="login-screen rcso-standard-login">
    <section className="rcso-login-card" aria-label="Riverside County Sheriff's Office employee login">
      <div className="rcso-login-left">
        <div className="rcso-login-brandline">
          <img src="/login/rcso-sheriff-badge.png" alt=""/>
          <div>
            <strong>RIVERSIDE COUNTY</strong>
            <span>SHERIFF&apos;S OFFICE</span>
          </div>
        </div>

        <img className="rcso-login-main-badge" src="/login/rcso-sheriff-badge.png" alt="Riverside County Sheriff badge"/>
        <img className="rcso-login-scene" src="/login/rcso-login-scene.png" alt="Riverside County Special Response Team"/>

        <div className="rcso-login-left-caption">
          <strong>LAW ENFORCEMENT RECORDS TERMINAL</strong>
          <span>Authorized county personnel only</span>
        </div>
      </div>

      <div className="rcso-login-right">
        <div className="rcso-login-right-top">
          <span>INTERNAL ACCESS</span>
          <span className="rcso-login-network-status">● RCSO-NET</span>
        </div>

        <div className="rcso-login-form-wrap">
          <div className="rcso-login-heading">
            <span>RIVERSIDE COUNTY SHERIFF&apos;S OFFICE</span>
            <h1>Employee Terminal</h1>
            <p>Enter your employee key and password to continue.</p>
          </div>

          <form className="login-panel rcso-login-panel" onSubmit={login}>
            <label>
              <span>Mitarbeiterkennung</span>
              <div className="rcso-login-input">
                <span aria-hidden="true">◯</span>
                <input name="employeeKey" placeholder="z. B. Walker 2041" autoComplete="username" required/>
              </div>
            </label>

            <label>
              <span>Passwort</span>
              <div className="rcso-login-input">
                <span aria-hidden="true">▣</span>
                <input
                  name="validationCode"
                  type={showLoginPassword?"text":"password"}
                  autoComplete="current-password"
                  required
                />
                <button
                  className="rcso-password-toggle"
                  type="button"
                  onClick={()=>setShowLoginPassword(value=>!value)}
                  aria-label={showLoginPassword?"Passwort verbergen":"Passwort anzeigen"}
                >{showLoginPassword?"◉":"◎"}</button>
              </div>
            </label>

            <button className="rcso-login-submit" type="submit">ANMELDEN</button>
            <div className="message rcso-login-message" role="alert" aria-live="polite">{message}</div>
          </form>
        </div>

        <div className="rcso-login-right-footer">
          <img src="/login/rcso-srt-seal.png" alt=""/>
          <div>
            <strong>TO PROTECT AND SERVE</strong>
            <span>Riverside County · California</span>
          </div>
        </div>
      </div>
    </section>

    <p className="rcso-login-legal">
      Dieses System ist ausschließlich für autorisierte dienstliche Nutzung bestimmt. Aktivitäten können überwacht,
      protokolliert und behördenintern ausgewertet werden. Unbefugter Zugriff oder die Weitergabe geschützter
      Informationen kann disziplinarische, zivilrechtliche oder strafrechtliche Folgen haben.
    </p>
  </main>;

  const tabs=[["home","⌂","Homepage"],["people","◉","Personregister"],["employees","▦","Mitarbeiterliste"],["bolos","⚑","BOLOs"],["files","▤","Akten"],["arrests","▣","Festnahmen"],["complaints","▧","Strafanzeigen"],["admin","⚙","Admin-Menü"]];

  return <main className="terminal">
    <header className="terminal-header"><div className="brand"><img src="/rcso-logo.png" alt=""/><div><strong>RIVERSIDE COUNTY SHERIFF&apos;S OFFICE</strong><small>INTERNAL RECORDS TERMINAL</small></div></div>
      <div className="user-box"><span>{employee.displayName} · {roleLabels[employee.role]}</span><button onClick={logout}>Abmelden</button></div></header>
    <nav className="tabs">{tabs.map(([id,symbol,label])=><button key={id} className={tab===id?"active":""} onClick={()=>{setTab(id);setSelected(null)}}><span>{symbol}</span>{label}</button>)}</nav>
    <div className="system-strip"><span>RCSO-NET</span><span>Datenversion {version??"—"}</span><label className="global-search">⌕ <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Terminal durchsuchen"/></label><span className="ready">● SYSTEM READY</span></div>
    {message&&<div className="status-message">{message}</div>}
    <section className="workspace">
      {search.trim()?<SearchResults filtered={filtered} setTab={setTab} setSelected={setSelected} setSearch={setSearch}/>:<>
        {tab==="home"&&<Home state={state} employee={employee} setTab={setTab}/>}        {tab==="people"&&<PersonRegister employee={employee}/>}
        {tab==="employees"&&<EmployeeDirectory employee={employee}/>}
        {tab==="bolos"&&<RecordModule employee={employee} title="BOLOs" kind="bolos" records={state.bolos} selected={selected} setSelected={setSelected} addRecord={addRecord} updateRecord={updateRecord} removeRecord={removeRecord} prefix="RCSO-BOLO" fields={[
          ["boloType","BOLO-Typ","select",["Individual","Vehicle","Property / Object","Unknown Subject"]],          ["personId","Verknüpfte Person","person"],
          ["subject","Person, Fahrzeug oder Gegenstand","text"],["reason","Grund / Gefahrenhinweis","text"],
          ["status","Status","select",["Active","Located","Closed","Cancelled"]],["officer","Ausstellender Beamter","text"]
        ]}/>}
        {tab==="files"&&<RecordModule employee={employee} title="Akten" kind="files" records={state.files} selected={selected} setSelected={setSelected} addRecord={addRecord} updateRecord={updateRecord} removeRecord={removeRecord} prefix="RCSO-FILE" fields={[
          ["title","Aktenbezeichnung","text"],["subject","Betroffene Person / Organisation","text"],
          ["classification","Klassifikation","select",["Routine","Restricted","Confidential","Command Staff"]],
          ["status","Status","select",["Open","Under Review","Closed","Archived"]]
        ]}/>}
        {tab==="arrests"&&<RecordModule employee={employee} title="Festnahmen" kind="arrests" records={state.arrests} selected={selected} setSelected={setSelected} addRecord={addRecord} updateRecord={updateRecord} removeRecord={removeRecord} prefix="RCSO-ARR" fields={[
          ["person","Festgenommene Person","text"],["reason","Festnahmegrund","text"],["location","Ort","text"],["officer","Festnehmender Beamter","text"]
        ]}/>}
        {tab==="complaints"&&<RecordModule employee={employee} title="Strafanzeigen" kind="complaints" records={state.complaints} selected={selected} setSelected={setSelected} addRecord={addRecord} updateRecord={updateRecord} removeRecord={removeRecord} prefix="RCSO-CR" fields={[
          ["person","Beschuldigte Person","text"],["offense","Tatvorwurf","text"],["complainant","Anzeigenerstatter","text"],
          ["status","Verfahrensstatus","select",["Filed","Under Investigation","Forwarded","Closed"]]
        ]}/>}
        {tab==="admin"&&<Admin employee={employee}/>}
      </>}
    </section>
  </main>
}

function SearchResults({filtered,setTab,setSelected,setSearch}){
  return <div className="search-results"><div className="panel-header">SUCHERGEBNISSE</div>
    {(filtered||[]).map(({kind,item})=><button key={`${kind}-${item.id}`} onClick={()=>{setTab(kind);setSelected(item.id);setSearch("")}}><strong>{item.id}</strong><span>{item.subject||item.person||item.title||item.offense||"Datensatz"}</span></button>)}
    {filtered?.length===0&&<p>Keine Treffer.</p>}</div>
}

function Home({state,employee,setTab}){
  const recent=[...state.bolos.map(x=>({...x,module:"BOLO",tab:"bolos"})),...state.files.map(x=>({...x,module:"Akte",tab:"files"})),...state.arrests.map(x=>({...x,module:"Festnahme",tab:"arrests"})),...state.complaints.map(x=>({...x,module:"Strafanzeige",tab:"complaints"}))]
    .sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)).slice(0,7);
  return <div className="home-layout">
    <section className="welcome-panel"><div className="panel-header">RCSO TERMINAL</div><div className="welcome-body"><h2>Willkommen, {employee.displayName}</h2>
      <p>Dieses Terminal dient der internen Bearbeitung von Fahndungen, Akten, Festnahmen und Strafanzeigen des Riverside County Sheriff&apos;s Office.</p>
      <div className="role-brief"><strong>{roleLabels[employee.role]}</strong><span>{roleDescriptions[employee.role]}</span></div></div></section>
    <section className="panel recent-panel"><div className="panel-header">ZULETZT BEARBEITETE VORGÄNGE</div><div className="recent-list">
      {recent.map(x=><button key={`${x.module}-${x.id}`} onClick={()=>setTab(x.tab)}><span>{x.module}</span><strong>{x.id}</strong><small>{x.subject||x.person||x.title||x.offense||"Datensatz"}</small></button>)}
      {!recent.length&&<p>Noch keine Vorgänge vorhanden.</p>}</div></section>
    <section className="quick-actions">
      <button onClick={()=>setTab("bolos")}><strong>{state.bolos.filter(x=>x.status==="Active").length}</strong><span>Aktive BOLOs</span></button>
      <button onClick={()=>setTab("files")}><strong>{state.files.filter(x=>!["Closed","Archived"].includes(x.status)).length}</strong><span>Offene Akten</span></button>
      <button onClick={()=>setTab("complaints")}><strong>{state.complaints.filter(x=>x.status!=="Closed").length}</strong><span>Offene Strafanzeigen</span></button>
    </section>
  </div>
}

function EmployeeDirectory({employee}){
  return <section className="panel"><div className="panel-header">MITARBEITERLISTE</div>
    <div className="directory-info"><p>Die Sheriff-Mitarbeiter besitzen unterschiedliche Rollen und Berechtigungen.</p>
      {Object.entries(roleDescriptions).map(([role,text])=><div key={role}><strong>{roleLabels[role]}</strong><span>{text}</span></div>)}
      <p className="small-note">Die vollständige Kontenliste befindet sich aus Sicherheitsgründen im separat entsperrten Admin-Menü.</p></div></section>
}

function Field({name,label,type="text",options=[]}){
  if(type==="select")return <label>{label}<select name={name}>{options.map(x=><option key={x}>{x}</option>)}</select></label>;
  if(type==="person")return <PersonPicker name={name} label={label}/>;
  return <label>{label}<input name={name} required/></label>
}

function PersonPicker({name,label}){
  const [q,setQ]=useState(""),[results,setResults]=useState([]),[selected,setSelected]=useState(null);
  useEffect(()=>{if(q.trim().length<2){setResults([]);return}const t=setTimeout(async()=>{
    const r=await fetch(`/api/person-register?q=${encodeURIComponent(q)}&purpose=Department record linking`,{cache:"no-store"});
    const p=await r.json().catch(()=>({}));setResults(p.people||[]);
  },250);return()=>clearTimeout(t)},[q]);
  return <label className="person-picker">{label}
    <input value={selected?`${selected.public_id} — ${selected.legal_first_name} ${selected.legal_last_name}`:q}
      onChange={e=>{setSelected(null);setQ(e.target.value)}} placeholder="Name, Adresse oder Person-ID suchen"/>
    <input type="hidden" name={name} value={selected?.public_id||""}/>
    {!selected&&results.length>0&&<div className="person-picker-results">{results.map(p=><button type="button" key={p.public_id}
      onClick={()=>{setSelected(p);setQ("")}}><strong>{p.public_id}</strong><span>{p.legal_first_name} {p.legal_last_name}</span><small>{p.current_address||"Keine aktuelle Adresse"}</small></button>)}</div>}
  </label>
}

function RecordModule({employee,title,kind,records,selected,setSelected,addRecord,updateRecord,removeRecord,prefix,fields}){
  const current=records.find(x=>x.id===selected), mayCreate=can(employee,"create",kind), mayEdit=can(employee,"edit",kind), mayDelete=can(employee,"delete",kind);
  async function submit(e){e.preventDefault();const f=new FormData(e.currentTarget);const record={id:nextId(prefix,records),createdAt:nowIso(),updatedAt:nowIso(),createdBy:employee.displayName};for(const [key] of fields)record[key]=f.get(key);record.notes=f.get("notes");await addRecord(kind,record);
    e.currentTarget.reset()}
  return <div className="record-layout">
    <section className="panel list-panel"><div className="panel-header">{title.toUpperCase()}</div>
      {mayCreate?<form className="record-form" onSubmit={submit}>{fields.map(([k,l,t,o])=><Field key={k} name={k} label={l} type={t} options={o}/>)}<label>Notizen<textarea name="notes" rows="3"/></label><button type="submit">＋ Datensatz anlegen</button></form>:<div className="permission-note">Ihre Rolle darf hier keine neuen Datensätze anlegen.</div>}
      <div className="record-list">{records.map(x=><button key={x.id} className={selected===x.id?"selected":""} onClick={()=>setSelected(x.id)}><strong>{x.id}</strong><span>{x.subject||x.person||x.title||x.offense}</span></button>)}{!records.length&&<p>Keine Datensätze vorhanden.</p>}</div></section>
    <section className="panel detail-panel"><div className="panel-header">DETAILANSICHT</div>{!current?<p>Datensatz auswählen.</p>:<div className="record-detail"><h2>{current.id}</h2>
      {fields.map(([k,l])=><p key={k}><strong>{l}:</strong> {current[k]||"—"}</p>)}<p><strong>Erstellt:</strong> {fmt(current.createdAt)}</p><p><strong>Erstellt durch:</strong> {current.createdBy||"—"}</p><p><strong>Notizen:</strong><br/>{current.notes||"—"}</p>
      <div className="detail-actions">{mayEdit&&<button onClick={()=>{const changes={};for(const [k,l] of fields){const v=prompt(l,current[k]||"");if(v===null)return;changes[k]=v}updateRecord(kind,current.id,changes)}}>Bearbeiten</button>}{mayDelete&&<button className="danger" onClick={()=>removeRecord(kind,current.id)}>Löschen</button>}</div></div>}</section>
  </div>
}


function Admin({employee}){
  const [unlocked,setUnlocked]=useState(false),[employees,setEmployees]=useState([]),[message,setMessage]=useState("");
  useEffect(()=>{fetch("/api/admin/status",{cache:"no-store"}).then(r=>r.json()).then(p=>{setUnlocked(!!p.unlocked);if(p.unlocked)load()})},[]);
  async function unlock(e){e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch("/api/admin/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({adminCode:f.get("adminCode")})});const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Admin-Zugang fehlgeschlagen.");setUnlocked(true);setMessage("");await load()}
  async function lock(){await fetch("/api/admin/lock",{method:"POST"});setUnlocked(false);setEmployees([])}
  async function load(){const r=await fetch("/api/admin/employees",{cache:"no-store"});const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Mitarbeiterliste konnte nicht geladen werden.");setEmployees(p.employees)}
  async function create(e){e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch("/api/admin/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({employeeKey:f.get("employeeKey"),displayName:f.get("displayName"),validationCode:f.get("validationCode"),role:f.get("role")})});const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Fehler");e.currentTarget.reset();setMessage("Mitarbeiterkonto angelegt.");await load()}
  if(employee.role!=="sheriff_admin")return <section className="panel admin-denied"><div className="panel-header">ADMIN-MENÜ</div><p>Nur ein Sheriff Administrator kann diesen Bereich öffnen.</p></section>;
  if(!unlocked)return <section className="admin-unlock"><img src="/rcso-logo.png" alt=""/><form onSubmit={unlock}><div className="panel-header">ADMINISTRATIVE AUTORISIERUNG</div><p>Zusätzlich zum persönlichen Konto ist der zentrale Administrationscode erforderlich.</p><label>Administrationscode<input name="adminCode" type="password" required autoFocus/></label><button type="submit">Admin-Menü entsperren</button><div className="message">{message}</div></form></section>;
  return <div className="admin-layout"><section className="panel"><div className="panel-header">MITARBEITER ANLEGEN</div><form className="record-form" onSubmit={create}>
    <label>Mitarbeiterkennung<input name="employeeKey" required/></label><label>Anzeigename<input name="displayName" required/></label><label>Persönlicher Validierungscode<input name="validationCode" type="password" minLength="8" required/></label>
    <label>Rang / Rolle<select name="role"><option value="deputy">Deputy</option><option value="supervisor">Supervisor</option><option value="dispatcher">Dispatcher</option><option value="read_only">Nur Lesen</option><option value="sheriff_admin">Sheriff Administrator</option></select></label>
    <button type="submit">Mitarbeiterkonto anlegen</button></form><p>{message}</p><button className="lock-button" onClick={lock}>Admin-Menü sperren</button></section>
    <section className="panel"><div className="panel-header">MITARBEITERKONTEN</div><table><thead><tr><th>Kennung</th><th>Name</th><th>Rang / Rolle</th><th>Status</th></tr></thead><tbody>{employees.map(e=><tr key={e.id}><td>{e.employee_key}</td><td>{e.display_name}</td><td>{roleLabels[e.role]}</td><td>{e.status}</td></tr>)}</tbody></table></section></div>
}



function PersonModal({config,onClose}){
  if(!config)return null;
  async function submit(e){e.preventDefault();await config.onSubmit(new FormData(e.currentTarget))}
  return <div className="person-modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="person-modal-dialog">
      <header><strong>{config.title}</strong><button type="button" onClick={onClose}>×</button></header>
      <form onSubmit={submit}>
        <div className="person-modal-body">{config.body}</div>
        <div className="person-modal-actions"><button type="button" onClick={onClose}>Abbrechen</button><button type="submit">{config.submitLabel||"Speichern"}</button></div>
      </form>
    </section>
  </div>
}

function TextField({label,name,defaultValue="",type="text",required=false,className=""}){
  return <label className={className}>{label}<input name={name} type={type} defaultValue={defaultValue||""} required={required}/></label>
}
function SelectField({label,name,defaultValue="",options=[]}){
  return <label>{label}<select name={name} defaultValue={defaultValue}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>
}

function PersonRegister({employee}){
  const [query,setQuery]=useState(""),[people,setPeople]=useState([]),[person,setPerson]=useState(null),[message,setMessage]=useState(""),[modal,setModal]=useState(null);

  async function request(payload,method="POST"){
    const response=await fetch(method==="GET"?`/api/person-register?${new URLSearchParams(payload)}`:"/api/person-register",method==="GET"?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Personregister-Aktion fehlgeschlagen.");return result;
  }
  async function search(value=query){if(value.trim().length<2)return setPeople([]);try{const p=await request({q:value,purpose:"RCSO person inquiry"},"GET");setPeople(p.people||[])}catch(e){setMessage(e.message)}}
  async function open(id){try{const p=await request({id,purpose:"RCSO profile review"},"GET");setPerson(p.person)}catch(e){setMessage(e.message)}}
  async function act(payload){try{const p=await request(payload);if(p.person)setPerson(p.person);setModal(null);setMessage("Personregister aktualisiert.")}catch(e){setMessage(e.message);throw e}}

  function coreModal(){
    setModal({title:"Personenstammdaten bearbeiten",body:<div className="person-form-grid">
      <TextField label="Vorname" name="legalFirstName" defaultValue={person.legal_first_name} required/><TextField label="Zweiter Vorname" name="legalMiddleName" defaultValue={person.legal_middle_name}/>
      <TextField label="Nachname" name="legalLastName" defaultValue={person.legal_last_name} required/><TextField label="Geburtsdatum" name="dateOfBirth" type="date" defaultValue={person.date_of_birth}/>
      <TextField label="Geschlecht" name="sex" defaultValue={person.sex}/><TextField label="Telefon" name="primaryPhone" defaultValue={person.primary_phone}/>
      <TextField label="E-Mail" name="primaryEmail" type="email" defaultValue={person.primary_email}/><label className="span-2">Notiz<textarea name="generalNotes" defaultValue={person.general_notes||""}/></label>
      <TextField label="Korrekturgrund / Quelle" name="purpose" required className="span-2"/>
    </div>,onSubmit:f=>act({action:"update_person",personId:person.public_id,...Object.fromEntries(f)})});
  }
  function addressModal(a=null){
    setModal({title:a?"Adresse bearbeiten":"Adresse hinzufügen",body:<div className="person-form-grid">
      <TextField label="Straße / Hausnummer" name="line1" defaultValue={a?.line1} required className="span-2"/><TextField label="Zusatz" name="line2" defaultValue={a?.line2}/>
      <TextField label="Stadt" name="city" defaultValue={a?.city} required/><TextField label="Bundesstaat" name="stateCode" defaultValue={a?.state_code||"CA"} required/>
      <TextField label="ZIP Code" name="postalCode" defaultValue={a?.postal_code}/><SelectField label="Adressart" name="addressType" defaultValue={a?.address_type||"residential"} options={["residential","mailing","business","temporary","property"]}/>
      <label><input name="isCurrent" type="checkbox" defaultChecked={a?a.is_current:true}/> Aktuelle Adresse</label><label><input name="verified" type="checkbox" defaultChecked={!!a?.verified}/> Verifiziert</label>
      <TextField label="Quelle" name="source" defaultValue={a?.source} required/>{a&&<TextField label="Revisionsgrund" name="reason" required/>}
    </div>,onSubmit:f=>act({action:a?"update_address":"add_address",personId:person.public_id,id:a?.id,...Object.fromEntries(f),isCurrent:f.has("isCurrent"),verified:f.has("verified")})});
  }
  function roleModal(r=null){
    setModal({title:r?"LEO-/Behördenrolle bearbeiten":"LEO-/Behördenrolle hinzufügen",body:<div className="person-form-grid">
      <SelectField label="Rollentyp" name="roleType" defaultValue={r?.role_type||"law_enforcement"} options={["law_enforcement","government_employee","elected_official","appointed_official","military","other"]}/>
      <TextField label="Organisation" name="organization" defaultValue={r?.organization} required/><TextField label="Titel / Rang" name="titleOrRank" defaultValue={r?.title_or_rank}/>
      <TextField label="Badge Number" name="badgeNumber" defaultValue={r?.badge_number}/><TextField label="Employee Number" name="employeeNumber" defaultValue={r?.employee_number}/>
      <TextField label="Jurisdiction" name="jurisdiction" defaultValue={r?.jurisdiction}/><TextField label="Beginn" name="startsAt" type="date" defaultValue={r?.starts_at}/>
      <TextField label="Ende" name="endsAt" type="date" defaultValue={r?.ends_at}/><SelectField label="Status" name="status" defaultValue={r?.status||"active"} options={["active","ended","revoked","suspended"]}/>
      <TextField label="Quelle" name="source" defaultValue={r?.source} required/>{r&&<TextField label="Revisionsgrund" name="reason" required className="span-2"/>}
    </div>,onSubmit:f=>act({action:r?"update_role":"add_role",personId:person.public_id,id:r?.id,...Object.fromEntries(f)})});
  }
  function relationModal(r=null){
    setModal({title:r?"Beziehung bearbeiten":"Beziehung hinzufügen",body:<div className="person-form-grid">
      <TextField label="Verbundene Person-ID" name="relatedPersonId" defaultValue={r?.related_person_id} required/><TextField label="Beziehung auf diesem Profil" name="relationshipType" defaultValue={r?.relationship_type} required/>
      <TextField label="Gegenbeziehung" name="inverseRelationshipType"/><SelectField label="Vertrauen" name="confidence" defaultValue={r?.confidence||"reported"} options={["reported","probable","verified"]}/>
      <label><input name="verified" type="checkbox" defaultChecked={!!r?.verified}/> Verifiziert</label><TextField label="Beginn" name="effectiveFrom" type="date" defaultValue={r?.effective_from}/>
      <TextField label="Ende" name="effectiveTo" type="date" defaultValue={r?.effective_to}/><TextField label="Quelle" name="source" defaultValue={r?.source} required/>
      {r&&<TextField label="Revisionsgrund" name="reason" required className="span-2"/>}
    </div>,onSubmit:f=>act({action:r?"update_relationship":"add_relationship",personId:person.public_id,id:r?.id,...Object.fromEntries(f),verified:f.has("verified")})});
  }
  function aliasModal(a=null){
    setModal({title:a?"Alias bearbeiten":"Alias hinzufügen",body:<div className="person-form-grid">
      <TextField label="Vorname" name="firstName" defaultValue={a?.first_name}/><TextField label="Zweiter Vorname" name="middleName" defaultValue={a?.middle_name}/>
      <TextField label="Nachname" name="lastName" defaultValue={a?.last_name} required/><TextField label="Alias-Typ" name="aliasType" defaultValue={a?.alias_type||"alias"}/>
      <label><input name="verified" type="checkbox" defaultChecked={!!a?.verified}/> Verifiziert</label><TextField label="Quelle" name="source" defaultValue={a?.source} required/>
      {a&&<TextField label="Revisionsgrund" name="reason" required className="span-2"/>}
    </div>,onSubmit:f=>act({action:a?"update_alias":"add_alias",personId:person.public_id,id:a?.id,...Object.fromEntries(f),verified:f.has("verified")})});
  }
  function eventModal(ev=null){
    setModal({title:ev?"Ereignis revidieren":"Ereignis hinzufügen",body:<div className="person-form-grid">
      <SelectField label="Kategorie" name="eventCategory" defaultValue={ev?.event_category||"other"} options={["questioning","citation","incident","complaint","arrest","charge","court_disposition","conviction","acquittal","dismissal","jail_booking","jail_release","prison_admission","prison_release","parole","probation","other"]}/>
      <TextField label="Status" name="eventStatus" defaultValue={ev?.event_status}/><TextField label="Titel" name="title" defaultValue={ev?.title} required className="span-2"/>
      <TextField label="Zeitpunkt" name="occurredAt" type="datetime-local" defaultValue={ev?.occurred_at?.slice?.(0,16)}/><TextField label="Ende" name="endedAt" type="datetime-local" defaultValue={ev?.ended_at?.slice?.(0,16)}/>
      <TextField label="Quellvorgang" name="sourceRecord" defaultValue={ev?.source_record}/><TextField label="Disposition" name="disposition" defaultValue={ev?.disposition}/>
      <label className="span-2">Zusammenfassung<textarea name="summary" defaultValue={ev?.summary||""}/></label><label><input name="restricted" type="checkbox" defaultChecked={!!ev?.restricted}/> Eingeschränkt</label>
      {ev&&<TextField label="Revisionsgrund" name="reason" required className="span-2"/>}
    </div>,onSubmit:f=>act({action:ev?"update_event":"add_event",personId:person.public_id,id:ev?.id,...Object.fromEntries(f),restricted:f.has("restricted")})});
  }
  function removeModal(kind,id){
    const action={address:"delete_address",role:"delete_role",relationship:"delete_relationship",alias:"delete_alias",event:"void_event",photo:"delete_photo"}[kind];
    setModal({title:"Eintrag entfernen",submitLabel:"Entfernen",body:<div><p>Die Aktion wird protokolliert. Criminal- und Custody-Ereignisse werden als ungültig markiert.</p><label>Begründung<textarea name="reason" required/></label></div>,onSubmit:f=>act({action,personId:person.public_id,id,reason:f.get("reason")})});
  }
  async function uploadPhoto(e){const file=e.target.files?.[0];if(!file)return;if(file.size>2_000_000)return setMessage("Foto zu groß.");const reader=new FileReader();reader.onload=()=>act({action:"add_photo",personId:person.public_id,photoType:"mugshot",imageDataUrl:reader.result,sourceRecord:"RCSO upload",isPrimary:true});reader.readAsDataURL(file)}


  function createPersonModal(){
    setModal({
      title:"Neue Person erfassen",
      submitLabel:"Person anlegen",
      body:<div className="person-form-grid">
        <TextField label="Vorname" name="legalFirstName" required/>
        <TextField label="Zweiter Vorname" name="legalMiddleName"/>
        <TextField label="Nachname" name="legalLastName" required/>
        <TextField label="Geburtsdatum" name="dateOfBirth" type="date"/>
        <SelectField label="Geschlecht" name="sex" defaultValue="" options={["","Male","Female","Unknown"]}/>
        <TextField label="Telefon" name="primaryPhone"/>
        <TextField label="E-Mail" name="primaryEmail" type="email"/>
        <TextField label="Erfassungsgrund" name="creationReason" required/>
        <TextField label="Quellvorgang" name="sourceRecord"/>
        <label className="span-2">Allgemeine Notiz<textarea name="generalNotes"/></label>
      </div>,
      onSubmit:async f=>{
        const result=await request({action:"create_person",...Object.fromEntries(f)});
        if(result.person){
          setPerson(result.person);
          setModal(null);
          setMessage(`${result.person.public_id} wurde angelegt.`);
        }
      }
    });
  }

  return <div className="person-register-layout">
    <PersonModal config={modal} onClose={()=>setModal(null)}/>
    <section className="panel person-search-panel"><div className="panel-header">PERSONREGISTER</div>
      <div className="person-search-row"><input value={query} onChange={e=>{setQuery(e.target.value);clearTimeout(window.__rcsoPersonTimer);window.__rcsoPersonTimer=setTimeout(()=>search(e.target.value),250)}} placeholder="Name, Adresse oder Person-ID"/><button onClick={()=>search()}>Suchen</button></div>
      <div className="person-result-list">{people.map(p=><button key={p.public_id} onClick={()=>open(p.public_id)}><strong>{p.public_id}</strong><span>{p.legal_first_name} {p.legal_last_name}</span><small>{p.current_address||"Keine aktuelle Adresse"}</small></button>)}</div>
      <button className="person-create-button" onClick={createPersonModal}>Neue Person erfassen</button>
      <div className="message">{message}</div>
    </section>
    <section className="panel person-profile-panel"><div className="panel-header">PERSONENPROFIL</div>
      {!person?<p>Person auswählen.</p>:<div className="person-profile">
        <header>{person.photos?.[0]?<img src={person.photos[0].image_data_url} alt="Person"/>:<div className="profile-photo-placeholder">NO PHOTO</div>}<div><h2>{person.legal_first_name} {person.legal_middle_name||""} {person.legal_last_name}</h2><strong>{person.public_id}</strong><p>Status: {person.status}</p></div></header>
        <div className="profile-grid"><section><h3>Core Identity</h3><p>DOB: {person.date_of_birth||"—"}</p><p>Sex: {person.sex||"—"}</p><p>Phone: {person.primary_phone||"—"}</p><p>Email: {person.primary_email||"—"}</p></section>
          <section><h3>Addresses</h3>{person.addresses?.map(a=><div className="person-data-row" key={a.id}><span>{a.line1}, {a.city}, {a.state_code} {a.postal_code||""} {a.is_current?"(current)":"(previous)"}</span><span><button onClick={()=>addressModal(a)}>Edit</button><button className="danger" onClick={()=>removeModal("address",a.id)}>Remove</button></span></div>)}</section>
          <section><h3>Aliases</h3>{person.aliases?.map(a=><div className="person-data-row" key={a.id}><span>{a.first_name||""} {a.middle_name||""} {a.last_name}</span><span><button onClick={()=>aliasModal(a)}>Edit</button><button className="danger" onClick={()=>removeModal("alias",a.id)}>Remove</button></span></div>)}</section>
          <section><h3>Government / LEO Roles</h3>{person.roles?.map(r=><div className="person-data-row" key={r.id}><span>{r.organization} — {r.title_or_rank||r.role_type} — {r.status||"active"}</span><span><button onClick={()=>roleModal(r)}>Edit</button><button className="danger" onClick={()=>removeModal("role",r.id)}>Remove</button></span></div>)}</section>
        </div>
        <section><h3>Relationships</h3>{person.relationships?.map(r=><div className="person-data-row" key={r.id}><span>{r.relationship_type}: {r.related_first_name} {r.related_last_name} ({r.related_person_id})</span><span><button onClick={()=>relationModal(r)}>Edit</button><button className="danger" onClick={()=>removeModal("relationship",r.id)}>Remove</button></span></div>)}</section>
        <section><h3>Law-Enforcement / Custody History</h3>{person.events?.map(ev=><div className="person-data-row person-event" key={ev.id}><div><strong>{ev.event_category}: {ev.title}</strong><span>{ev.event_status||""} • {ev.department}</span><p>{ev.summary||"—"}</p></div><span><button onClick={()=>eventModal(ev)}>Revise</button><button className="danger" onClick={()=>removeModal("event",ev.id)}>Void</button></span></div>)}</section>
        <section><h3>Photos</h3><div className="person-photo-grid">{person.photos?.map(ph=><figure key={ph.id}><img src={ph.image_data_url}/><figcaption>{ph.photo_type}</figcaption><button className="danger" onClick={()=>removeModal("photo",ph.id)}>Remove</button></figure>)}</div></section>
        <div className="person-profile-actions"><button onClick={coreModal}>Stammdaten bearbeiten</button><button onClick={()=>addressModal()}>Adresse hinzufügen</button><button onClick={()=>roleModal()}>LEO / Behördenrolle hinzufügen</button><button onClick={()=>relationModal()}>Beziehung hinzufügen</button><button onClick={()=>aliasModal()}>Alias hinzufügen</button><button onClick={()=>eventModal()}>Ereignis hinzufügen</button><label>Foto / Mugshot<input type="file" accept="image/*" onChange={uploadPhoto}/></label><button onClick={()=>downloadPersonPdf(person)}>Personenprofil als PDF herunterladen</button></div>
      </div>}
    </section>
  </div>
}
