import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DEPARTMENT = process.env.COUNTY_DEPARTMENT_CODE || "RCSO";

function actor(employee) {
  return {
    id: employee.id,
    key: employee.employeeKey || employee.employee_key || String(employee.id),
    name: employee.displayName || employee.display_name || employee.employeeKey || employee.employee_key,
    role: employee.role
  };
}

function masked(value) {
  if (!value) return null;
  return `***-**-${String(value).slice(-4)}`;
}

async function log(sql, personId, employee, action, purpose, details = {}) {
  const user = actor(employee);
  await sql`
    INSERT INTO county_person_audit
      (person_id, department, employee_key, action, purpose, details)
    VALUES
      (${personId || null}, ${DEPARTMENT}, ${user.key}, ${action},
       ${purpose || null}, ${JSON.stringify(details)}::jsonb)
  `;
}

async function loadPerson(sql, id) {
  const people = await sql`SELECT * FROM county_people WHERE public_id = ${id}`;
  if (!people.length) return null;

  const [aliases, addresses, photos, relationships, roles, events, links] = await Promise.all([
    sql`SELECT * FROM county_person_aliases WHERE person_id = ${id} ORDER BY created_at DESC`,
    sql`SELECT * FROM county_person_addresses WHERE person_id = ${id} ORDER BY is_current DESC, created_at DESC`,
    sql`SELECT id, person_id, photo_type, image_data_url, taken_at, source_department, source_record,
               uploaded_by_employee_key, is_primary, is_obsolete, created_at
        FROM county_person_photos WHERE person_id = ${id}
        ORDER BY is_primary DESC, created_at DESC`,
    sql`SELECT r.*, p.legal_first_name AS related_first_name,
               p.legal_last_name AS related_last_name, p.status AS related_status
        FROM county_person_relationships r
        JOIN county_people p ON p.public_id = r.related_person_id
        WHERE r.person_id = ${id}
        ORDER BY r.created_at DESC`,
    sql`SELECT * FROM county_person_roles WHERE person_id = ${id}
        ORDER BY status = 'active' DESC, created_at DESC`,
    sql`SELECT * FROM county_person_events WHERE person_id = ${id}
        ORDER BY occurred_at DESC NULLS LAST, created_at DESC`,
    sql`SELECT * FROM county_person_links WHERE person_id = ${id}
        ORDER BY occurred_at DESC NULLS LAST, updated_at DESC`
  ]);

  const person = people[0];
  return {
    ...person,
    ssn_masked: masked(person.ssn_last4),
    driver_license_masked: person.driver_license_last4
      ? `******${person.driver_license_last4}`
      : null,
    ssn_last4: undefined,
    driver_license_last4: undefined,
    aliases,
    addresses,
    photos,
    relationships,
    roles,
    events,
    links
  };
}


function personLegalName(person) {
  return [person.legal_first_name, person.legal_middle_name, person.legal_last_name, person.suffix]
    .filter(Boolean).join(" ");
}

function formattedAddress(address) {
  return [
    address.line1,
    address.line2,
    [address.city, address.state_code, address.postal_code].filter(Boolean).join(" ")
  ].filter(Boolean).join(", ");
}

async function updateRincenState(sql, mutate) {
  const rows = await sql`SELECT state, version FROM rcdf_portal_state WHERE id = 1`;
  if (!rows.length) return false;

  const current = rows[0];
  const state = current.state;
  const changed = await mutate(state);
  if (!changed) return false;

  const result = await sql`
    UPDATE rcdf_portal_state
    SET state = ${JSON.stringify(state)}::jsonb,
        version = version + 1,
        updated_at = NOW(),
        updated_by = NULL
    WHERE id = 1 AND version = ${Number(current.version)}
    RETURNING version
  `;
  return Boolean(result.length);
}

async function synchronizePersonIntoRincen(sql, personId) {
  const people = await sql`SELECT * FROM county_people WHERE public_id = ${personId}`;
  if (!people.length) return false;

  const person = people[0];
  const addresses = await sql`
    SELECT * FROM county_person_addresses
    WHERE person_id = ${personId}
    ORDER BY is_current DESC, created_at DESC
  `;

  return updateRincenState(sql, async state => {
    let changed = false;
    for (const account of state.accounts || []) {
      if (account.personId !== personId) continue;

      if (account.classification === "Privatperson") {
        const legalName = personLegalName(person);
        if (legalName && account.holder !== legalName) {
          account.holder = legalName;
          changed = true;
        }
      }

      account.properties ||= [];
      const addressIds = new Set(addresses.map(address => String(address.id)));

      const filtered = account.properties.filter(property =>
        property.source !== "person_register" ||
        property.personAddressId == null ||
        addressIds.has(String(property.personAddressId))
      );
      if (filtered.length !== account.properties.length) {
        account.properties = filtered;
        changed = true;
      }

      for (const address of addresses) {
        const propertyId = `person-address-${address.id}`;
        const name = formattedAddress(address);
        const existing = account.properties.find(property => property.id === propertyId);
        const next = {
          id: propertyId,
          type: address.is_current ? "Aktuelle Adresse" : "Frühere Adresse",
          name,
          value: 0,
          reference: `PERSONREGISTER:${address.id}`,
          note: `${address.address_type || "address"} • ${address.verified ? "verified" : "unverified"}`,
          createdAt: address.created_at,
          createdBy: "County Person Register",
          source: "person_register",
          personAddressId: address.id,
          addressData: {
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            stateCode: address.state_code,
            postalCode: address.postal_code,
            isCurrent: address.is_current
          }
        };
        if (!existing) {
          account.properties.push(next);
          changed = true;
        } else if (JSON.stringify(existing) !== JSON.stringify(next)) {
          Object.assign(existing, next);
          changed = true;
        }
      }
    }
    return changed;
  });
}

