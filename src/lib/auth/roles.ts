export const SHOP_MANAGER_ROLE = "shop-manager";
export const CUSTOMER_ROLE = "customer";

export type UserRole = typeof SHOP_MANAGER_ROLE | typeof CUSTOMER_ROLE | string;

export function canAccessAdmin(role: UserRole | null | undefined): boolean {
  return role === SHOP_MANAGER_ROLE;
}
