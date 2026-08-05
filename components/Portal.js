"use client";
import { useEffect, useMemo, useState } from "react";
import CountyGovernance from "./CountyGovernance";

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

const departments = ["Office of the County Sheriff","Administrative Services Bureau","Field Operations Bureau","Investigations Bureau","Special Operations Bureau"];
const departmentLabel = employee => `${employee?.department||"Keine Abteilung"}${employee?.departmentHead?" · Department Head":""}`;

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


function pdfAscii(value){
  return String(value??"")
    .replace(/Ä/g,"Ae").replace(/Ö/g,"Oe").replace(/Ü/g,"Ue")
    .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue")
    .replace(/ß/g,"ss").replace(/[–—]/g,"-")
    .replace(/[^\x20-\x7E]/g,"?");
}
function pdfEscape(value){
  return pdfAscii(value).replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
}
function pdfWrap(text,max=88){
  const output=[];
  for(const paragraph of String(text??"").split(/\n/)){
    let remaining=pdfAscii(paragraph).trim();
    if(!remaining){output.push("");continue}
    while(remaining.length>max){
      let cut=remaining.lastIndexOf(" ",max);
      if(cut<24)cut=max;
      output.push(remaining.slice(0,cut));
      remaining=remaining.slice(cut).trimStart();
    }
    output.push(remaining);
  }
  return output;
}
function downloadOfficialPdf({documentType,title,identifier,status="—",sections=[],fileName}){
  const W=612,H=792,margin=44,top=748,bottom=54;
  const objects=[null];
  const add=value=>(objects.push(value),objects.length-1);
  const regular=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const bold=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pages=[],streams=[];
  let commands=[],y=top,pageNumber=1;

  const push=(value)=>commands.push(value);
  const text=(x,yy,size,value,font="F1")=>{
    push(`BT /${font} ${size} Tf ${x} ${yy} Td (${pdfEscape(value)}) Tj ET`);
  };
  const line=(x1,y1,x2,y2,width=.7)=>{
    push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const rect=(x,yy,w,h,fillGray=null,strokeGray=0.25)=>{
    if(fillGray!==null)push(`${fillGray} g ${x} ${yy} ${w} ${h} re f`);
    push(`${strokeGray} G ${x} ${yy} ${w} ${h} re S`);
    push("0 g 0 G");
  };
  const header=()=>{
    rect(0,H-34,W,34,0.16,0.16);
    text(margin,H-22,10,"RIVERSIDE COUNTY SHERIFF'S OFFICE","F2");
    text(W-margin-126,H-22,8,"OFFICIAL RECORD","F2");
    text(margin,H-54,17,documentType,"F2");
    text(margin,H-72,11,title,"F1");
    text(W-margin-165,H-55,9,identifier,"F2");
    text(W-margin-165,H-70,8,`Status: ${status}`,"F1");
    line(margin,H-82,W-margin,H-82,1.2);
    y=H-104;
  };
  const footer=()=>{
    line(margin,38,W-margin,38,.5);
    text(margin,24,7,"LAW ENFORCEMENT SENSITIVE - AUTHORIZED PERSONNEL ONLY","F2");
    text(W-margin-62,24,7,`Page ${pageNumber}`,"F1");
  };
  const closePage=()=>{
    footer();
    const stream=commands.join("\n");
    streams.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    pages.push(add(""));
    commands=[];
    pageNumber+=1;
    header();
  };
  const ensure=(needed)=>{
    if(y-needed<bottom)closePage();
  };

  header();

  for(const section of sections){
    ensure(52);
    rect(margin,y-19,W-margin*2,22,0.90,0.45);
    text(margin+8,y-12,10,section.heading.toUpperCase(),"F2");
    y-=31;

    for(const item of section.items||[]){
      const label=pdfAscii(item.label||"");
      const wrapped=pdfWrap(item.value??"—",76);
      const required=Math.max(25,wrapped.length*12+9);
      ensure(required);
      text(margin+4,y,8,label.toUpperCase(),"F2");
      let valueY=y-12;
      for(const row of wrapped){
        text(margin+16,valueY,9,row||" ","F1");
        valueY-=12;
      }
      y=valueY-5;
      line(margin,y+4,W-margin,y+4,.25);
    }
    y-=8;
  }

  footer();
  const finalStream=commands.join("\n");
  streams.push(add(`<< /Length ${finalStream.length} >>\nstream\n${finalStream}\nendstream`));
  pages.push(add(""));

  const pagesId=add("");
  pages.forEach((id,index)=>{
    objects[id]=`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${streams[index]} 0 R >>`;
  });
  objects[pagesId]=`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(id=>`${id} 0 R`).join(" ")}] >>`;
  const catalog=add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf="%PDF-1.4\n",offsets=[0];
  for(let i=1;i<objects.length;i++){
    offsets[i]=pdf.length;
    pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref=pdf.length;
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob=new Blob([pdf],{type:"application/pdf"});
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=fileName||`${identifier||"RCSO-record"}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadPersonPdf(person){
  const legalName=[person.legal_first_name,person.legal_middle_name,person.legal_last_name,person.suffix].filter(Boolean).join(" ");
  downloadOfficialPdf({
    documentType:"PERSONENPROFIL",
    title:legalName||"Unbekannte Person",
    identifier:person.public_id,
    status:person.status,
    fileName:`${person.public_id}-Personenprofil.pdf`,
    sections:[
      {heading:"Identitaet",items:[
        {label:"Rechtlicher Name",value:legalName},
        {label:"Geburtsdatum",value:person.date_of_birth||"—"},
        {label:"Geschlecht",value:person.sex||"—"},
        {label:"SSN",value:person.ssn_masked||"—"},
        {label:"Fuehrerschein",value:person.driver_license_masked||"—"}
      ]},
      {heading:"Adressen",items:(person.addresses||[]).map((a,index)=>({
        label:`Adresse ${index+1}${a.is_current?" - aktuell":""}`,
        value:[a.line1,a.line2,a.city,a.state_code,a.postal_code].filter(Boolean).join(", ")
      }))},
      {heading:"Behoerdenrollen",items:(person.roles||[]).map((r,index)=>({
        label:`Rolle ${index+1}`,
        value:[r.organization,r.title_or_rank||r.role_type,r.badge_number?`Badge ${r.badge_number}`:""].filter(Boolean).join(" - ")
      }))},
      {heading:"Verknuepfte Behoerdendatensaetze",items:(person.links||[]).map((l,index)=>({
        label:`Datensatz ${index+1}`,
        value:[l.department,l.record_type,l.record_id,l.record_status,l.summary].filter(Boolean).join(" - ")
      }))},
      {heading:"Ereignisse",items:(person.events||[]).map((e,index)=>({
        label:`Ereignis ${index+1}`,
        value:[e.event_category,e.title,e.event_status,e.department,e.summary].filter(Boolean).join(" - ")
      }))},
      {heading:"Export",items:[{label:"Erstellt am",value:new Date().toLocaleString("de-DE")}]}
    ]
  });
}
function downloadRecordPdf(kind,record,fields){
  const labels={
    bolos:"BE-ON-THE-LOOKOUT NOTICE",
    files:"AKTENBERICHT",
    arrests:"FESTNAHMEPROTOKOLL",
    complaints:"STRAFANZEIGE"
  };
  const titles={
    bolos:record.subject||"BOLO",
    files:record.title||record.subject||"Akte",
    arrests:record.person||"Festnahme",
    complaints:record.person||record.offense||"Strafanzeige"
  };
  const coreItems=(fields||[]).map(([key,label])=>({
    label,
    value:record[key]||"—"
  }));
  downloadOfficialPdf({
    documentType:labels[kind]||"BEHOERDENDATENSATZ",
    title:titles[kind],
    identifier:record.id,
    status:record.status||"Recorded",
    fileName:`${record.id}.pdf`,
    sections:[
      {heading:"Vorgangsdaten",items:coreItems},
      {heading:"Dokumentation",items:[
        {label:"Notizen",value:record.notes||"—"},
        {label:"Erstellt durch",value:record.createdBy||"—"},
        {label:"Erstellt am",value:record.createdAt?fmt(record.createdAt):"—"},
        {label:"Zuletzt aktualisiert",value:record.updatedAt?fmt(record.updatedAt):"—"}
      ]},
      {heading:"Rechtlicher Hinweis",items:[
        {label:"Verwendung",value:"Dieser Export ist ein interner Riverside-County-Behoerdendatensatz. Weitergabe und Verwendung sind auf den dienstlichen Zweck beschraenkt."}
      ]}
    ]
  });
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
  async function toggleDuty(){
    const dutyStatus=employee.dutyStatus==="on_duty"?"off_duty":"on_duty";
    const r=await fetch("/api/auth/duty",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({dutyStatus})});
    const p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Dienststatus konnte nicht geändert werden.");setEmployee(p.employee);
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
          <button className="rcso-login-top-arrow" type="button" aria-label="Interner Zugang">→</button>
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
                <span className="rcso-field-icon rcso-field-icon-user" aria-hidden="true">ID</span>
                <input name="employeeKey" placeholder="z. B. Walker 2041" autoComplete="username" required/>
              </div>
            </label>

            <label>
              <span>Passwort</span>
              <div className="rcso-login-input">
                <span className="rcso-field-icon rcso-field-icon-lock" aria-hidden="true">PW</span>
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
                >{showLoginPassword?"HIDE":"SHOW"}</button>
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

  const tabs=[["home","⌂","Homepage"],["people","◉","Personregister"],["employees","▦","Mitarbeiterliste"],["governance","🏛","County Governance"],["bolos","⚑","BOLOs"],["files","▤","Akten"],["arrests","▣","Festnahmen"],["complaints","▧","Strafanzeigen"],["admin","⚙","Admin-Menü"]];

  return <main className="terminal modern-rcso-terminal">
    <div className="les-banner"><strong>LAW ENFORCEMENT SENSITIVE</strong><span>RIVERSIDE COUNTY INTERNAL NETWORK</span></div>
    <header className="terminal-header"><div className="brand"><img src="/rcso-logo.png" alt=""/><div><strong>Riverside County Sheriff&apos;s Office</strong><small>Law Enforcement Records Terminal</small></div></div>
      <div className="rcso-compact-user">
        <span>{roleLabels[employee.role]}</span>
        <strong>{employee.displayName}</strong>
        <button onClick={logout}>Log off</button>
      </div></header>
    <nav className="tabs">{tabs.map(([id,symbol,label])=><button key={id} className={tab===id?"active":""} onClick={()=>{setTab(id);setSelected(null)}}><span>{symbol}</span>{label}</button>)}</nav>
    <div className="system-strip"><span><strong>RCSO-NET</strong></span><span>Datenversion {version??"—"}</span><label className="global-search">Suche <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Person, Vorgang oder Aktenzeichen"/></label><span className="ready">● Verbindung verfügbar</span></div>
    {message&&<div className="status-message">{message}</div>}
    <section className="workspace">
      {search.trim()?<SearchResults filtered={filtered} setTab={setTab} setSelected={setSelected} setSearch={setSearch}/>:<>
        {tab==="home"&&<Home state={state} employee={employee} setTab={setTab} toggleDuty={toggleDuty}/>}        {tab==="people"&&<PersonRegister employee={employee}/>}
        {tab==="employees"&&<EmployeeDirectory employee={employee}/>}
        {tab==="governance"&&<CountyGovernance/>}
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
    <div className="les-banner les-banner-bottom"><strong>LAW ENFORCEMENT SENSITIVE</strong><span>AUTHORIZED PERSONNEL ONLY</span></div>
  </main>
}

function SearchResults({filtered,setTab,setSelected,setSearch}){
  return <div className="search-results"><div className="panel-header">SUCHERGEBNISSE</div>
    {(filtered||[]).map(({kind,item})=><button key={`${kind}-${item.id}`} onClick={()=>{setTab(kind);setSelected(item.id);setSearch("")}}><strong>{item.id}</strong><span>{item.subject||item.person||item.title||item.offense||"Datensatz"}</span></button>)}
    {filtered?.length===0&&<p>Keine Treffer.</p>}</div>
}

function Home({state,employee,setTab,toggleDuty}){
  const recent=[...state.bolos.map(x=>({...x,module:"BOLO",tab:"bolos"})),...state.files.map(x=>({...x,module:"Akte",tab:"files"})),...state.arrests.map(x=>({...x,module:"Festnahme",tab:"arrests"})),...state.complaints.map(x=>({...x,module:"Strafanzeige",tab:"complaints"}))]
    .sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)).slice(0,6);

  return <div className="home-layout modern-home-layout">
    <section className="welcome-panel modern-welcome">
      <div className="panel-header">MITARBEITERÜBERSICHT</div>
      <div className="welcome-body">
        <p className="welcome-kicker">RIVERSIDE COUNTY SHERIFF&apos;S OFFICE</p>
        <h2>Willkommen, {employee.displayName}.</h2>
        <p>Dieses Terminal dient der dienstlichen Bearbeitung von Fahndungen, Akten, Festnahmen, Strafanzeigen und behördenübergreifenden Personenverknüpfungen.</p>
        <div className="officer-summary">
          <div><span>Dienststatus</span><strong className={employee.dutyStatus==="on_duty"?"duty-on":"duty-off"}>{employee.dutyStatus==="on_duty"?"On Duty":"Off Duty"}</strong><button onClick={toggleDuty}>Status wechseln</button></div>
          <div><span>Abteilung</span><strong>{employee.department||"Keine Abteilung"}</strong><small>{employee.departmentHead?"Abteilungsleitung":"Reguläres Abteilungsmitglied"}</small></div>
          <div><span>Rolle</span><strong>{roleLabels[employee.role]}</strong><small>{roleDescriptions[employee.role]}</small></div>
        </div>
      </div>
    </section>

    <section className="panel operational-guidance">
      <div className="panel-header">HINWEISE FÜR DIESE SITZUNG</div>
      <div className="guidance-list">
        <div><strong>Dokumentation</strong><span>Wesentliche Feststellungen und Änderungen sind sachlich und nachvollziehbar zu erfassen.</span></div>
        <div><strong>Personregister</strong><span>Verknüpfungen dürfen nur nach eindeutiger Identifizierung der betroffenen Person vorgenommen werden.</span></div>
        <div><strong>Datenschutz</strong><span>Informationen dürfen ausschließlich im Rahmen des dienstlichen Auftrags verwendet werden.</span></div>
        <div><strong>Freigaben</strong><span>Administrativer Zugriff und Mitarbeiterverwaltung bleiben autorisierten Führungsrollen vorbehalten.</span></div>
      </div>
    </section>

    <section className="panel recent-panel">
      <div className="panel-header">ZULETZT BEARBEITETE VORGÄNGE</div>
      <div className="recent-list">
        {recent.map(x=><button key={`${x.module}-${x.id}`} onClick={()=>setTab(x.tab)}><span>{x.module}</span><strong>{x.id}</strong><small>{x.subject||x.person||x.title||x.offense||"Datensatz"}</small></button>)}
        {!recent.length&&<p>Noch keine Vorgänge vorhanden.</p>}
      </div>
    </section>

    <section className="quick-actions modern-quick-actions">
      <button onClick={()=>setTab("bolos")}><strong>BOLOs öffnen</strong><span>Fahndungen und Gefahrenhinweise bearbeiten</span></button>
      <button onClick={()=>setTab("files")}><strong>Akten öffnen</strong><span>Ermittlungs- und Verwaltungsvorgänge einsehen</span></button>
      <button onClick={()=>setTab("people")}><strong>Personregister</strong><span>Personen suchen und verknüpfte Datensätze prüfen</span></button>
    </section>
  </div>
}

function EmployeeDirectory(){
  const [employees,setEmployees]=useState([]);
  const [selectedId,setSelectedId]=useState(null);
  const [error,setError]=useState("");

  useEffect(()=>{
    fetch("/api/employees",{cache:"no-store"})
      .then(async response=>{
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload.error||"Mitarbeiterliste konnte nicht geladen werden.");
        setEmployees(payload.employees||[]);
        setSelectedId(current=>current||(payload.employees?.[0]?.id??null));
      })
      .catch(reason=>setError(reason.message));
  },[]);

  const selected=employees.find(item=>String(item.id)===String(selectedId));
  const hired=selected?.created_at
    ? new Date(selected.created_at).toLocaleDateString("de-DE",{year:"numeric",month:"long",day:"numeric"})
    : "—";
  const biography=selected?.biography_text||
    `${selected?.display_name||"Der Mitarbeiter"} trat am ${hired} in den Dienst des Riverside County Sheriff's Office ein. Dieses interne Mitarbeiterprofil enthält Angaben zur derzeitigen Funktion, Abteilung und dienstlichen Einordnung. Ein ausführlicher dienstlicher Werdegang kann durch die autorisierte Behördenleitung ergänzt werden.`;

  return <div className="employee-directory-layout">
    <section className="panel employee-directory-list-panel">
      <div className="panel-header">MITARBEITERLISTE</div>
      <div className="employee-directory-list">
        {employees.map(item=><button key={item.id} className={String(item.id)===String(selectedId)?"selected":""} onClick={()=>setSelectedId(item.id)}>
          <img src={item.profile_photo_data_url||"/login/default-profile.png"} alt=""/>
          <span><strong>{item.display_name}</strong><small>{roleLabels[item.role]}</small><small>{item.department}</small></span>
        </button>)}
        {!employees.length&&!error&&<p>Mitarbeiter werden geladen …</p>}
        {error&&<p>{error}</p>}
      </div>
    </section>

    <section className="panel employee-directory-profile-panel">
      <div className="panel-header">MITARBEITERPROFIL</div>
      {!selected?<div className="empty-detail">Mitarbeiter auswählen.</div>:<article className="employee-public-profile">
        <header><h2>{roleLabels[selected.role]} {selected.display_name}</h2></header>
        <div className="employee-profile-hero">
          <img src={selected.profile_photo_data_url||"/login/default-profile.png"} alt="Mitarbeiterprofil"/>
          <img className="employee-agency-logo" src="/rcso-logo.png" alt="Riverside County Sheriff's Office"/>
        </div>
        <div className="employee-biography">{biography}</div>
        <dl>
          <dt>Mitarbeiterkennung</dt><dd>{selected.employee_key}</dd>
          <dt>Rang / Funktion</dt><dd>{roleLabels[selected.role]}</dd>
          <dt>Abteilung</dt><dd>{selected.department}{selected.department_head?" · Abteilungsleitung":""}</dd>
          <dt>Dienststatus</dt><dd>{selected.duty_status==="on_duty"?"On Duty":"Off Duty"}</dd>
          <dt>Im Dienst seit</dt><dd>{hired}</dd>
          <dt>Letzte Anmeldung</dt><dd>{selected.last_login_at?fmt(selected.last_login_at):"—"}</dd>
        </dl>
      </article>}
    </section>
  </div>
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

function RecordEditorModal({config,onClose}){
  if(!config)return null;
  const {title,fields,record,onSubmit}=config;
  return <div className="record-modal-overlay" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
    <section className="record-modal-dialog"><header><strong>{title}</strong><button type="button" onClick={onClose}>×</button></header>
      <form onSubmit={async e=>{e.preventDefault();await onSubmit(new FormData(e.currentTarget));onClose()}}>
        <div className="record-modal-grid">{fields.map(([k,l,type,options])=><label key={k}>{l}{type==="select"?<select name={k} defaultValue={record?.[k]||options?.[0]}>{options.map(o=><option key={o}>{o}</option>)}</select>:<input name={k} defaultValue={record?.[k]||""}/>}</label>)}<label className="span-2">Notizen<textarea name="notes" defaultValue={record?.notes||""} rows="5"/></label></div>
        <footer><button type="button" onClick={onClose}>Abbrechen</button><button type="submit">Speichern</button></footer>
      </form>
    </section></div>
}

function RecordModule({employee,title,kind,records,selected,setSelected,addRecord,updateRecord,removeRecord,prefix,fields}){
  const [editor,setEditor]=useState(null);
  const current=records.find(x=>x.id===selected),mayCreate=can(employee,"create",kind),mayEdit=can(employee,"edit",kind),mayDelete=can(employee,"delete",kind);
  async function saveEditor(f){const values=Object.fromEntries(f);if(editor.mode==="create"){await addRecord(kind,{...values,id:nextId(prefix,records),createdAt:nowIso(),updatedAt:nowIso(),createdBy:employee.displayName})}else await updateRecord(kind,current.id,values)}
  return <><div className="record-layout">
    <section className="panel list-panel"><div className="panel-header panel-header-actions"><span>{title.toUpperCase()}</span>{mayCreate&&<button onClick={()=>setEditor({mode:"create"})}>＋ Neu anlegen</button>}</div>
      {!mayCreate&&<div className="permission-note">Ihre Rolle darf hier keine neuen Datensätze anlegen.</div>}
      <div className="record-list">{records.map(x=><button key={x.id} className={selected===x.id?"selected":""} onClick={()=>setSelected(x.id)}><strong>{x.id}</strong><span>{x.subject||x.person||x.title||x.offense}</span></button>)}{!records.length&&<p>Keine Datensätze vorhanden.</p>}</div></section>
    <section className="panel detail-panel"><div className="panel-header">DETAILANSICHT</div>{!current?<p>Datensatz auswählen.</p>:<div className="record-detail"><h2>{current.id}</h2>
      {fields.map(([k,l])=><p key={k}><strong>{l}:</strong> {current[k]||"—"}</p>)}<p><strong>Erstellt:</strong> {fmt(current.createdAt)}</p><p><strong>Erstellt durch:</strong> {current.createdBy||"—"}</p><p><strong>Notizen:</strong><br/>{current.notes||"—"}</p>
      <div className="detail-actions">
        <button onClick={()=>downloadRecordPdf(kind,current,fields)}>Als PDF herunterladen</button>
        {mayEdit&&<button onClick={()=>setEditor({mode:"edit"})}>Bearbeiten</button>}
        {mayDelete&&<button className="danger" onClick={()=>removeRecord(kind,current.id)}>Löschen</button>}
      </div></div>}</section>
  </div><RecordEditorModal config={editor&&{title:editor.mode==="create"?`${title}: neuen Datensatz anlegen`:`${current?.id} bearbeiten`,fields,record:editor.mode==="edit"?current:null,onSubmit:saveEditor}} onClose={()=>setEditor(null)}/></>
}

function Admin({employee}){
 const [unlocked,setUnlocked]=useState(false),[employees,setEmployees]=useState([]),[message,setMessage]=useState(""),[edit,setEdit]=useState(null);
 useEffect(()=>{fetch("/api/admin/status",{cache:"no-store"}).then(r=>r.json()).then(p=>{setUnlocked(!!p.unlocked);if(p.unlocked)load()})},[]);
 async function unlock(e){e.preventDefault();const f=new FormData(e.currentTarget),r=await fetch("/api/admin/unlock",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({adminCode:f.get("adminCode")})}),p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Fehler");setUnlocked(true);load()}
 async function load(){const r=await fetch("/api/admin/employees",{cache:"no-store"}),p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Fehler");setEmployees(p.employees)}
 async function create(e){e.preventDefault();const f=new FormData(e.currentTarget),r=await fetch("/api/admin/employees",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...Object.fromEntries(f),departmentHead:f.has("departmentHead")})}),p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Fehler");e.currentTarget.reset();setMessage("Mitarbeiterkonto angelegt.");load()}
 async function action(body){const r=await fetch("/api/admin/employees",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Fehler");setEdit(null);setMessage("Änderung gespeichert.");load()}
 async function del(id){if(!confirm("Mitarbeiterkonto endgültig löschen?"))return;const r=await fetch(`/api/admin/employees?id=${id}`,{method:"DELETE"}),p=await r.json().catch(()=>({}));if(!r.ok)return setMessage(p.error||"Fehler");load()}
 if(employee.role!=="sheriff_admin")return <section className="panel"><div className="panel-header">ADMIN-MENÜ</div><p>Zugriff verweigert.</p></section>;
 if(!unlocked)return <section className="admin-unlock"><img src="/rcso-logo.png" alt=""/><form onSubmit={unlock}><div className="panel-header">ADMINISTRATIVE AUTORISIERUNG</div><label>Administrationscode<input name="adminCode" type="password" required/></label><button>Entsperren</button><div>{message}</div></form></section>;
 return <><div className="admin-layout"><section className="panel"><div className="panel-header">MITARBEITER ANLEGEN</div><form className="record-form employee-create-form" onSubmit={create}>
  <label>Kennung<input name="employeeKey" required/></label><label>Anzeigename<input name="displayName" required/></label><label>Passwort / Code<input name="validationCode" type="password" minLength="8" required/></label>
  <label>Rolle<select name="role">{Object.entries(roleLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>Abteilung<select name="department">{departments.map(d=><option key={d}>{d}</option>)}</select></label><label className="check-label"><input type="checkbox" name="departmentHead"/> Abteilungsleitung</label><button>Konto anlegen</button></form></section>
  <section className="panel employee-management-panel"><div className="panel-header">MITARBEITERKONTEN</div><div className="employee-cards">{employees.map(e=><article key={e.id}><div><strong>{e.display_name}</strong><span>{e.employee_key}</span><small>{roleLabels[e.role]} · {e.department}{e.department_head?" · Leitung":""}</small><small>{e.status} · {e.duty_status==="on_duty"?"On Duty":"Off Duty"}</small></div><div><button onClick={()=>setEdit(e)}>Bearbeiten</button><button onClick={()=>{const c=prompt("Neuer Code (mind. 8 Zeichen)");if(c)action({id:e.id,action:"reset_code",validationCode:c})}}>Code zurücksetzen</button><button onClick={()=>action({id:e.id,action:"status",status:e.status==="active"?"inactive":"active"})}>{e.status==="active"?"Deaktivieren":"Aktivieren"}</button><button className="danger" onClick={()=>del(e.id)}>Löschen</button></div></article>)}</div><p>{message}</p></section></div>
  <PersonModal config={edit&&{title:"Mitarbeiterkonto bearbeiten",body:<div className="person-form-grid">
    <TextField name="displayName" label="Anzeigename" defaultValue={edit.display_name} required/>
    <SelectField name="role" label="Rolle" defaultValue={edit.role} options={Object.keys(roleLabels)}/>
    <SelectField name="department" label="Abteilung" defaultValue={edit.department} options={departments}/>
    <label><input name="departmentHead" type="checkbox" defaultChecked={edit.department_head}/> Abteilungsleitung</label>
    <label className="span-2">Öffentliche Mitarbeiterbiografie<textarea name="biographyText" rows="8" defaultValue={edit.biography_text||""}/></label>
    <label className="span-2">Neues Profilbild<input name="profilePhotoFile" type="file" accept="image/png,image/jpeg,image/webp"/></label>
    <label><input name="removeProfilePhoto" type="checkbox"/> Profilbild entfernen</label>
  </div>,onSubmit:async f=>{
    let profilePhoto;
    const file=f.get("profilePhotoFile");
    if(file&&file.size){
      if(file.size>1500000)throw new Error("Profilbild darf höchstens 1,5 MB groß sein.");
      profilePhoto=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(new Error("Profilbild konnte nicht gelesen werden."));reader.readAsDataURL(file)});
    }
    return action({id:edit.id,action:"edit",displayName:f.get("displayName"),role:f.get("role"),department:f.get("department"),departmentHead:f.has("departmentHead"),biographyText:f.get("biographyText"),profilePhoto,removeProfilePhoto:f.has("removeProfilePhoto")});
  }}} onClose={()=>setEdit(null)}/></>
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
