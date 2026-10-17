import { logger } from "@/lib/logger";
import { checkDatabase } from "@/server/health";

// Liveness plus a database round trip. Reports no versions or configuration.
export async function GET() {
  try {
    await checkDatabase();
    return Response.json({ status: "ok", database: "ok" });
  } catch (error) {
    // Name and message identify the cause (missing env var, auth, DNS, timeout); they never carry the URL or password.
    type Failure = { name?: string; message?: string; code?: string; cause?: Failure };
    const { name, message, code, cause } = error as Failure;
    // Drizzle wraps the driver error ("Failed query: ...") in `cause`.
    const driver = cause && { name: cause.name, code: cause.code, message: cause.message };
    logger.error({ err: { name, code, message, cause: driver } }, "Health check failed");
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
