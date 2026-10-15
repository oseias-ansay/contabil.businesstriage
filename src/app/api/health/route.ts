import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", time: new Date().toISOString() });
  } catch {
    return Response.json({ status: "db_error" }, { status: 503 });
  }
}
