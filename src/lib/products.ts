export type ProductVisual = {
  label: string;
  className: string;
};

const productVisuals: Record<string, ProductVisual> = {
  "MUG-STN-001": {
    label: "Blue glazed mug",
    className: "product-art product-art-mug"
  },
  "BAG-CNV-002": {
    label: "Canvas beach tote",
    className: "product-art product-art-tote"
  },
  "TEA-BLK-003": {
    label: "Breakfast tea tin",
    className: "product-art product-art-tea"
  }
};

export function getProductVisual(sku: string): ProductVisual {
  return (
    productVisuals[sku] ?? {
      label: "Seaside shop item",
      className: "product-art"
    }
  );
}
