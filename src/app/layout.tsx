import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REMS | Room workspace",
  description: "A private workspace for our shared room in Kabul.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
