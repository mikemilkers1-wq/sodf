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
          general_notes = ${body.generalNotes || null},
          updated_at = NOW()
        WHERE public_id = ${personId}
      `;
      await log(sql, personId, employee, "PERSON_IDENTITY_UPDATED",
        body.purpose || "Identity correction", {});
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
      await sql`
        INSERT INTO county_person_relationships
          (person_id, related_person_id, relationship_type, verified,
           confidence, source, effective_from)
        VALUES (${personId}, ${body.relatedPersonId}, ${body.relationshipType},
                ${Boolean(body.verified)}, ${body.confidence || "reported"},
                ${body.source || null}, ${body.effectiveFrom || null})
      `;
      await log(sql, personId, employee, "PERSON_RELATIONSHIP_ADDED",
        body.source || null, { relatedPersonId: body.relatedPersonId });
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
    } else {
      return NextResponse.json({ error: "Unbekannte Personregister-Aktion." }, { status: 400 });
    }

    return NextResponse.json({ person: await loadPerson(sql, personId) });
  } catch (error) {
    console.error("POST /api/person-register", error);
    return NextResponse.json({ error: "Personregister-Aktion konnte nicht verarbeitet werden." }, { status: 500 });
  }
}
