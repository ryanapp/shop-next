import { NextResponse } from "next/server";
import { deleteRule } from "../../../../../lib/discounts/lifecycle";
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
  const rule = await deleteRule(id);

  return NextResponse.json({ rule });
}
