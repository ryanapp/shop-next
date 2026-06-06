import { NextResponse } from "next/server";
import { disableRule } from "../../../../../lib/discounts/lifecycle";
import { requireRuleManager } from "../../../../../lib/rules/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireRuleManager();

  if (!session) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const rule = await disableRule(id);

  return NextResponse.json({ rule });
}
