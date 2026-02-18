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

interface WebhookPayload {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string | string[]>;
  messageId: string;
  receivedAt: string;
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

      console.log("[qemail] Building payload...");
      const payload = await buildPayload(message);
      console.log("[qemail] Payload built successfully");

      console.log("[qemail] Sending to webhook:", `${env.API_BASE}/webhook/incoming-email`);
      const res = await fetch(`${env.API_BASE}/webhook/incoming-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "(unreadable)");
        console.error(`[qemail] Backend ${res.status}: ${body}`);
        return;
      }

      console.log("[qemail] Webhook successful");

      const forwardTarget = await fetchForwardTarget(message.to, env.API_BASE, authHeaders);
      if (forwardTarget) {
        try {
          console.log("[qemail] Forwarding to:", forwardTarget);
          await message.forward(forwardTarget);
        } catch (err) {
          console.error("[qemail] Forward failed:", err);
        }
      }

      console.log("[qemail] Email processed successfully");
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

async function buildPayload(message: EmailMessage): Promise<WebhookPayload> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of message.headers) {
    const k = key.toLowerCase();
    const existing = headers[k];
    if (existing === undefined) {
      headers[k] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      headers[k] = [existing, value];
    }
  }

  const subject = (message.headers.get("subject") ?? "").trim() || "(No Subject)";
  const messageId =
    (message.headers.get("message-id") ?? "").trim() ||
    `<${Date.now()}.${Math.random().toString(36).slice(2)}@qemail.worker>`;

  const raw = await readStream(message.raw);

  const crlfIdx = raw.indexOf("\r\n\r\n");
  const lfIdx = raw.indexOf("\n\n");
  const breakAt = crlfIdx !== -1 && (lfIdx === -1 || crlfIdx < lfIdx) ? crlfIdx : lfIdx;
  const rawBody = breakAt !== -1 ? raw.slice(breakAt + (crlfIdx === breakAt ? 4 : 2)) : raw;

  const contentType = message.headers.get("content-type") ?? "";
  const { text, html } = extractParts(rawBody, contentType);

  return { from: message.from, to: message.to, subject, text, html, headers, messageId, receivedAt: new Date().toISOString() };
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

interface Parts { text?: string; html?: string }

function extractParts(body: string, contentType: string): Parts {
  const ct = contentType.toLowerCase();

  if (ct.startsWith("multipart/")) {
    const boundary = parseBoundary(contentType);
    if (boundary) return parseMultipart(body, boundary);
    return {};
  }

  if (ct.startsWith("text/html")) return { html: decodePart(body, contentType) };
  return { text: decodePart(body, contentType) };
}

function parseBoundary(ct: string): string | undefined {
  return ct.match(/boundary\s*=\s*"?([^";\s]+)"?/i)?.[1];
}

function parseMultipart(body: string, boundary: string): Parts {
  const delimiter = `--${boundary}`;
  const parts = body.split(new RegExp(`\\r?\\n${escapeRegExp(delimiter)}`));

  let text: string | undefined;
  let html: string | undefined;

  for (const rawPart of parts) {
    const trimmed = rawPart.replace(/^--\r?\n?$/, "").trim();
    if (!trimmed || trimmed === "--") continue;

    const crlfBreak = rawPart.indexOf("\r\n\r\n");
    const lfBreak = rawPart.indexOf("\n\n");
    const breakAt = crlfBreak !== -1 && (lfBreak === -1 || crlfBreak < lfBreak) ? crlfBreak : lfBreak;
    if (breakAt === -1) continue;

    const partHeaders = rawPart.slice(0, breakAt);
    const partBody = rawPart.slice(breakAt + (crlfBreak === breakAt ? 4 : 2));
    const partCT = extractHeaderValue(partHeaders, "content-type");

    const result = extractParts(partBody, partCT);
    if (result.text) text = (text ?? "") + result.text;
    if (result.html) html = (html ?? "") + result.html;
  }

  return { text, html };
}

function extractHeaderValue(block: string, name: string): string {
  const m = block.match(new RegExp(`^${name}\\s*:\\s*(.+)`, "im"));
  if (!m) return "";
  return m[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

function decodePart(body: string, _ct: string): string {
  const stripped = body.replace(/\r?\n/g, "");
  if (stripped.length > 20 && /^[A-Za-z0-9+/]+=*$/.test(stripped)) {
    try { return decodeBase64Safe(stripped); } catch {}
  }
  return decodeQP(body);
}

function decodeQP(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function decodeBase64Safe(s: string): string {
  const clean = s.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(clean);
  try {
    return decodeURIComponent(binary.split("").map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
  } catch {
    return binary;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
