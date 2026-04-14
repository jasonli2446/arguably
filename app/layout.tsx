import type { Metadata } from "next";
import AuthSync from "@/components/AuthSync";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arguably - Structured Debate Platform",
  description: "Purpose-built platform for structured debates with real-time moderation, timed turns, and intelligent fact-checking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthSync />
        {children}
      </body>
    </html>
  );
}
