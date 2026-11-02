import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Agent Atelier — ทีม AI ของคุณ",
  description: "ออฟฟิศส่วนตัวสำหรับทีม AI Agent ที่ทำงานไปด้วยกัน",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
