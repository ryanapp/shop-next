import Link from "next/link";
import {
  decrementCartItemAction,
  removeCartItemAction
} from "./actions";
import { getCurrentCartSummary } from "../../lib/cart-store";
import { priceCartSummary } from "../../lib/discounts/pricing";
import { formatPence } from "../../lib/money";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const cart = await getCurrentCartSummary();
  const pricing = await priceCartSummary(cart);

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Harbour & Shelf
        </Link>
        <Link className="cart-link" href="/">
          Keep shopping
        </Link>
      </header>

      <section className="cart-layout" aria-labelledby="cart-title">
        <div>
          <p className="section-kicker">Basket</p>
          <h1 id="cart-title">Your seaside shop basket</h1>
        </div>

        {cart.lines.length === 0 ? (
          <div className="empty-state">
            <h2>Your basket is empty</h2>
            <p>Choose a mug, tote, or tea tin to start an order.</p>
            <Link className="button-link" href="/">
              Browse products
            </Link>
          </div>
        ) : (
          <div className="cart-content">
            <div className="cart-items">
              {cart.lines.map((line) => (
                <article className="cart-row" key={line.productId}>
                  <div>
                    <p className="product-category">{line.sku}</p>
                    <h2>{line.name}</h2>
                    <p>
                      {line.quantity} x {formatPence(line.unitPricePence)}
                    </p>
                  </div>
                  <div className="cart-row-actions">
                    <strong>{formatPence(line.lineTotalPence)}</strong>
                    <div>
                      <form action={decrementCartItemAction}>
                        <input
                          name="productId"
                          type="hidden"
                          value={line.productId}
                        />
                        <button aria-label={`Remove one ${line.name}`} type="submit">
                          -
                        </button>
                      </form>
                      <form action={removeCartItemAction}>
                        <input
                          name="productId"
                          type="hidden"
                          value={line.productId}
                        />
                        <button type="submit">Remove</button>
                      </form>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <aside className="cart-summary" aria-label="Basket summary">
              <div>
                <span>Items</span>
                <strong>{cart.itemCount}</strong>
              </div>
              <div>
                <span>Subtotal</span>
                <strong>{formatPence(pricing.subtotalPence)}</strong>
              </div>
              {pricing.discounts.map((discount) => (
                <div key={discount.ruleId}>
                  <span>{discount.description}</span>
                  <strong>-{formatPence(discount.discountPence)}</strong>
                </div>
              ))}
              <div>
                <span>Total discount</span>
                <strong>-{formatPence(pricing.totalDiscountPence)}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatPence(pricing.finalTotalPence)}</strong>
              </div>
            </aside>
          </div>
        )}
      </section>
    </>
  );
}