async function removePersonFromRincen(sql, personId) {
  return updateRincenState(sql, async state => {
    let changed = false;
    for (const account of state.accounts || []) {
      if (account.personId !== personId) continue;
      account.personId = null;
      account.properties = (account.properties || []).filter(property => property.source !== "person_register");
      changed = true;
    }
    return changed;
  });
}

async function synchronizeRincenAccountLinks(sql, accountId, employee) {
  const rows = await sql`SELECT state FROM rcdf_portal_state WHERE id = 1`;
  if (!rows.length) throw new Error("RinCEN state not found.");

  const state = rows[0].state;
  const account = (state.accounts || []).find(item => item.id === accountId);
  if (!account) throw new Error("RinCEN account not found.");
  if (!account.personId) throw new Error("Account is not linked to a person.");

  const personId = account.personId;
  const now = new Date().toISOString();

  await sql`
    DELETE FROM county_person_links
    WHERE department = 'RINCEN'
      AND metadata->>'accountId' = ${accountId}
      AND record_type IN ('PROPERTY','LICENSE','INVOICE','ENFORCEMENT','INVESTIGATION')
  `;

  await sql`
    INSERT INTO county_person_links
      (person_id, department, record_type, record_id, record_status,
       summary, amount, occurred_at, metadata)
    VALUES (
      ${personId}, 'RINCEN', 'ACCOUNT', ${account.id}, ${account.status || null},
      ${`${account.holder} • ${account.classification}`},
      ${Number(account.balance || 0)}, ${now},
      ${JSON.stringify({ accountId, risk: account.risk })}::jsonb
    )
    ON CONFLICT (department, record_type, record_id)
    DO UPDATE SET person_id = EXCLUDED.person_id,
      record_status = EXCLUDED.record_status,
      summary = EXCLUDED.summary,
      amount = EXCLUDED.amount,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `;

  for (const property of account.properties || []) {
    if (property.source === "person_register") continue;
    await sql`
      INSERT INTO county_person_links
        (person_id, department, record_type, record_id, record_status,
         summary, amount, occurred_at, metadata)
      VALUES (
        ${personId}, 'RINCEN', 'PROPERTY', ${`${account.id}:${property.id}`}, 'recorded',
        ${`${property.type}: ${property.name}`}, ${Number(property.value || 0)},
        ${property.createdAt || now},
        ${JSON.stringify({
          accountId,
          propertyId: property.id,
          reference: property.reference || null,
          note: property.note || null
        })}::jsonb
      )
      ON CONFLICT (department, record_type, record_id)
      DO UPDATE SET person_id = EXCLUDED.person_id, summary = EXCLUDED.summary,
        amount = EXCLUDED.amount, metadata = EXCLUDED.metadata, updated_at = NOW()
    `;
  }

  for (const license of account.licenses || []) {
    await sql`
      INSERT INTO county_person_links
        (person_id, department, record_type, record_id, record_status,
         summary, occurred_at, metadata)
      VALUES (
        ${personId}, 'RINCEN', 'LICENSE', ${license.number || `${account.id}:${license.id}`},
        ${license.status || "active"},
        ${`${license.type} • ${license.scope || "No scope recorded"}`},
        ${license.createdAt || now},
        ${JSON.stringify({
          accountId,
          licenseId: license.id,
          expiresAt: license.expiresAt || null,
          neverExpires: Boolean(license.neverExpires),
          reference: license.reference || null
        })}::jsonb
      )
      ON CONFLICT (department, record_type, record_id)
      DO UPDATE SET person_id = EXCLUDED.person_id, record_status = EXCLUDED.record_status,
        summary = EXCLUDED.summary, metadata = EXCLUDED.metadata, updated_at = NOW()
    `;
  }

  for (const invoice of (state.invoices || []).filter(item => item.accountId === account.id)) {
    await sql`
      INSERT INTO county_person_links
        (person_id, department, record_type, record_id, record_status,
         summary, amount, occurred_at, metadata)
      VALUES (
        ${personId}, 'RINCEN', 'INVOICE', ${invoice.id}, ${invoice.status || null},
        ${invoice.subject || "Invoice"}, ${Number(invoice.total || 0)},
        ${invoice.issuedAt || now},
        ${JSON.stringify({ accountId, dueDate: invoice.dueDate || null })}::jsonb
      )
      ON CONFLICT (department, record_type, record_id)
      DO UPDATE SET person_id = EXCLUDED.person_id, record_status = EXCLUDED.record_status,
        summary = EXCLUDED.summary, amount = EXCLUDED.amount,
        metadata = EXCLUDED.metadata, updated_at = NOW()
    `;
  }

  for (const order of (state.enforcementOrders || []).filter(item => item.accountId === account.id)) {
    await sql`
      INSERT INTO county_person_links
        (person_id, department, record_type, record_id, record_status,
         summary, amount, occurred_at, metadata)
      VALUES (
        ${personId}, 'RINCEN', 'ENFORCEMENT', ${order.id}, ${order.status || null},
        ${order.subject || order.type || "Enforcement matter"},
        ${Number(order.amount || 0)}, ${order.createdAt || now},
        ${JSON.stringify({
          accountId,
          recoveredAmount: Number(order.recoveredAmount || 0),
          assignedTo: order.assignedTo || null
        })}::jsonb
      )
      ON CONFLICT (department, record_type, record_id)
      DO UPDATE SET person_id = EXCLUDED.person_id, record_status = EXCLUDED.record_status,
        summary = EXCLUDED.summary, amount = EXCLUDED.amount,
        metadata = EXCLUDED.metadata, updated_at = NOW()
    `;
  }

  for (const investigation of (state.cases || []).filter(item => (item.accountIds || []).includes(account.id))) {
    await sql`
      INSERT INTO county_person_links
        (person_id, department, record_type, record_id, record_status,
         summary, occurred_at, metadata)
      VALUES (
        ${personId}, 'RINCEN', 'INVESTIGATION', ${investigation.id}, ${investigation.status || null},
        ${investigation.title || investigation.subject || "Investigation"},
        ${investigation.opened || now},
        ${JSON.stringify({
          accountId,
          priority: investigation.priority || null,
          assigned: investigation.assigned || null
        })}::jsonb
      )
      ON CONFLICT (department, record_type, record_id)
      DO UPDATE SET person_id = EXCLUDED.person_id, record_status = EXCLUDED.record_status,
        summary = EXCLUDED.summary, metadata = EXCLUDED.metadata, updated_at = NOW()
    `;
  }

  await log(sql, personId, employee, "RINCEN_ACCOUNT_SYNCHRONIZED",
    "Automatic cross-department synchronization", { accountId });

  return loadPerson(sql, personId);
}


