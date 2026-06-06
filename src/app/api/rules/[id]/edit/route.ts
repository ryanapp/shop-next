import { NextResponse } from "next/server";
import { editRule } from "../../../../../lib/discounts/lifecycle";
import { requireRuleManager } from "../../../../../lib/rules/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
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

  const { id } = await context.params;
  const result = await editRule(id, body.prompt);

  return NextResponse.json(result);
}
