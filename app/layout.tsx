import "react-diff-view/style/index.css";
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
    <html lang="th" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: `try { var theme = localStorage.getItem("agent-atelier-theme"); if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme; var palette = localStorage.getItem("agent-atelier-palette"); if (palette === "green") document.documentElement.dataset.palette = palette; } catch {}` }} />
        {children}
      </body>
    </html>
  );
}
