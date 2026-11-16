import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wasatch Cycle Works ERP",
  description: "Bike sales, inventory, purchasing, production, and material requirements planning.",
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
