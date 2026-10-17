import { z } from "zod";
import { RawEmailSchema, type RawEmail } from "@/lib/contracts";
import { htmlToText } from "@/lib/demo/eml";

interface Part {
  mimeType?: string; filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: Part[];
}
const partSchema: z.ZodType<Part> = z.lazy(() => z.object({
  mimeType: z.string().optional(), filename: z.string().optional(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  body: z.object({ data: z.string().optional(), size: z.number().optional(), attachmentId: z.string().optional() }).optional(),
  parts: z.array(partSchema).optional(),
}));
const messageSchema = z.object({ id: z.string().min(1), threadId: z.string().optional(),
  internalDate: z.string().optional(), payload: partSchema, labelIds: z.array(z.string()).optional() });
const MAX_BODY_BYTES = 1024 * 1024;
export class GmailDecodeError extends Error { constructor() { super("unsupported_or_malformed_message"); } }

/** Ignores attachments; prefers plain text over HTML, including nested MIME. */
export function decodeGmailMessage(input: unknown): RawEmail {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) throw new GmailDecodeError();
  const message = parsed.data;
  const headers = new Map(message.payload.headers?.map(h => [h.name.toLowerCase(), h.value]));
  const plain: string[] = [], html: string[] = [];
  let bytes = 0, visited = 0;
  function visit(part: Part, depth: number) {
    if (++visited > 100 || depth > 15) throw new GmailDecodeError();
    const hs = new Map(part.headers?.map(h => [h.name.toLowerCase(), h.value]));
    if (part.filename || part.body?.attachmentId || /^attachment/i.test(hs.get("content-disposition") ?? "")) return;
    if (part.parts) { for (const child of part.parts) visit(child, depth + 1); return; }
    const mime = part.mimeType?.toLowerCase();
    if (!part.body?.data || (mime !== "text/plain" && mime !== "text/html")) return;
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(part.body.data) || part.body.data.length > MAX_BODY_BYTES * 1.4) throw new GmailDecodeError();
    const buffer = Buffer.from(part.body.data, "base64url");
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new GmailDecodeError();
    const charset = /charset=["']?([^;"'\s]+)/i.exec(hs.get("content-type") ?? "")?.[1] ?? "utf-8";
    let decoded: string;
    try { decoded = new TextDecoder(charset, { fatal: true }).decode(buffer); }
    catch { throw new GmailDecodeError(); }
    if (decoded.trim()) (mime === "text/plain" ? plain : html).push(decoded);
  }
  visit(message.payload, 0);
  const text = (plain.length ? plain.join("\n") : htmlToText(html.join("\n"))).trim();
  if (!text) throw new GmailDecodeError();
  const internal = Number(message.internalDate);
  const received = message.internalDate && Number.isFinite(internal) ? new Date(internal) : new Date(headers.get("date") ?? "");
  if (!Number.isFinite(received.getTime())) throw new GmailDecodeError();
  const result = RawEmailSchema.safeParse({ id: message.id, threadId: message.threadId,
    from: headers.get("from"), to: headers.get("to"), subject: headers.get("subject") ?? "",
    date: received.toISOString(), text, labels: message.labelIds });
  if (!result.success) throw new GmailDecodeError();
  return result.data;
}
