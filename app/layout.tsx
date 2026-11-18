import type { Metadata } from "next";
import "./globals.css";
import "./storefront.css";
import "./operations.css";
import "./reports.css";
import "./order-tracking.css";

export const metadata: Metadata = {
  title: "Wasatch Cycle Works ERP",
  description: "Find your next ride at Wasatch Cycle Works. Shop bikes, check local Utah inventory, and order for pickup.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
