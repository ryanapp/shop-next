import { auth } from "../../../auth";
import { canAccessAdmin } from "../auth/roles";

export async function requireRuleManager() {
  const session = await auth();

  if (!session?.user || !canAccessAdmin(session.user.role)) {
    return null;
  }

  return session;
}
