import bcrypt from "bcryptjs";
import { prisma } from "../db";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type CredentialsInput = Partial<Record<"email" | "password", unknown>>;

type PasswordUserRecord = AuthenticatedUser & {
  passwordHash: string;
};

export function parseCredentials(
  credentials: CredentialsInput | undefined
): { email: string; password: string } | null {
  const email = credentials?.email;
  const password = credentials?.password;

  if (typeof email !== "string" || typeof password !== "string") {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail.length === 0 || password.length === 0) {
    return null;
  }

  return {
    email: normalizedEmail,
    password
  };
}

export async function verifyPasswordCredentials(
  password: string,
  user: PasswordUserRecord | null
): Promise<AuthenticatedUser | null> {
  if (!user) {
    return null;
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  };
}

export async function authorizeCredentials(
  credentials: CredentialsInput | undefined
): Promise<AuthenticatedUser | null> {
  const parsed = parseCredentials(credentials);

  if (!parsed) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.email }
  });

  return verifyPasswordCredentials(parsed.password, user);
}