function inverseRelationshipType(type) {
  const normalized = String(type || "").trim().toLowerCase().replace(/\s+/g, "_");
  const map = {
    spouse: "spouse",
    former_spouse: "former_spouse",
    sibling: "sibling",
    parent: "child",
    child: "parent",
    guardian: "ward",
    ward: "guardian",
    employer: "employee",
    employee: "employer",
    supervisor: "subordinate",
    subordinate: "supervisor",
    business_associate: "business_associate",
    household_member: "household_member",
    emergency_contact: "emergency_contact_of",
    emergency_contact_of: "emergency_contact",
    owner: "owned_by",
    owned_by: "owner"
  };
  return map[normalized] || "related_person";
}

async function loadRelationshipPair(sql, personId, id) {
  const rows = await sql`
    SELECT *
    FROM county_person_relationships
    WHERE id = ${Number(id)} AND person_id = ${personId}
  `;
  if (!rows.length) return null;
  const current = rows[0];

  let counterpart = null;
  if (current.relationship_pair_id) {
    const reverse = await sql`
      SELECT *
      FROM county_person_relationships
      WHERE relationship_pair_id = ${current.relationship_pair_id}
        AND id <> ${current.id}
      LIMIT 1
    `;
    counterpart = reverse[0] || null;
  }

  return { current, counterpart };
}

async function auditRevision(sql, personId, employee, action, purpose, before, after = null) {
  await log(sql, personId, employee, action, purpose || 'Person-register revision', { before, after });
}

