import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db";
import {
  generateDiscountRule,
  type GenerationEvent
} from "../../../../lib/discounts/generate";
import { revalidateRuleViews } from "../../../../lib/discounts/lifecycle";
import { requireRuleManager } from "../../../../lib/rules/auth";

type StreamPayload = {
  prompt?: unknown;
  editRuleId?: unknown;
};

export async function POST(request: Request) {
  const session = await requireRuleManager();

  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as StreamPayload | null;

  if (!body || typeof body.prompt !== "string" || body.prompt.trim() === "") {
    return NextResponse.json(
      { error: "Prompt is required." },
      { status: 400 }
    );
  }

  const prompt = body.prompt;
  const editRuleId =
    typeof body.editRuleId === "string" && body.editRuleId.length > 0
      ? body.editRuleId
      : null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: GenerationEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        let slug: string | undefined;

        if (editRuleId) {
          const existingRule = await prisma.rule.findUniqueOrThrow({
            where: { id: editRuleId },
            select: { slug: true }
          });
          slug = existingRule.slug;
        }

        await generateDiscountRule(prompt, {
          slug,
          onEvent: send
        });

        revalidateRuleViews();
      } catch (error) {
        send({
          type: "phase",
          phase: "FAILED",
          message:
            error instanceof Error ? error.message : "Streaming generation failed."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
