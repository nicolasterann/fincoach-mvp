import crypto from "node:crypto";

// Self-serve Telegram linking via a STATELESS, signed deep-link token (Stage
// 21.3). The token embeds the Kipu user id + a short expiry, HMAC-signed so it
// cannot be forged, and is carried in the bot deep link's /start payload
// (Telegram allows up to 64 chars from [A-Za-z0-9_-]; this encodes to ~43). No
// DB row is needed to issue or verify it — the webhook verifies the signature
// and binds the Telegram chat to that user. Short TTL is the safety bound: a
// leaked link is only usable for a few minutes (acceptable for a trusted
// private beta; a stored single-use token would need a migration).

const TOKEN_TTL_SECONDS = 10 * 60;
const SIG_BYTES = 12;
const DEFAULT_BOT_USERNAME = "fincoach_latam_bot";

// Public bot handle — configurable so the username can change without code
// edits. Non-sensitive. Falls back to the current beta bot.
export function telegramBotUsername(): string {
  return (process.env.TELEGRAM_BOT_USERNAME || DEFAULT_BOT_USERNAME).replace(/^@/, "").trim();
}

function linkSecret(): string {
  // Prefer a dedicated secret; fall back to the service-role key (already set in
  // every environment) so the flow works with no extra config. HMAC never
  // reveals the key, so reusing it is cryptographically safe.
  const secret = process.env.TELEGRAM_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("No Telegram link secret configured.");
  return secret;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function uuidToBytes(userId: string): Buffer {
  const hex = userId.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("Invalid user id.");
  return Buffer.from(hex, "hex");
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createTelegramLinkToken(userId: string, now: number = nowSeconds()): string {
  const id = uuidToBytes(userId); // 16 bytes
  const exp = Buffer.alloc(4);
  exp.writeUInt32BE(now + TOKEN_TTL_SECONDS, 0); // 4 bytes
  const signed = Buffer.concat([id, exp]);
  const sig = crypto.createHmac("sha256", linkSecret()).update(signed).digest().subarray(0, SIG_BYTES);
  return base64url(Buffer.concat([signed, sig])); // 32 bytes → ~43 chars
}

// Returns the Kipu user id if the token is authentic and unexpired, else null.
export function verifyTelegramLinkToken(token: string, now: number = nowSeconds()): string | null {
  try {
    const buf = fromBase64url(token);
    if (buf.length !== 16 + 4 + SIG_BYTES) return null;
    const signed = buf.subarray(0, 20);
    const sig = buf.subarray(20);
    const expected = crypto.createHmac("sha256", linkSecret()).update(signed).digest().subarray(0, SIG_BYTES);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
    if (signed.readUInt32BE(16) < now) return null;
    return bytesToUuid(signed.subarray(0, 16));
  } catch {
    return null;
  }
}

export function telegramConnectDeepLink(userId: string): string {
  return `https://t.me/${telegramBotUsername()}?start=${createTelegramLinkToken(userId)}`;
}
