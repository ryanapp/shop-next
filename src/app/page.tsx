import Link from "next/link";
import { addToCartAction } from "./cart/actions";
import { prisma } from "../lib/db";
import { getCurrentCartSummary } from "../lib/cart-store";
import { formatPence } from "../lib/money";
import { getProductVisual } from "../lib/products";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <Storefront />;
}

async function Storefront() {
  const [products, cart] = await Promise.all([
    prisma.product.findMany({ orderBy: { sku: "asc" } }),
    getCurrentCartSummary()
  ]);

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Harbour & Shelf
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <Link href="/admin">Admin</Link>
          <Link className="cart-link" href="/cart">
            Basket <span>{cart.itemCount}</span>
          </Link>
        </nav>
      </header>

      <section className="shop-intro" aria-labelledby="storefront-title">
        <div>
          <p className="section-kicker">Seaside provisions</p>
          <h1 id="storefront-title">Harbour goods for slow coastal days.</h1>
        </div>
        <p>
          Practical favourites from a small UK seaside shop, priced in pounds
          for display and pence in the cart.
        </p>
      </section>

      {products.length === 0 ? (
        <section className="empty-state">
          <h2>No products yet</h2>
          <p>Run the seed script to stock the shop.</p>
        </section>
      ) : (
        <section className="product-grid" aria-label="Products">
          {products.map((product) => {
            const visual = getProductVisual(product.sku);

            return (
              <article className="product-card" key={product.id}>
                <Link
                  aria-label={`View ${product.name}`}
                  className={visual.className}
                  href={`/products/${product.sku}`}
                >
                  <span>{visual.label}</span>
                </Link>
                <div className="product-card-body">
                  <div>
                    <p className="product-category">{product.category}</p>
                    <h2>
                      <Link href={`/products/${product.sku}`}>
                        {product.name}
                      </Link>
                    </h2>
                  </div>
                  <p>{product.description}</p>
                  <div className="product-card-footer">
                    <strong>{formatPence(product.pricePence)}</strong>
                    <form action={addToCartAction}>
                      <input name="productId" type="hidden" value={product.id} />
                      <input name="returnTo" type="hidden" value="/" />
                      <button type="submit">Add</button>
                    </form>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
