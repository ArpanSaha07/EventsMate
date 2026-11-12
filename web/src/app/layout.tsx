import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/shell/AppHeader";
import { PersonaProvider } from "@/components/shell/PersonaProvider";
import { Toaster } from "@/components/ui/sonner";
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
  title: "EventsMate",
  description:
    "An AI agent that fills empty seats at sold-out events, with PayPal holds, refunds and ticket transfers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <PersonaProvider>
          <AppHeader />
          <div className="flex flex-1 flex-col">{children}</div>
          <Toaster position="top-center" />
        </PersonaProvider>
      </body>
    </html>
  );
}
