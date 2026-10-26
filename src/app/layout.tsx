import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-plex-serif" });

export const metadata: Metadata = {
  title: "Narrative",
  description: "Turn a topic into a finished documentary video",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. ColorZilla's cz-shortcut-listen) add attributes
    // to <html>/<body> before React hydrates. Applies to these two tags only, not their children.
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen md:flex" suppressHydrationWarning>
        <Nav />
        <main className="flex-1 min-w-0 px-4 py-6 md:px-10 md:py-9">{children}</main>
      </body>
    </html>
  );
}
