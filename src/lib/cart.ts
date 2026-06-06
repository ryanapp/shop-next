export type CartProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  pricePence: number;
};

export type CartSummaryInputItem = {
  quantity: number;
  product: CartProduct;
};

export type CartSummaryLine = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
};

export type CartSummary = {
  lines: CartSummaryLine[];
  itemCount: number;
  subtotalPence: number;
};

export function buildCartSummary(items: CartSummaryInputItem[]): CartSummary {
  const lines = items.map((item) => {
    assertIntegerPence(item.product.pricePence);
    assertPositiveQuantity(item.quantity);

    return {
      productId: item.product.id,
      sku: item.product.sku,
      name: item.product.name,
      category: item.product.category,
      quantity: item.quantity,
      unitPricePence: item.product.pricePence,
      lineTotalPence: item.quantity * item.product.pricePence
    };
  });

  return {
    lines,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    subtotalPence: lines.reduce(
      (total, line) => total + line.lineTotalPence,
      0
    )
  };
}

function assertIntegerPence(value: number): void {
  if (!Number.isInteger(value)) {
    throw new Error("Cart prices must be integer pence.");
  }
}

function assertPositiveQuantity(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Cart quantities must be positive integers.");
  }
}
