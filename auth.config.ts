import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login"
  },
  session: {
    strategy: "jwt"
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id);
        session.user.role = String(token.role);
      }

      return session;
    }
  },
  providers: []
} satisfies NextAuthConfig;
