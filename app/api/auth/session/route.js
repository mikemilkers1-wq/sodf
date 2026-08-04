import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureDatabase } from "@/lib/setup";

export async function GET() {
  try {
    await ensureDatabase();
    const employee = await requireSession();
    if (!employee) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

    return NextResponse.json({
      employee: {
        id: employee.id,
        employeeKey: employee.employee_key,
        displayName: employee.display_name,
        role: employee.role,
        department: employee.department,
        departmentHead: employee.department_head,
        dutyStatus: employee.duty_status
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Sitzung konnte nicht geprüft werden." }, { status: 500 });
  }
}
