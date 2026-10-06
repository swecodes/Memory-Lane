import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Memory Lane",
  description: "Search and chat with your photo library",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Loaded by the browser at runtime (not at build time), so builds work offline;
            without network the system font stack takes over. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&display=swap"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
