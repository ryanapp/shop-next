import Link from "next/link";
import { notFound } from "next/navigation";
import { addToCartAction } from "../../cart/actions";
import { prisma } from "../../../lib/db";
import { formatPence } from "../../../lib/money";
import { getProductVisual } from "../../../lib/products";

export const dynamic = "force-dynamic";

type ProductPageProps = {
  params: Promise<{
    sku: string;
  }>;
};

export default async function ProductPage({ params }: ProductPageProps) {
  const { sku } = await params;
  const product = await prisma.product.findUnique({
    where: { sku }
  });

  if (!product) {
    notFound();
  }

  const visual = getProductVisual(product.sku);

  return (
    <>
      <header className="site-header">
        <Link className="brand" href="/">
          Harbour & Shelf
        </Link>
        <Link className="cart-link" href="/cart">
          Basket
        </Link>
      </header>

      <article className="product-detail">
        <div className={visual.className}>
          <span>{visual.label}</span>
        </div>
        <div className="product-detail-copy">
          <p className="product-category">{product.category}</p>
          <h1>{product.name}</h1>
          <p>{product.description}</p>
          <div className="buy-panel">
            <strong>{formatPence(product.pricePence)}</strong>
            <form action={addToCartAction}>
              <input name="productId" type="hidden" value={product.id} />
              <input
                name="returnTo"
                type="hidden"
                value={`/products/${product.sku}`}
              />
              <button type="submit">Add to basket</button>
            </form>
          </div>
        </div>
      </article>
    </>
  );
}
