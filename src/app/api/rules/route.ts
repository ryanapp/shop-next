import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db";
import { generateDiscountRule } from "../../../lib/discounts/generate";
import { requireRuleManager } from "../../../lib/rules/auth";

export async function GET() {
  const session = await requireRuleManager();

  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rules = await prisma.rule.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      source: true,
      slug: true,
      version: true,
      status: true,
      testResults: true,
      createdAt: true
    }
  });

  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  const session = await requireRuleManager();

  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
  } | null;

  if (!body || typeof body.prompt !== "string" || body.prompt.trim() === "") {
    return NextResponse.json(
      { error: "Prompt is required." },
      { status: 400 }
    );
  }

  const result = await generateDiscountRule(body.prompt);

  return NextResponse.json(result, {
    status: result.accepted ? 200 : 200
  });
}
