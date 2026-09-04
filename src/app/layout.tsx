import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { getToken } from "@/lib/auth-server";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "Triathlon",
  description: "Lightweight sprint board for small teams"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const token = await getToken();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("tri-theme");var d=t||(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.classList.toggle("dark",d==="dark");document.documentElement.classList.toggle("light",d==="light");if(!t){localStorage.setItem("tri-theme",d)}}catch(e){}`
          }}
        />
      </head>
      <body className={`${geist.variable} ${geistMono.variable}`}>
        <Providers initialToken={token ?? null}>{children}</Providers>
      </body>
    </html>
  );
}