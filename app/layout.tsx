import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Triple Pairs — One main. Two pairs.",
  description: "Create a main coin on Pump.fun, launch its first pair, then pair the pair. Every creation has its own place.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
