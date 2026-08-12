import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { handleChatTransactionMessage } from "@/lib/ai/chat-transaction-handler";
import { M0_AGENT_EVAL_CONTRACT } from "@/lib/ai/agent/m0-eval-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Local-only bridge for the M0 disposable-persona evaluation. The QA script
 * must exercise the same public chat orchestrator as web/Telegram, not import a
 * planner and declare the product healthy from half a pipeline. It is compiled
 * in production so build checks it, but is unreachable there. */
function isLoopbackHost(request: Request): boolean {
  const host = (request.headers.get("host") ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}

function hasEvaluationAuthority(request: Request): boolean {
  const expected = process.env.M0_EVAL_SECRET?.trim() ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  // `NODE_ENV !== "production"` and a loopback-looking Host are not authority.
  // Host is client-controlled and can be spoofed through the same tunnels used
  // to exercise Telegram. This route accepts an arbitrary disposable user id
  // and invokes money-writing code, so it requires an explicit, independent QA
  // bearer secret as well as a local-only deployment posture.
  //
  // `NODE_ENV !== "production"` is not the same claim as "local-only". This
  // route takes a userId in its body and runs the full money-writing
  // orchestrator with no session, so a dev server reached through a tunnel —
  // the normal way this project exercises the Telegram webhook — would publish
  // an unauthenticated write API over the real database. Require an actual
  // loopback host and refuse on any managed deployment.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    !isLoopbackHost(request) ||
    !hasEvaluationAuthority(request)
  ) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const chatId = typeof body.chatId === "string" ? body.chatId : "m0-model-eval";
    const channel = body.channel === "web" ? "web" : "telegram";
    if (!userId || !message || !requestId) {
      return NextResponse.json(
        {
          ok: false,
          error: "userId, message and requestId are required",
          contract: M0_AGENT_EVAL_CONTRACT,
        },
        { status: 400 },
      );
    }
    const result = await handleChatTransactionMessage({
      userId,
      message,
      channel,
      chatId,
      requestId,
    });
    return NextResponse.json({
      ok: true,
      contract: M0_AGENT_EVAL_CONTRACT,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        contract: M0_AGENT_EVAL_CONTRACT,
        error: error instanceof Error ? error.message : "agent evaluation failed",
      },
      { status: 500 },
    );
  }
}
