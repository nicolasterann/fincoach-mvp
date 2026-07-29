import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { handleEvidenceCapture } from "@/lib/capture/evidence-capture";
import {
  findUserByInboundToken,
  hashEvidence,
  registerEvidence,
} from "@/lib/capture/evidence-store";

// A statement attached by email can drive a long, multi-batch import in one
// synchronous turn — give the function the platform max so it completes.
export const maxDuration = 300;

// Inbound email foundation (Stage 12): each user gets a personal capture
// address (token@INBOUND_EMAIL_DOMAIN). An email-receiving provider (e.g.
// Resend Inbound / Mailgun Routes) posts the parsed email here.
//
// Disabled until production setup is completed: provider configured, MX/DNS
// records on the domain, and INBOUND_EMAIL_SECRET set. Without the secret the
// route answers 503 and does nothing — it never pretends the channel exists.
//
// Security model: timing-safe shared-secret header (provider → us), per-user
// opaque token (identity comes ONLY from the recipient token, never the From
// header — anti-spoofing), bounded request + attachment sizes, and idempotency
// for BOTH attachments (content hash) and text bodies (replay protection).

interface InboundAttachment {
  filename?: string;
  contentType?: string;
  contentBase64?: string;
}

interface InboundEmailPayload {
  to?: string;
  from?: string;
  subject?: string;
  text?: string;
  attachments?: InboundAttachment[];
}

const MAX_ATTACHMENTS = 3;
const MAX_TEXT_CHARS = 4000;
const MAX_REQUEST_BYTES = 28 * 1024 * 1024; // bound JSON parse cost
const MAX_AGGREGATE_DECODED_BYTES = 24 * 1024 * 1024; // sum of attachment bytes

function extractToken(to: string): string | null {
  const local = to.split("@")[0]?.trim().toLowerCase() ?? "";
  return local || null;
}

function secretMatches(received: string | null, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.INBOUND_EMAIL_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "Inbound email is not enabled." },
      { status: 503 },
    );
  }

  if (!secretMatches(request.headers.get("x-inbound-email-secret"), expectedSecret)) {
    return NextResponse.json(
      { ok: false, error: "Invalid inbound email secret." },
      { status: 401 },
    );
  }

  // Bound the request size BEFORE parsing the full JSON/base64 body.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ ok: false, error: "Payload too large." }, { status: 413 });
  }

  let payload: InboundEmailPayload;
  try {
    payload = (await request.json()) as InboundEmailPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid payload." }, { status: 400 });
  }

  const token = payload.to ? extractToken(payload.to) : null;
  const userId = token ? await findUserByInboundToken(token) : null;
  if (!userId) {
    // Unknown recipient: accept silently (200) so the provider does not retry
    // or bounce — bounces would leak which addresses exist.
    return NextResponse.json({ ok: true, skipped: "unknown recipient" });
  }

  const subject = typeof payload.subject === "string" ? payload.subject.slice(0, 200) : "";
  const results: string[] = [];

  // Attachments first (bounded count + aggregate decoded size).
  const attachments = (payload.attachments ?? []).slice(0, MAX_ATTACHMENTS);
  let aggregateBytes = 0;
  for (const attachment of attachments) {
    if (!attachment?.contentBase64) continue;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(attachment.contentBase64, "base64"));
    } catch {
      continue;
    }
    aggregateBytes += bytes.byteLength;
    if (aggregateBytes > MAX_AGGREGATE_DECODED_BYTES) {
      results.push("(adjuntos demasiado grandes; algunos no se procesaron)");
      break;
    }
    const capture = await handleEvidenceCapture({
      userId,
      channel: "web",
      chatId: userId,
      source: "email",
      file: {
        bytes,
        mimeType: attachment.contentType ?? "application/octet-stream",
        filename: attachment.filename,
      },
      caption: subject,
    });
    results.push(capture.reply);
  }

  // Body text: ALWAYS considered (not skipped just because attachments exist),
  // but only when it carries content beyond a bare forward. Replay-protected by
  // a content hash so the same email delivered twice is not double-counted.
  const text = payload.text?.trim().slice(0, MAX_TEXT_CHARS);
  if (text) {
    const textHash = hashEvidence(`email|${token}|${subject}|${text}`);
    const claim = await registerEvidence({
      userId,
      source: "email",
      kind: "text",
      contentHash: textHash,
    });
    if (claim.error) {
      // Fail closed so the provider retries rather than dropping the email.
      return NextResponse.json({ ok: false, retry: true }, { status: 503 });
    }
    if (!claim.duplicate) {
      if (!claim.id || !claim.claimVersion) {
        return NextResponse.json({ ok: false, retry: true }, { status: 503 });
      }
      const framed = subject
        ? `Te reenvío un correo (asunto: ${subject}):\n${text}`
        : `Te reenvío un correo:\n${text}`;
      try {
        const result = await handleChatTransactionMessage({
          userId,
          message: framed,
          channel: "web",
          chatId: userId,
          requestId: claim.id,
          evidenceId: claim.id,
          evidenceVersion: claim.claimVersion,
          evidenceSummary: `correo: ${subject || text.slice(0, 80)}`,
          clarificationContext: framed.slice(0, 600),
        });
        results.push(result.chatResponse.message);
      } catch {
        return NextResponse.json({ ok: false, retry: true }, { status: 503 });
      }
    }
  }

  return NextResponse.json({ ok: true, processed: results.length });
}
