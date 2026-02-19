export interface Env {
  API_BASE: string;
  WEBHOOK_SECRET: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
  passThroughOnException(): void;
}

interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  forward(to: string, headers?: Headers): Promise<void>;
}

export default {
  async email(message: EmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      console.log("[qemail] Processing email from:", message.from, "to:", message.to);

      if (!env.API_BASE || !env.WEBHOOK_SECRET) {
        console.error("[qemail] API_BASE or WEBHOOK_SECRET not configured");
        return;
      }

      const authHeaders = { "X-Webhook-Secret": env.WEBHOOK_SECRET };

      const forwardTarget = await fetchForwardTarget(message.to, env.API_BASE, authHeaders);
      if (forwardTarget) {
        try {
          console.log("[qemail] Forwarding to:", forwardTarget);
          await message.forward(forwardTarget);
        } catch (err) {
          console.error("[qemail] Forward failed:", err);
        }
      }

      console.log("[qemail] Sending raw stream to Fastify webhook...");
      const response = await fetch(`${env.API_BASE}/webhook/incoming-email`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/octet-stream",
          "X-Email-From": message.from,
          "X-Email-To": message.to,
        },
        body: message.raw,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "(unreadable)");
        console.error(`[qemail] Backend ${response.status}: ${body}`);
        return;
      }

      console.log("[qemail] Webhook processed successfully by Fastify");
    } catch (err) {
      console.error("[qemail] Worker error:", err);
    }
  },
};

async function fetchForwardTarget(
  to: string,
  apiBase: string,
  headers: Record<string, string>,
): Promise<string | null> {
  try {
    const url = `${apiBase}/webhook/forward-lookup?to=${encodeURIComponent(to)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json() as { forward_to: string | null };
    return data.forward_to ?? null;
  } catch {
    return null;
  }
}
