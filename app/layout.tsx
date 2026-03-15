import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans"
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "600", "700"]
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono"
});

export const metadata: Metadata = {
  title: "Scout Map",
  description: "Map-first Melbourne route planner with chat-driven itinerary building."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${sourceSerif.variable} ${jetBrainsMono.variable}`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
