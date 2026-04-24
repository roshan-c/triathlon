import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { getToken } from "@/lib/auth-server";
import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-display",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "Agile Board",
  description: "Lightweight agile board for student teams"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const token = await getToken();

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${mono.variable} font-body`}>
        <Providers initialToken={token ?? null}>{children}</Providers>
      </body>
    </html>
  );
}
