import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { canAccessAdmin } from "./src/lib/auth/roles";

const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { nextUrl } = request;

  if (!nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  if (!request.auth?.user) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!canAccessAdmin(request.auth.user.role)) {
    return NextResponse.redirect(new URL("/forbidden", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"]
};
