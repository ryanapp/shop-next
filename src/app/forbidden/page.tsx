import Link from "next/link";

export default function ForbiddenPage() {
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

      <section className="empty-state">
        <p className="section-kicker">Access blocked</p>
        <h1>Shop manager access is required.</h1>
        <p>Customer accounts can shop, but they cannot open the admin area.</p>
        <Link className="button-link" href="/">
          Return to shop
        </Link>
      </section>
    </>
  );
}
