import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LLM Client",
  description: "Custom ChatGPT-style LLM client (test mode)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        suppressHydrationWarning
        className={`
          ${geistSans.variable}
          ${geistMono.variable}
          antialiased
          bg-[#050509]
          text-zinc-100
        `}
      >
        {children}
      </body>
    </html>
  );
}
