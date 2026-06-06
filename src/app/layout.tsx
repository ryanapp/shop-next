import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harbour & Shelf",
  description: "UK seaside demo store with generated discount rules"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <main className="page-shell">{children}</main>
      </body>
    </html>
  );
}
