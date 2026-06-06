import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import {
  parseCredentials,
  verifyPasswordCredentials
} from "../src/lib/auth/credentials";
import { canAccessAdmin, SHOP_MANAGER_ROLE } from "../src/lib/auth/roles";

describe("credentials auth", () => {
  it("normalizes valid email/password credentials", () => {
    expect(
      parseCredentials({
        email: "  MANAGER@example.com ",
        password: "manager-password"
      })
    ).toEqual({
      email: "manager@example.com",
      password: "manager-password"
    });
  });

  it("rejects missing or blank credentials", () => {
    expect(parseCredentials(undefined)).toBeNull();
    expect(parseCredentials({ email: "", password: "secret" })).toBeNull();
    expect(parseCredentials({ email: "user@example.com", password: "" })).toBeNull();
  });

  it("returns a safe user object for a matching bcrypt password", async () => {
    const passwordHash = await bcrypt.hash("manager-password", 12);

    await expect(
      verifyPasswordCredentials("manager-password", {
        id: "user_1",
        email: "manager@example.com",
        name: "Shop Manager",
        role: SHOP_MANAGER_ROLE,
        passwordHash
      })
    ).resolves.toEqual({
      id: "user_1",
      email: "manager@example.com",
      name: "Shop Manager",
      role: SHOP_MANAGER_ROLE
    });
  });

  it("rejects an incorrect bcrypt password", async () => {
    const passwordHash = await bcrypt.hash("manager-password", 12);

    await expect(
      verifyPasswordCredentials("wrong-password", {
        id: "user_1",
        email: "manager@example.com",
        name: "Shop Manager",
        role: SHOP_MANAGER_ROLE,
        passwordHash
      })
    ).resolves.toBeNull();
  });
});

describe("admin role gating", () => {
  it("allows only shop managers into the admin shell", () => {
    expect(canAccessAdmin(SHOP_MANAGER_ROLE)).toBe(true);
    expect(canAccessAdmin("customer")).toBe(false);
    expect(canAccessAdmin(undefined)).toBe(false);
  });
});
