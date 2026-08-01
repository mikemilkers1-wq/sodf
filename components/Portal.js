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

  if(!employee)return <main className="login-screen">
    <img className="login-badge" src="/rcso-logo.png" alt="Riverside County Sheriff badge"/>
    <h1>RIVERSIDE COUNTY SHERIFF&apos;S OFFICE</h1><p className="subtitle">LAW ENFORCEMENT RECORDS TERMINAL</p>
    <form className="login-panel" onSubmit={login}>
      <div className="panel-header">AUTORISIERTER ZUGANG</div>
      <label>Mitarbeiterkennung<input name="employeeKey" placeholder="z. B. Walker 2041" required/></label>
      <label>Validierungscode<input name="validationCode" type="password" required/></label>
      <button type="submit">Zugang prüfen</button><div className="message">{message}</div>
    </form>
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


function openIdentityEditor(person, action){
  const legalFirstName=prompt("Vorname:",person.legal_first_name||"");if(legalFirstName===null)return;
  const legalMiddleName=prompt("Zweiter Vorname:",person.legal_middle_name||"");if(legalMiddleName===null)return;
  const legalLastName=prompt("Nachname:",person.legal_last_name||"");if(legalLastName===null)return;
  const dateOfBirth=prompt("Geburtsdatum (YYYY-MM-DD):",person.date_of_birth||"");if(dateOfBirth===null)return;
  const sex=prompt("Geschlecht:",person.sex||"");if(sex===null)return;
  const primaryPhone=prompt("Telefon:",person.primary_phone||"");if(primaryPhone===null)return;
  const primaryEmail=prompt("E-Mail:",person.primary_email||"");if(primaryEmail===null)return;
  const purpose=prompt("Korrekturgrund / Quelle:");if(!purpose)return;
  action({action:"update_person",personId:person.public_id,legalFirstName,legalMiddleName,legalLastName,dateOfBirth,sex,primaryPhone,primaryEmail,generalNotes:person.general_notes||"",purpose});
}
function openAddressEditor(person, action){
  const line1=prompt("Straße und Hausnummer:");if(!line1)return;
  const city=prompt("Stadt:");if(!city)return;
  const stateCode=prompt("Bundesstaat:","CA")||"CA";
  const postalCode=prompt("ZIP Code:")||"";
  const source=prompt("Quelle / Begründung:");if(!source)return;
  action({action:"add_address",personId:person.public_id,line1,city,stateCode,postalCode,addressType:"residential",isCurrent:true,verified:false,source});
}
function openRoleEditor(person, action){
  const roleType=prompt("Rollentyp (law_enforcement, government_employee, elected_official, appointed_official, military, other):","law_enforcement");if(!roleType)return;
  const organization=prompt("Organisation / Department:");if(!organization)return;
  const titleOrRank=prompt("Titel / Rang:")||"";
  const badgeNumber=prompt("Badge Number (optional):")||"";
  const employeeNumber=prompt("Employee Number (optional):")||"";
  const jurisdiction=prompt("Jurisdiction:","Riverside County")||"";
  const source=prompt("Quelle:");if(!source)return;
  action({action:"add_role",personId:person.public_id,roleType,organization,titleOrRank,badgeNumber,employeeNumber,jurisdiction,status:"active",source});
}
function openRelationshipEditor(person, action){
  const relatedPersonId=prompt("Person-ID der verbundenen Person:");if(!relatedPersonId)return;
  const relationshipType=prompt("Beziehung (spouse, parent, child, sibling, household member, business associate …):");if(!relationshipType)return;
  const source=prompt("Quelle:");if(!source)return;
  action({action:"add_relationship",personId:person.public_id,relatedPersonId:relatedPersonId.trim().toUpperCase(),relationshipType,verified:false,confidence:"reported",source});
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


function PersonRegister({employee}){
  const [query,setQuery]=useState(""),[people,setPeople]=useState([]),[person,setPerson]=useState(null),[message,setMessage]=useState("");

  async function search(value=query){
    if(value.trim().length<2)return setPeople([]);
    const r=await fetch(`/api/person-register?q=${encodeURIComponent(value)}&purpose=Law enforcement person inquiry`,{cache:"no-store"});
    const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Suche fehlgeschlagen.");setPeople(p.people||[]);
  }
  async function open(id){
    const r=await fetch(`/api/person-register?id=${encodeURIComponent(id)}&purpose=Law enforcement profile review`,{cache:"no-store"});
    const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Profil konnte nicht geladen werden.");setPerson(p.person);
  }
  async function action(payload){
    const r=await fetch("/api/person-register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Aktion fehlgeschlagen.");setPerson(p.person);setMessage("Personregister aktualisiert.");
  }
  function create(e){
    e.preventDefault();const f=new FormData(e.currentTarget);
    action({action:"create_person",legalFirstName:f.get("first"),legalMiddleName:f.get("middle"),legalLastName:f.get("last"),
      dateOfBirth:f.get("dob"),sex:f.get("sex"),creationReason:f.get("reason"),sourceRecord:f.get("source"),generalNotes:f.get("notes")})
      .then(()=>e.currentTarget.reset());
  }
  function uploadPhoto(e){
    const file=e.target.files?.[0];if(!file)return;if(file.size>2_000_000)return setMessage("Das Foto darf höchstens ungefähr 2 MB groß sein.");
    const reader=new FileReader();reader.onload=()=>action({action:"add_photo",personId:person.public_id,photoType:"mugshot",
      imageDataUrl:reader.result,sourceRecord:"Manual RCSO upload",isPrimary:true});reader.readAsDataURL(file);
  }

  return <div className="person-register-layout">
    <section className="panel person-search-panel"><div className="panel-header">PERSONREGISTER</div>
      <div className="person-search-row"><input value={query} onChange={e=>{setQuery(e.target.value);search(e.target.value)}} placeholder="Name, Alias, Adresse, Person-ID oder Badge-Nr."/><button onClick={()=>search()}>Suchen</button></div>
      <div className="person-result-list">{people.map(p=><button key={p.public_id} onClick={()=>open(p.public_id)}>
        {p.primary_photo?<img src={p.primary_photo} alt=""/>:<span className="person-placeholder">◉</span>}
        <strong>{p.legal_first_name} {p.legal_middle_name||""} {p.legal_last_name}</strong>
        <small>{p.public_id} • DOB {p.date_of_birth||"—"} • {p.status}</small><small>{p.current_address||"Keine aktuelle Adresse"}</small>
      </button>)}</div>
      <details className="create-person-box"><summary>Neue Person erfassen</summary><form onSubmit={create}>
        <label>Vorname<input name="first" required/></label><label>Zweiter Vorname<input name="middle"/></label>
        <label>Nachname<input name="last" required/></label><label>Geburtsdatum<input name="dob" type="date"/></label>
        <label>Geschlecht<select name="sex"><option value="">—</option><option>Male</option><option>Female</option><option>Unknown</option></select></label>
        <label>Erfassungsgrund<input name="reason" required placeholder="Arrest, questioning, citation …"/></label>
        <label>Quellvorgang<input name="source" placeholder="RCSO-ARR-..."/></label><label>Notizen<textarea name="notes"/></label>
        <button type="submit">Person-ID anlegen</button></form></details>
      <div className="message">{message}</div>
    </section>
    <section className="panel person-profile-panel"><div className="panel-header">PERSONENPROFIL</div>
      {!person?<p>Person auswählen.</p>:<div className="person-profile">
        <header>{person.photos?.[0]?<img src={person.photos[0].image_data_url} alt="Person"/>:<div className="profile-photo-placeholder">NO PHOTO</div>}
          <div><h2>{person.legal_first_name} {person.legal_middle_name||""} {person.legal_last_name}</h2>
          <strong>{person.public_id}</strong><p>Status: {person.status}</p></div></header>
        <div className="profile-grid"><section><h3>Core Identity</h3><p>DOB: {person.date_of_birth||"—"}</p><p>Sex: {person.sex||"—"}</p>
          <p>Height: {person.height_cm||"—"} cm</p><p>Weight: {person.weight_kg||"—"} kg</p><p>Eyes: {person.eye_color||"—"}</p><p>Hair: {person.hair_color||"—"}</p>
          <p>SSN: {person.ssn_masked||"—"}</p><p>Driver License: {person.driver_license_masked||"—"}</p></section>
          <section><h3>Addresses</h3>{person.addresses?.map(a=><p key={a.id}>{a.line1}, {a.city}, {a.state_code} {a.postal_code||""} {a.is_current?"(current)":""}</p>)||null}</section>
          <section><h3>Aliases</h3>{person.aliases?.map(a=><p key={a.id}>{a.first_name||""} {a.middle_name||""} {a.last_name}</p>)||null}</section>
          <section><h3>Government / LEO Roles</h3>{person.roles?.map(r=><p key={r.id}>{r.organization} — {r.title_or_rank||r.role_type} {r.badge_number?`Badge ${r.badge_number}`:""}</p>)||null}</section>
        </div>
        <section><h3>Department Links</h3><table><thead><tr><th>Department</th><th>Type</th><th>Record</th><th>Status</th><th>Summary</th><th>Amount</th></tr></thead>
          <tbody>{person.links?.map(l=><tr key={l.id}><td>{l.department}</td><td>{l.record_type}</td><td>{l.record_id}</td><td>{l.record_status||"—"}</td><td>{l.summary||"—"}</td><td>{l.amount==null?"—":`$${Number(l.amount).toFixed(2)}`}</td></tr>)}</tbody></table></section>
        <section><h3>Law-Enforcement / Custody History</h3>{person.events?.map(ev=><article className="person-event" key={ev.id}><strong>{ev.event_category}: {ev.title}</strong><span>{ev.event_status||""} • {ev.occurred_at?fmt(ev.occurred_at):"Unknown date"} • {ev.department}</span><p>{ev.summary||"—"}</p></article>)}</section>
        <section><h3>Relationships</h3>{person.relationships?.map(r=><p key={r.id}>{r.relationship_type}: {r.related_first_name} {r.related_last_name} ({r.related_person_id})</p>)}</section>
        <div className="person-profile-actions">
          <label>Mugshot / Foto hinzufügen<input type="file" accept="image/*" onChange={uploadPhoto}/></label>
          <button onClick={()=>openIdentityEditor(person,action)}>Stammdaten bearbeiten</button>
          <button onClick={()=>openAddressEditor(person,action)}>Adresse hinzufügen</button>
          <button onClick={()=>openRoleEditor(person,action)}>LEO / Behördenrolle hinzufügen</button>
          <button onClick={()=>openRelationshipEditor(person,action)}>Beziehung hinzufügen</button>
          <button onClick={()=>{const last=prompt("Alias-Nachname");if(last)action({action:"add_alias",personId:person.public_id,lastName:last,source:"RCSO profile update"})}}>Alias hinzufügen</button>
          <button onClick={()=>{const title=prompt("Ereignisbezeichnung");if(title)action({action:"add_event",personId:person.public_id,eventCategory:"other",title,summary:prompt("Zusammenfassung")||""})}}>Ereignis hinzufügen</button>
          <button onClick={()=>downloadPersonPdf(person)}>Personenprofil als PDF herunterladen</button>
        </div>
      </div>}
    </section>
  </div>
}
