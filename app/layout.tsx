import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OptiAI CRM",
  description: "Revenue Operating System для продаж SEO + GEO на автопилоте"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
