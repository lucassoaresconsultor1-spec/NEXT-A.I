import { handlePaymentWebhook } from "@/server/payments/webhook";

// Payment provider callbacks. No session: authenticity is the provider
// signature. The handler checks the provider and the size before reading the
// body, and reads it with a byte limit.
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const result = await handlePaymentWebhook(provider, request.headers, request.body);
  return Response.json(result.body, { status: result.status });
}
