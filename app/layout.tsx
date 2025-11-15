import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Client",
  description: "Custom ChatGPT-style LLM client (test mode)",
};

const baseBodyClass = [
  "antialiased",
  "bg-[#050509]",
  "text-zinc-100",
  "min-h-screen",
].join(" ");

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={baseBodyClass}>
        {children}
      </body>
    </html>
  );
}
