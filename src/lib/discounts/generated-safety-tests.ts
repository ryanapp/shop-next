export function appendSystemSafetyTest(
  generatedTestCode: string,
  moduleImportPath: string
): string {
  return `${generatedTestCode.trim()}

import { apply as __systemApply } from "${moduleImportPath}";

describe("system-owned discount safety", () => {
  const carts = [
    {
      items: [],
      subtotal: 0,
      placedAt: "2026-06-06T12:00:00.000Z"
    },
    {
      items: [
        {
          sku: "TEA-BLK-003",
          name: "Breakfast Tea Tin",
          category: "pantry",
          qty: 2,
          unitPrice: 1250
        }
      ],
      subtotal: 2500,
      placedAt: "2026-06-06T12:00:00.000Z"
    },
    {
      items: [
        {
          sku: "MUG-STN-001",
          name: "Stoneware Mug",
          category: "home",
          qty: 1,
          unitPrice: 1800
        },
        {
          sku: "BAG-CNV-002",
          name: "Canvas Market Tote",
          category: "bags",
          qty: 1,
          unitPrice: 2400
        }
      ],
      subtotal: 4200,
      placedAt: "2026-06-06T12:00:00.000Z"
    }
  ];

  it("keeps every discount within the cart subtotal", () => {
    for (const cart of carts) {
      const result = __systemApply(cart);
      expect(result.discount).toBeGreaterThanOrEqual(0);
      expect(result.discount).toBeLessThanOrEqual(cart.subtotal);
    }
  });
});
`;
}
