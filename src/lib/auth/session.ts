import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { canAccessAdmin } from "./roles";

export async function requireShopManagerSession() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/admin");
  }

  if (!canAccessAdmin(session.user.role)) {
    redirect("/forbidden");
  }

  return session;
}
