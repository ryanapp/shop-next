import Link from "next/link";
import { signOut } from "../../../auth";
import { requireShopManagerSession } from "../../lib/auth/session";
import { RuleConsole } from "./rule-console";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await requireShopManagerSession();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Harbour & Shelf
        </Link>
        <form action={signOutAction}>
          <button type="submit">Sign out</button>
        </form>
      </header>

      <section className="admin-shell" aria-labelledby="admin-title">
        <div className="admin-heading">
          <div>
            <p className="section-kicker">Rule console</p>
            <h1 id="admin-title">Create a plain-English promotion.</h1>
          </div>
          <p>
            Signed in as {session.user.name} with role {session.user.role}.
          </p>
        </div>

        <RuleConsole />
      </section>
    </>
  );
}
