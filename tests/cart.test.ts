import { describe, expect, it } from "vitest";
import { buildCartSummary } from "../src/lib/cart";

describe("cart totals", () => {
  it("summarizes quantities, line totals, and subtotal in integer pence", () => {
    const summary = buildCartSummary([
      {
        quantity: 2,
        product: {
          id: "prod_mug",
          sku: "MUG-STN-001",
          name: "Harbour Stoneware Mug",
          category: "home",
          pricePence: 1800
        }
      },
      {
        quantity: 3,
        product: {
          id: "prod_tea",
          sku: "TEA-BLK-003",
          name: "Pier Breakfast Tea Tin",
          category: "pantry",
          pricePence: 1250
        }
      }
    ]);

    expect(summary.itemCount).toBe(5);
    expect(summary.subtotalPence).toBe(7350);
    expect(summary.lines).toEqual([
      {
        productId: "prod_mug",
        sku: "MUG-STN-001",
        name: "Harbour Stoneware Mug",
        category: "home",
        quantity: 2,
        unitPricePence: 1800,
        lineTotalPence: 3600
      },
      {
        productId: "prod_tea",
        sku: "TEA-BLK-003",
        name: "Pier Breakfast Tea Tin",
        category: "pantry",
        quantity: 3,
        unitPricePence: 1250,
        lineTotalPence: 3750
      }
    ]);
  });

  it("returns zero totals for an empty cart", () => {
    const summary = buildCartSummary([]);

    expect(summary.lines).toEqual([]);
    expect(summary.itemCount).toBe(0);
    expect(summary.subtotalPence).toBe(0);
  });

  it("rejects non-integer money before totals are calculated", () => {
    expect(() =>
      buildCartSummary([
        {
          quantity: 1,
          product: {
            id: "prod_bad",
            sku: "BAD-PRICE",
            name: "Bad Price",
            category: "test",
            pricePence: 12.5
          }
        }
      ])
    ).toThrow("integer pence");
  });

  it("rejects non-positive quantities", () => {
    expect(() =>
      buildCartSummary([
        {
          quantity: 0,
          product: {
            id: "prod_zero",
            sku: "ZERO-QTY",
            name: "Zero Quantity",
            category: "test",
            pricePence: 100
          }
        }
      ])
    ).toThrow("positive integers");
  });
});
