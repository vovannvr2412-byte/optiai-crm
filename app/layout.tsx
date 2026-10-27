import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OptiAI Operations OS",
  description: "Единое рабочее пространство продаж, клиентов, контента и операционных процессов"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
