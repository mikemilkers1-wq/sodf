import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { requireSession } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(){const employee=await requireSession();if(!employee)return NextResponse.json({error:"Nicht angemeldet."},{status:401});await ensureDatabase();const sql=db();const rows=await sql`SELECT state,version,updated_at,updated_by_department,updated_by_employee FROM county_governance_state WHERE id=1`;return NextResponse.json(rows[0]);}
export async function PUT(){return NextResponse.json({error:"Behördeneinträge werden ausschließlich durch die RinCEN-Behördenleitung verwaltet."},{status:403});}
