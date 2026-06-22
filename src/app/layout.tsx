import type { Metadata } from "next";
import { Geist, Geist_Mono, Russo_One, Chakra_Petch } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const russoOne = Russo_One({
  weight: "400",
  variable: "--font-russo-one",
  subsets: ["latin"],
});

const chakraPetch = Chakra_Petch({
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-chakra-petch",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pickle Point",
  description: "Realtime open play and tournament operations for pickleball Game Masters.",
};

const ALLOWED_THEMES = ["gaming", "blackpink"] as const;
const rawTheme = process.env.THEME || "";
const theme = ALLOWED_THEMES.includes(rawTheme as (typeof ALLOWED_THEMES)[number]) ? rawTheme : "";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={theme ? `theme-${theme}` : ""} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${russoOne.variable} ${chakraPetch.variable} ${geistMono.variable} flex min-h-screen flex-col antialiased`}
      >
        <RootProvider>
          <ConvexClientProvider>
            {children}
            <Toaster />
          </ConvexClientProvider>
        </RootProvider>
      </body>
    </html>
  );
}
