import { logger } from "@/lib/logger";
import { checkDatabase } from "@/server/health";

// Liveness plus a database round trip. Reports no versions or configuration.
export async function GET() {
  try {
    await checkDatabase();
    return Response.json({ status: "ok", database: "ok" });
  } catch (error) {
    // Name and message identify the cause (missing env var, auth, DNS, timeout); they never carry the URL or password.
    const { name, message, code } = error as { name?: string; message?: string; code?: string };
    logger.error({ err: { name, code, message } }, "Health check failed");
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