export async function GET(request) {
  try {
    await ensureDatabase();
    const employee = await requireSession();
    if (!employee) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

    const sql = db();
    const url = new URL(request.url);
    const id = String(url.searchParams.get("id") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim();
    const purpose = String(url.searchParams.get("purpose") || "Operational person search").trim();

    if (id) {
      const person = await loadPerson(sql, id);
      if (!person) return NextResponse.json({ error: "Person nicht gefunden." }, { status: 404 });
      await log(sql, id, employee, "PERSON_PROFILE_VIEWED", purpose, {});
      return NextResponse.json({ person });
    }

    if (q.length < 2) return NextResponse.json({ people: [] });

    const search = `%${q}%`;
    const people = await sql`
      SELECT DISTINCT p.public_id, p.legal_first_name, p.legal_middle_name,
             p.legal_last_name, p.suffix, p.date_of_birth, p.sex, p.status,
             p.created_at,
             (
               SELECT a.line1 || ', ' || a.city || ', ' || a.state_code ||
                      COALESCE(' ' || a.postal_code, '')
               FROM county_person_addresses a
               WHERE a.person_id = p.public_id
               ORDER BY a.is_current DESC, a.created_at DESC
               LIMIT 1
             ) AS current_address,
             (
               SELECT ph.image_data_url
               FROM county_person_photos ph
               WHERE ph.person_id = p.public_id AND ph.is_obsolete = FALSE
               ORDER BY ph.is_primary DESC, ph.created_at DESC
               LIMIT 1
             ) AS primary_photo
      FROM county_people p
      LEFT JOIN county_person_aliases al ON al.person_id = p.public_id
      LEFT JOIN county_person_addresses ad ON ad.person_id = p.public_id
      LEFT JOIN county_person_roles ro ON ro.person_id = p.public_id
      WHERE p.public_id ILIKE ${search}
         OR p.legal_first_name ILIKE ${search}
         OR p.legal_middle_name ILIKE ${search}
         OR p.legal_last_name ILIKE ${search}
         OR al.first_name ILIKE ${search}
         OR al.last_name ILIKE ${search}
         OR ad.line1 ILIKE ${search}
         OR ad.city ILIKE ${search}
         OR ad.postal_code ILIKE ${search}
         OR ro.badge_number ILIKE ${search}
         OR ro.employee_number ILIKE ${search}
      ORDER BY p.legal_last_name, p.legal_first_name
      LIMIT 75
    `;

    await log(sql, null, employee, "PERSON_SEARCH", purpose, {
      query: q,
      resultCount: people.length
    });
    return NextResponse.json({ people });
  } catch (error) {
    console.error("GET /api/person-register", error);
    return NextResponse.json({ error: "Personregister konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureDatabase();
    const employee = await requireSession();
    if (!employee) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

    const user = actor(employee);
    const body = await request.json();
    const action = String(body.action || "");
    const sql = db();

    if (action === "create_person") {
      if (!body.legalFirstName?.trim() || !body.legalLastName?.trim() || !body.creationReason?.trim()) {
        return NextResponse.json({
          error: "Vorname, Nachname und Erfassungsgrund sind erforderlich."
        }, { status: 400 });
      }

      const rows = await sql`
        INSERT INTO county_people (
          legal_first_name, legal_middle_name, legal_last_name, suffix,
          date_of_birth, sex, height_cm, weight_kg, eye_color, hair_color,
          ssn_last4, driver_license_last4, primary_phone, primary_email,
          creation_reason, source_department, source_record, general_notes,
          created_by_department, created_by_employee_key
        ) VALUES (
          ${body.legalFirstName.trim()}, ${body.legalMiddleName?.trim() || null},
          ${body.legalLastName.trim()}, ${body.suffix?.trim() || null},
          ${body.dateOfBirth || null}, ${body.sex || null},
          ${Number(body.heightCm) || null}, ${Number(body.weightKg) || null},
          ${body.eyeColor || null}, ${body.hairColor || null},
          ${body.ssnLast4?.replace(/\D/g, "").slice(-4) || null},
          ${body.driverLicenseLast4?.slice(-4) || null},
          ${body.primaryPhone || null}, ${body.primaryEmail || null},
          ${body.creationReason.trim()}, ${DEPARTMENT},
          ${body.sourceRecord || null}, ${body.generalNotes || null},
          ${DEPARTMENT}, ${user.key}
        )
        RETURNING public_id
      `;
      const id = rows[0].public_id;
      await log(sql, id, employee, "PERSON_CREATED", body.creationReason, {
        sourceRecord: body.sourceRecord || null
      });
      return NextResponse.json({ person: await loadPerson(sql, id) }, { status: 201 });
    }

    const personId = String(body.personId || "").trim();
    if (!personId) return NextResponse.json({ error: "Person-ID fehlt." }, { status: 400 });

    if (action === "repair_reciprocal_relationships") {
      if (employee.role !== "sheriff_admin") {
        return NextResponse.json({ error: "Nur ein Sheriff Administrator darf die Beziehungsreparatur ausführen." }, { status: 403 });
      }

      await sql`ALTER TABLE county_person_relationships ADD COLUMN IF NOT EXISTS relationship_pair_id UUID`;

      const legacy = await sql`
        SELECT *
        FROM county_person_relationships
        WHERE relationship_pair_id IS NULL
        ORDER BY id
      `;
      let repaired = 0;

      for (const rel of legacy) {
        const stillExists = await sql`
          SELECT *
          FROM county_person_relationships
          WHERE id = ${rel.id} AND relationship_pair_id IS NULL
        `;
        if (!stillExists.length) continue;

        const expectedInverse = inverseRelationshipType(rel.relationship_type);
        const reverse = await sql`
          SELECT *
          FROM county_person_relationships
          WHERE person_id = ${rel.related_person_id}
            AND related_person_id = ${rel.person_id}
            AND relationship_pair_id IS NULL
          ORDER BY id
          LIMIT 1
        `;
        const pairRows = await sql`SELECT gen_random_uuid() AS id`;
        const pairId = pairRows[0].id;

        await sql`
          UPDATE county_person_relationships
          SET relationship_pair_id = ${pairId}
          WHERE id = ${rel.id}
        `;

        if (reverse.length) {
          await sql`
            UPDATE county_person_relationships
            SET relationship_pair_id = ${pairId}
            WHERE id = ${reverse[0].id}
          `;
        } else {
          await sql`
            INSERT INTO county_person_relationships
              (person_id, related_person_id, relationship_type, relationship_pair_id,
               verified, confidence, source, effective_from, effective_to)
            VALUES
              (${rel.related_person_id}, ${rel.person_id}, ${expectedInverse}, ${pairId},
               ${rel.verified}, ${rel.confidence}, ${rel.source},
               ${rel.effective_from}, ${rel.effective_to})
          `;
        }
        repaired += 1;
      }

      await log(sql, null, employee, "RELATIONSHIP_RECIPROCITY_REPAIRED",
        "Legacy reciprocal relationship repair", { repaired });
      return NextResponse.json({ ok: true, repaired });
    }

    if (action === "sync_rincen_account") {
      if (DEPARTMENT !== "RINCEN") {
        return NextResponse.json({ error: "Diese Synchronisierung ist nur über RinCEN verfügbar." }, { status: 403 });
      }
      const person = await synchronizeRincenAccountLinks(sql, String(body.accountId || ""), employee);
      return NextResponse.json({ person });
    }

    if (action === "delete_person") {
      if (!["finance_director", "assistant_director"].includes(employee.role)) {
        return NextResponse.json({ error: "Nur Finance Director oder Assistant Finance Director dürfen einen vollständigen Personeneintrag löschen." }, { status: 403 });
      }
      if (String(body.confirmPersonId || "").trim().toUpperCase() !== personId.toUpperCase()) {
        return NextResponse.json({ error: "Die Bestätigungs-ID stimmt nicht mit der Person-ID überein." }, { status: 400 });
      }
      const existing = await sql`
        SELECT public_id, legal_first_name, legal_middle_name, legal_last_name,
               source_department, source_record, status
        FROM county_people WHERE public_id = ${personId}
      `;
      if (!existing.length) return NextResponse.json({ error: "Person nicht gefunden." }, { status: 404 });

      const user = actor(employee);
      await sql`
        INSERT INTO county_person_audit
          (person_id, department, employee_key, action, purpose, details)
        VALUES (
          ${personId}, ${DEPARTMENT}, ${user.key}, 'PERSON_DELETION_AUTHORIZED',
          ${body.reason || "Erroneous or test record removal"},
          ${JSON.stringify({ deletedPerson: existing[0], requestedBy: user.name })}::jsonb
        )
      `;

      if (DEPARTMENT === "RINCEN") await removePersonFromRincen(sql, personId);
      await sql`DELETE FROM county_people WHERE public_id = ${personId}`;

      await sql`
        INSERT INTO county_person_audit
          (person_id, department, employee_key, action, purpose, details)
        VALUES (
          NULL, ${DEPARTMENT}, ${user.key}, 'PERSON_DELETED',
          ${body.reason || "Erroneous or test record removal"},
          ${JSON.stringify({
            deletedPersonId: personId,
            deletedName: [
              existing[0].legal_first_name,
              existing[0].legal_middle_name,
              existing[0].legal_last_name
            ].filter(Boolean).join(" "),
            sourceDepartment: existing[0].source_department,
            sourceRecord: existing[0].source_record
          })}::jsonb
        )
      `;
      return NextResponse.json({ deleted: true, personId });
    }

    if (action === "update_person") {
      await sql`
        UPDATE county_people SET
          legal_first_name = COALESCE(${body.legalFirstName || null}, legal_first_name),
          legal_middle_name = ${body.legalMiddleName ?? null},
          legal_last_name = COALESCE(${body.legalLastName || null}, legal_last_name),
          suffix = ${body.suffix ?? null},
          date_of_birth = ${body.dateOfBirth || null},
          sex = ${body.sex || null},
          height_cm = ${Number(body.heightCm) || null},
          weight_kg = ${Number(body.weightKg) || null},
          eye_color = ${body.eyeColor || null},
          hair_color = ${body.hairColor || null},
          primary_phone = ${body.primaryPhone || null},
          primary_email = ${body.primaryEmail || null},
          ssn_last4 = COALESCE(${body.ssnLast4?.replace(/\D/g, "").slice(-4) || null}, ssn_last4),
          general_notes = ${body.generalNotes || null},
          updated_at = NOW()
        WHERE public_id = ${personId}
      `;
      await log(sql, personId, employee, "PERSON_IDENTITY_UPDATED",
        body.purpose || "Identity correction", {});
      if (DEPARTMENT === "RINCEN") await synchronizePersonIntoRincen(sql, personId);
    } else if (action === "set_status") {
      if (!["active","archived","deceased","restricted"].includes(body.status)) {
        return NextResponse.json({ error: "Ungültiger Status." }, { status: 400 });
      }
      await sql`
        UPDATE county_people SET
          status = ${body.status},
          deceased_at = ${body.status === "deceased" ? body.deceasedAt || null : null},
          deceased_source = ${body.status === "deceased" ? body.deceasedSource || null : null},
          archived_at = ${body.status === "archived" ? new Date().toISOString() : null},
          archived_reason = ${body.status === "archived" ? body.reason || null : null},
          updated_at = NOW()
        WHERE public_id = ${personId}
      `;
      await log(sql, personId, employee, "PERSON_STATUS_CHANGED",
        body.reason || body.deceasedSource || "Status change", { status: body.status });
    } else if (action === "add_alias") {
      await sql`
        INSERT INTO county_person_aliases
          (person_id, first_name, middle_name, last_name, alias_type, verified, source)
        VALUES (${personId}, ${body.firstName || null}, ${body.middleName || null},
                ${body.lastName}, ${body.aliasType || "alias"},
                ${Boolean(body.verified)}, ${body.source || null})
      `;
      await log(sql, personId, employee, "PERSON_ALIAS_ADDED", body.source || null, {});
    } else if (action === "add_address") {
      if (body.isCurrent) {
        await sql`UPDATE county_person_addresses SET is_current = FALSE WHERE person_id = ${personId}`;
      }
      await sql`
        INSERT INTO county_person_addresses
          (person_id, line1, line2, city, state_code, postal_code,
           address_type, is_current, verified, valid_from, source)
        VALUES (${personId}, ${body.line1}, ${body.line2 || null}, ${body.city},
                ${body.stateCode || "CA"}, ${body.postalCode || null},
                ${body.addressType || "residential"}, ${Boolean(body.isCurrent)},
                ${Boolean(body.verified)}, ${body.validFrom || null}, ${body.source || null})
      `;
      await log(sql, personId, employee, "PERSON_ADDRESS_ADDED", body.source || null, {});
      if (DEPARTMENT === "RINCEN") await synchronizePersonIntoRincen(sql, personId);
    } else if (action === "add_photo") {
      const data = String(body.imageDataUrl || "");
      if (!data.startsWith("data:image/") || data.length > 2_800_000) {
        return NextResponse.json({
          error: "Foto fehlt oder überschreitet ungefähr 2 MB."
        }, { status: 400 });
      }
      if (body.isPrimary) {
        await sql`UPDATE county_person_photos SET is_primary = FALSE WHERE person_id = ${personId}`;
      }
      await sql`
        INSERT INTO county_person_photos
          (person_id, photo_type, image_data_url, taken_at, source_department,
           source_record, uploaded_by_employee_key, is_primary)
        VALUES (${personId}, ${body.photoType || "other"}, ${data},
                ${body.takenAt || null}, ${DEPARTMENT}, ${body.sourceRecord || null},
                ${user.key}, ${Boolean(body.isPrimary)})
      `;
      await log(sql, personId, employee, "PERSON_PHOTO_ADDED",
        body.sourceRecord || "Photo upload", { photoType: body.photoType });
    } else if (action === "add_relationship") {
      const relatedPersonId = String(body.relatedPersonId || "").trim().toUpperCase();
      if (!relatedPersonId || relatedPersonId === personId) {
        return NextResponse.json({ error: "Ungültige verbundene Person-ID." }, { status: 400 });
      }

      const target = await sql`
        SELECT public_id
        FROM county_people
        WHERE public_id = ${relatedPersonId}
      `;
      if (!target.length) {
        return NextResponse.json({ error: "Die verbundene Person wurde nicht gefunden." }, { status: 404 });
      }

      const pairIdRows = await sql`SELECT gen_random_uuid() AS id`;
      const pairId = pairIdRows[0].id;
      const directType = String(body.relationshipType || "related_person").trim();
      const inverseType = String(body.inverseRelationshipType || inverseRelationshipType(directType)).trim();

      await sql`
        INSERT INTO county_person_relationships
          (person_id, related_person_id, relationship_type, relationship_pair_id,
           verified, confidence, source, effective_from, effective_to)
        VALUES
          (${personId}, ${relatedPersonId}, ${directType}, ${pairId},
           ${Boolean(body.verified)}, ${body.confidence || "reported"},
           ${body.source || null}, ${body.effectiveFrom || null}, ${body.effectiveTo || null}),
          (${relatedPersonId}, ${personId}, ${inverseType}, ${pairId},
           ${Boolean(body.verified)}, ${body.confidence || "reported"},
           ${body.source || null}, ${body.effectiveFrom || null}, ${body.effectiveTo || null})
      `;

      await log(sql, personId, employee, "PERSON_RELATIONSHIP_ADDED",
        body.source || null, {
          relatedPersonId,
          relationshipType: directType,
          inverseRelationshipType: inverseType,
          relationshipPairId: pairId
        });
      await log(sql, relatedPersonId, employee, "PERSON_RELATIONSHIP_RECIPROCAL_ADDED",
        body.source || null, {
          relatedPersonId: personId,
          relationshipType: inverseType,
          relationshipPairId: pairId
        });
    } else if (action === "add_role") {
      await sql`
        INSERT INTO county_person_roles
          (person_id, role_type, organization, title_or_rank, badge_number,
           employee_number, jurisdiction, political_party, starts_at, ends_at,
           status, source)
        VALUES (${personId}, ${body.roleType}, ${body.organization},
                ${body.titleOrRank || null}, ${body.badgeNumber || null},
                ${body.employeeNumber || null}, ${body.jurisdiction || null},
                ${body.politicalParty || null}, ${body.startsAt || null},
                ${body.endsAt || null}, ${body.status || "active"}, ${body.source || null})
      `;
      await log(sql, personId, employee, "PERSON_PUBLIC_ROLE_ADDED",
        body.source || null, { roleType: body.roleType });
    } else if (action === "add_event") {
      await sql`
        INSERT INTO county_person_events
          (person_id, event_category, event_status, title, occurred_at,
           ended_at, department, source_record, summary, disposition, restricted)
        VALUES (${personId}, ${body.eventCategory}, ${body.eventStatus || null},
                ${body.title}, ${body.occurredAt || null}, ${body.endedAt || null},
                ${DEPARTMENT}, ${body.sourceRecord || null}, ${body.summary || null},
                ${body.disposition || null}, ${Boolean(body.restricted)})
      `;
      await log(sql, personId, employee, "PERSON_EVENT_ADDED",
        body.sourceRecord || null, { category: body.eventCategory });
    } else if (action === "link_record") {
      await sql`
        INSERT INTO county_person_links
          (person_id, department, record_type, record_id, record_status,
           summary, amount, occurred_at, metadata)
        VALUES (${personId}, ${body.department || DEPARTMENT}, ${body.recordType},
                ${body.recordId}, ${body.recordStatus || null}, ${body.summary || null},
                ${body.amount == null ? null : Number(body.amount)},
                ${body.occurredAt || null}, ${JSON.stringify(body.metadata || {})}::jsonb)
        ON CONFLICT (department, record_type, record_id)
        DO UPDATE SET person_id = EXCLUDED.person_id,
          record_status = EXCLUDED.record_status,
          summary = EXCLUDED.summary, amount = EXCLUDED.amount,
          occurred_at = EXCLUDED.occurred_at, metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;
      await log(sql, personId, employee, "DEPARTMENT_RECORD_LINKED",
        body.purpose || "Record linking", {
          department: body.department || DEPARTMENT,
          recordType: body.recordType,
          recordId: body.recordId
        });
    } else if (action === "unlink_record") {
      await sql`
        DELETE FROM county_person_links
        WHERE department = ${body.department || DEPARTMENT}
          AND record_type = ${body.recordType}
          AND record_id = ${body.recordId}
      `;
      await log(sql, personId, employee, "DEPARTMENT_RECORD_UNLINKED",
        body.purpose || "Record unlinking", {
          recordType: body.recordType, recordId: body.recordId
        });
    } else if (action === "update_alias") {
      const rows=await sql`SELECT * FROM county_person_aliases WHERE id=${Number(body.id)} AND person_id=${personId}`;
      if(!rows.length)return NextResponse.json({error:"Alias nicht gefunden."},{status:404});
      await sql`UPDATE county_person_aliases SET first_name=${body.firstName||null},middle_name=${body.middleName||null},
        last_name=${body.lastName},alias_type=${body.aliasType||"alias"},verified=${Boolean(body.verified)},
        source=${body.source||null} WHERE id=${Number(body.id)} AND person_id=${personId}`;
      await auditRevision(sql,personId,employee,"PERSON_ALIAS_REVISED",body.reason,rows[0],body);
    } else if (action === "delete_alias") {
      const rows=await sql`DELETE FROM county_person_aliases WHERE id=${Number(body.id)} AND person_id=${personId} RETURNING *`;
      if(!rows.length)return NextResponse.json({error:"Alias nicht gefunden."},{status:404});
      await auditRevision(sql,personId,employee,"PERSON_ALIAS_REMOVED",body.reason,rows[0]);
    } else if (action === "update_address") {
      const rows=await sql`SELECT * FROM county_person_addresses WHERE id=${Number(body.id)} AND person_id=${personId}`;
      if(!rows.length)return NextResponse.json({error:"Adresse nicht gefunden."},{status:404});
      if(body.isCurrent)await sql`UPDATE county_person_addresses SET is_current=FALSE,valid_to=COALESCE(valid_to,CURRENT_DATE)
        WHERE person_id=${personId} AND id<>${Number(body.id)} AND is_current=TRUE`;
      await sql`UPDATE county_person_addresses SET line1=${body.line1},line2=${body.line2||null},
        city=${body.city},state_code=${body.stateCode||"CA"},postal_code=${body.postalCode||null},
        address_type=${body.addressType||"residential"},is_current=${Boolean(body.isCurrent)},
        verified=${Boolean(body.verified)},valid_from=${body.validFrom||null},
        valid_to=${body.isCurrent?null:(body.validTo||null)},source=${body.source||null}
        WHERE id=${Number(body.id)} AND person_id=${personId}`;
      await auditRevision(sql,personId,employee,"PERSON_ADDRESS_REVISED",body.reason,rows[0],body);
      await synchronizePersonIntoRincen(sql,personId);
    } else if (action === "delete_address") {
      const rows=await sql`DELETE FROM county_person_addresses WHERE id=${Number(body.id)} AND person_id=${personId} RETURNING *`;
      if(!rows.length)return NextResponse.json({error:"Adresse nicht gefunden."},{status:404});
      await auditRevision(sql,personId,employee,"PERSON_ADDRESS_REMOVED",body.reason,rows[0]);
      await synchronizePersonIntoRincen(sql,personId);
    } else if (action === "update_role") {
      const rows=await sql`SELECT * FROM county_person_roles WHERE id=${Number(body.id)} AND person_id=${personId}`;
      if(!rows.length)return NextResponse.json({error:"Rolle nicht gefunden."},{status:404});
      await sql`UPDATE county_person_roles SET role_type=${body.roleType},organization=${body.organization},
        title_or_rank=${body.titleOrRank||null},badge_number=${body.badgeNumber||null},
        employee_number=${body.employeeNumber||null},jurisdiction=${body.jurisdiction||null},
        political_party=${body.politicalParty||null},starts_at=${body.startsAt||null},ends_at=${body.endsAt||null},
        status=${body.status||"active"},source=${body.source||null}
        WHERE id=${Number(body.id)} AND person_id=${personId}`;
      await auditRevision(sql,personId,employee,"PERSON_ROLE_REVISED",body.reason,rows[0],body);
    } else if (action === "delete_role") {
      const rows=await sql`DELETE FROM county_person_roles WHERE id=${Number(body.id)} AND person_id=${personId} RETURNING *`;
      if(!rows.length)return NextResponse.json({error:"Rolle nicht gefunden."},{status:404});
      await auditRevision(sql,personId,employee,"PERSON_ROLE_REMOVED",body.reason,rows[0]);
    } else if (action === "update_relationship") {
      const pair = await loadRelationshipPair(sql, personId, body.id);
      if (!pair) return NextResponse.json({ error: "Beziehung nicht gefunden." }, { status: 404 });

      const relatedPersonId = String(body.relatedPersonId || pair.current.related_person_id).trim().toUpperCase();
      if (relatedPersonId !== pair.current.related_person_id) {
        return NextResponse.json({
          error: "Die verbundene Person kann nicht innerhalb einer Revision ausgetauscht werden. Entfernen Sie die Beziehung und legen Sie sie neu an."
        }, { status: 400 });
      }

      const directType = String(body.relationshipType || pair.current.relationship_type).trim();
      const inverseType = String(
        body.inverseRelationshipType ||
        pair.counterpart?.relationship_type ||
        inverseRelationshipType(directType)
      ).trim();

      await sql`
        UPDATE county_person_relationships
        SET relationship_type = ${directType},
            verified = ${Boolean(body.verified)},
            confidence = ${body.confidence || "reported"},
            source = ${body.source || null},
            effective_from = ${body.effectiveFrom || null},
            effective_to = ${body.effectiveTo || null}
        WHERE id = ${pair.current.id}
      `;

      if (pair.counterpart) {
        await sql`
          UPDATE county_person_relationships
          SET relationship_type = ${inverseType},
              verified = ${Boolean(body.verified)},
              confidence = ${body.confidence || "reported"},
              source = ${body.source || null},
              effective_from = ${body.effectiveFrom || null},
              effective_to = ${body.effectiveTo || null}
          WHERE id = ${pair.counterpart.id}
        `;
      }

      await auditRevision(sql, personId, employee, "PERSON_RELATIONSHIP_REVISED",
        body.reason, pair.current, {
          ...body,
          relationshipType: directType,
          inverseRelationshipType: inverseType
        });

      if (pair.counterpart) {
        await auditRevision(sql, pair.counterpart.person_id, employee,
          "PERSON_RELATIONSHIP_RECIPROCAL_REVISED",
          body.reason, pair.counterpart, {
            relationshipType: inverseType,
            relatedPersonId: personId
          });
      }
    } else if (action === "delete_relationship") {
      const pair = await loadRelationshipPair(sql, personId, body.id);
      if (!pair) return NextResponse.json({ error: "Beziehung nicht gefunden." }, { status: 404 });

      if (pair.current.relationship_pair_id) {
        await sql`
          DELETE FROM county_person_relationships
          WHERE relationship_pair_id = ${pair.current.relationship_pair_id}
        `;
      } else {
        await sql`
          DELETE FROM county_person_relationships
          WHERE id = ${pair.current.id}
        `;
      }

      await auditRevision(sql, personId, employee, "PERSON_RELATIONSHIP_REMOVED",
        body.reason, pair.current);

      if (pair.counterpart) {
        await auditRevision(sql, pair.counterpart.person_id, employee,
          "PERSON_RELATIONSHIP_RECIPROCAL_REMOVED",
          body.reason, pair.counterpart);
      }
    } else if (action === "update_event") {
      const rows=await sql`SELECT * FROM county_person_events WHERE id=${Number(body.id)} AND person_id=${personId}`;
      if(!rows.length)return NextResponse.json({error:"Ereignis nicht gefunden."},{status:404});
      await sql`UPDATE county_person_events SET event_category=${body.eventCategory},
        event_status=${body.eventStatus||null},title=${body.title},occurred_at=${body.occurredAt||null},
        ended_at=${body.endedAt||null},source_record=${body.sourceRecord||null},
        summary=${body.summary||null},disposition=${body.disposition||null},restricted=${Boolean(body.restricted)}
        WHERE id=${Number(body.id)} AND person_id=${personId}`;
      await auditRevision(sql,personId,employee,"PERSON_EVENT_REVISED",body.reason,rows[0],body);
    } else if (action === "void_event") {
      const rows=await sql`SELECT * FROM county_person_events WHERE id=${Number(body.id)} AND person_id=${personId}`;
      if(!rows.length)return NextResponse.json({error:"Ereignis nicht gefunden."},{status:404});
      await sql`UPDATE county_person_events SET event_status='voided',
        summary=COALESCE(summary,'')||${`\n[VOIDED] ${body.reason||"No reason supplied"}`}
        WHERE id=${Number(body.id)} AND person_id=${personId}`;
      await auditRevision(sql,personId,employee,"PERSON_EVENT_VOIDED",body.reason,rows[0],{event_status:"voided"});
    } else if (action === "delete_photo") {
      const rows=await sql`DELETE FROM county_person_photos WHERE id=${Number(body.id)} AND person_id=${personId}
        RETURNING id,photo_type,source_department,source_record,created_at`;
      if(!rows.length)return NextResponse.json({error:"Foto nicht gefunden."},{status:404});
      await auditRevision(sql,personId,employee,"PERSON_PHOTO_REMOVED",body.reason,rows[0]);
    } else {
      return NextResponse.json({ error: "Unbekannte Personregister-Aktion." }, { status: 400 });
    }

    return NextResponse.json({ person: await loadPerson(sql, personId) });
  } catch (error) {
    console.error("POST /api/person-register", error);
    return NextResponse.json({ error: "Personregister-Aktion konnte nicht verarbeitet werden." }, { status: 500 });
  }
}
