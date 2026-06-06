import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "../../../auth";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const hasError = params.error === "CredentialsSignin";

  async function signInAction(formData: FormData) {
    "use server";

    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: safeCallbackUrl(formData.get("callbackUrl"))
      });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect("/login?error=CredentialsSignin");
      }

      throw error;
    }
  }

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Harbour & Shelf
        </Link>
        <Link className="cart-link" href="/cart">
          Basket
        </Link>
      </header>

      <section className="auth-layout" aria-labelledby="login-title">
        <div>
          <p className="section-kicker">Shop manager access</p>
          <h1 id="login-title">Sign in to manage promotions.</h1>
          <p>
            Demo credentials are seeded locally for a shop manager and a
            customer account.
          </p>
        </div>

        <form action={signInAction} className="auth-panel">
          <input name="callbackUrl" type="hidden" value={callbackUrl} />
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              name="email"
              placeholder="manager@example.com"
              required
              type="email"
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              name="password"
              placeholder="manager-password"
              required
              type="password"
            />
          </label>
          {hasError ? (
            <p className="form-error">Those credentials did not match a user.</p>
          ) : null}
          <button type="submit">Sign in</button>
        </form>
      </section>
    </>
  );
}

function safeCallbackUrl(
  value: FormDataEntryValue | string | null | undefined
): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/admin";
  }

  if (value.startsWith("//")) {
    return "/admin";
  }

  return value;
}
