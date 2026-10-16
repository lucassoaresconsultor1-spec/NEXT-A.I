import { logger } from "@/lib/logger";
import { checkDatabase } from "@/server/health";

// Liveness plus a database round trip. Reports no versions or configuration.
export async function GET() {
  try {
    await checkDatabase();
    return Response.json({ status: "ok", database: "ok" });
  } catch (error) {
    logger.error({ err: { code: (error as { code?: string })?.code } }, "Health check failed");
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
