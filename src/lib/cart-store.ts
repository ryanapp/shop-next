import { cookies } from "next/headers";
import { prisma } from "./db";
import { buildCartSummary, type CartSummary } from "./cart";

const cartCookieName = "shop_next_cart_id";

export async function getCurrentCartSummary(): Promise<CartSummary> {
  const cartId = await getCartIdFromCookie();

  if (!cartId) {
    return buildCartSummary([]);
  }

  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { product: true }
      }
    }
  });

  return buildCartSummary(cart?.items ?? []);
}

export async function addProductToCurrentCart(productId: string): Promise<void> {
  const cartId = await getOrCreateCartId();

  await prisma.cartItem.upsert({
    where: {
      cartId_productId: {
        cartId,
        productId
      }
    },
    update: {
      quantity: {
        increment: 1
      }
    },
    create: {
      cartId,
      productId,
      quantity: 1
    }
  });
}

export async function decrementCurrentCartItem(productId: string): Promise<void> {
  const cartId = await getCartIdFromCookie();

  if (!cartId) {
    return;
  }

  const item = await prisma.cartItem.findUnique({
    where: {
      cartId_productId: {
        cartId,
        productId
      }
    }
  });

  if (!item) {
    return;
  }

  if (item.quantity <= 1) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return;
  }

  await prisma.cartItem.update({
    where: { id: item.id },
    data: {
      quantity: {
        decrement: 1
      }
    }
  });
}

export async function removeCurrentCartItem(productId: string): Promise<void> {
  const cartId = await getCartIdFromCookie();

  if (!cartId) {
    return;
  }

  await prisma.cartItem.deleteMany({
    where: {
      cartId,
      productId
    }
  });
}

async function getCartIdFromCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(cartCookieName)?.value;
}

async function getOrCreateCartId(): Promise<string> {
  const cookieStore = await cookies();
  const existingCartId = cookieStore.get(cartCookieName)?.value;

  if (existingCartId) {
    const existingCart = await prisma.cart.findUnique({
      where: { id: existingCartId },
      select: { id: true }
    });

    if (existingCart) {
      return existingCart.id;
    }
  }

  const cart = await prisma.cart.create({ data: {} });
  cookieStore.set(cartCookieName, cart.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return cart.id;
}
