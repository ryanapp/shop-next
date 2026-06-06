import { cartSummaryToDiscountCart } from "./adapter";
import { priceCartWithRules, type DiscountPricing } from "./engine";
import { loadActiveDiscountRules } from "./loader";
import type { CartSummary } from "../cart";

export async function priceCartSummary(
  summary: CartSummary,
  placedAt: Date = new Date()
): Promise<DiscountPricing> {
  const discountCart = cartSummaryToDiscountCart(
    summary,
    formatStorePlacedAt(placedAt)
  );
  const activeRules = await loadActiveDiscountRules();

  return priceCartWithRules(discountCart, activeRules);
}

export function formatStorePlacedAt(
  date: Date,
  timeZone = "Europe/London"
): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  const second = value("second");
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const offsetMinutes = Math.round((localAsUtc - date.getTime()) / 60_000);
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHour = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetMinute = String(absoluteOffset % 60).padStart(2, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetSign}${offsetHour}:${offsetMinute}`;
}
