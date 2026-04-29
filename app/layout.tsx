import type { Metadata } from "next";
import { UserProvider } from "@/components/UserContext";
import "./globals.css";

/** Default SEO metadata for the application shell. */
export const metadata: Metadata = {
  title: "Arguably - Structured Debate Platform",
  description: "Purpose-built platform for structured debates with real-time moderation, timed turns, and intelligent fact-checking.",
};

/** Root Next.js layout that injects global styles and user role context. */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <UserProvider>
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
