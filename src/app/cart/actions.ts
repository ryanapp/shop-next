"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addProductToCurrentCart,
  decrementCurrentCartItem,
  removeCurrentCartItem
} from "../../lib/cart-store";

export async function addToCartAction(formData: FormData): Promise<void> {
  const productId = readRequiredFormValue(formData, "productId");
  const returnTo = readOptionalFormValue(formData, "returnTo") ?? "/cart";

  await addProductToCurrentCart(productId);
  revalidateCartViews();
  redirect(returnTo);
}

export async function decrementCartItemAction(
  formData: FormData
): Promise<void> {
  const productId = readRequiredFormValue(formData, "productId");

  await decrementCurrentCartItem(productId);
  revalidateCartViews();
  redirect("/cart");
}

export async function removeCartItemAction(formData: FormData): Promise<void> {
  const productId = readRequiredFormValue(formData, "productId");

  await removeCurrentCartItem(productId);
  revalidateCartViews();
  redirect("/cart");
}

function readRequiredFormValue(formData: FormData, key: string): string {
  const value = formData.get(key);

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing ${key}.`);
  }

  return value;
}

function readOptionalFormValue(
  formData: FormData,
  key: string
): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function revalidateCartViews(): void {
  revalidatePath("/");
  revalidatePath("/cart");
  revalidatePath("/products/[sku]", "page");
}
