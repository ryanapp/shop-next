const poundsFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP"
});

export function formatPence(valuePence: number): string {
  if (!Number.isInteger(valuePence)) {
    throw new Error("Money values must be integer pence.");
  }

  return poundsFormatter.format(valuePence / 100);
}
