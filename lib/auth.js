import crypto from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const COOKIE_NAME = "rcso_session";

function secret() {
  const value = process.env.RCSO_SESSION_SECRET;
  if (!value || value.length < 24) {
    throw new Error("RCSO_SESSION_SECRET fehlt oder ist zu kurz.");
  }
  return value;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

export async function createSession(employee) {
  const payload = Buffer.from(JSON.stringify({
    id: employee.id,
    employeeKey: employee.employee_key,
    displayName: employee.display_name,
    role: employee.role,
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });
}

export async function clearSession() {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

export async function getSessionPayload() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;

  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data.exp || data.exp < Date.now()) return null;
  return data;
}

export async function requireSession() {
  const session = await getSessionPayload();
  if (!session) return null;

  const sql = db();
  const rows = await sql`
    SELECT id, employee_key, display_name, role, status
    FROM rcso_employees
    WHERE id = ${session.id}
  `;
  if (!rows.length || rows[0].status !== "active") return null;
  return rows[0];
}
