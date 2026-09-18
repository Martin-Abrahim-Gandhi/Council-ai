import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Council",
  description: "An AI advisor for thoughtful reasoning and human-directed action.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
