import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export async function checkDatabase() {
  const db = getDb();
  await db.execute(sql`select 1`);
}
