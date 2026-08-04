import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureDatabase } from "@/lib/setup";
import { requireSession } from "@/lib/auth";
export async function PATCH(request){
  await ensureDatabase();
  const employee=await requireSession();
  if(!employee)return NextResponse.json({error:"Nicht angemeldet."},{status:401});
  const {dutyStatus}=await request.json().catch(()=>({}));
  if(!["on_duty","off_duty"].includes(dutyStatus))return NextResponse.json({error:"Ungültiger Dienststatus."},{status:400});
  const sql=db();
  const rows=await sql`UPDATE rcso_employees SET duty_status=${dutyStatus} WHERE id=${employee.id}
    RETURNING id,employee_key,display_name,role,status,department,department_head,duty_status`;
  await sql`INSERT INTO rcso_audit_log(employee_id,action,details) VALUES(${employee.id},'DUTY_STATUS_CHANGED',${JSON.stringify({dutyStatus})}::jsonb)`;
  const e=rows[0];
  return NextResponse.json({employee:{id:e.id,employeeKey:e.employee_key,displayName:e.display_name,role:e.role,department:e.department,departmentHead:e.department_head,dutyStatus:e.duty_status}});
}
