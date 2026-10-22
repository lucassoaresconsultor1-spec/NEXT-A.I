import { logger } from "@/lib/logger";
import { sessionCookieName } from "@/server/auth/cookie";
import { validateSessionToken } from "@/server/auth/session";
import { loadTenantContext } from "@/server/authz/context";
import { officeSnapshot } from "@/server/office/snapshot";

// Virtual office events (m24a): one "snapshot" event every 5 s for the member's
// organization. The session and the organization access are authorized again
// before every event; losing either sends "fim" and closes the stream.

const INTERVAL_MS = 5_000;

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

async function authorize(token: string | undefined, organizationId?: string) {
  const session = token ? await validateSessionToken(token) : null;
  if (!session || session.user.mustChangePassword || !session.activeOrganizationId) return null;
  if (organizationId && session.activeOrganizationId !== organizationId) return null;
  const context = await loadTenantContext(session, session.activeOrganizationId);
  return context?.permissions.has("ai.use") ? context : null;
}

export async function GET(request: Request) {
  const token = cookieValue(request, sessionCookieName());
  const first = await authorize(token);
  if (!first) return Response.json({ error: "Sessão inválida ou sem acesso ao escritório." }, { status: 401 });
  const organizationId = first.organization.id;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = async () => {
        try {
          const context = await authorize(token, organizationId);
          if (!context) {
            send("fim", { motivo: "acesso encerrado" });
            controller.close();
            return;
          }
          send("snapshot", await officeSnapshot(context));
          timer = setTimeout(tick, INTERVAL_MS);
        } catch (error) {
          logger.error({ err: { name: (error as Error)?.name } }, "Office stream failed");
          send("fim", { motivo: "erro" });
          controller.close();
        }
      };
      request.signal.addEventListener("abort", () => clearTimeout(timer));
      void tick();
    },
    cancel() {
      clearTimeout(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
