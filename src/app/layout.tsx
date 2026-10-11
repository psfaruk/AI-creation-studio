import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও",
  description: "ছবি, অডিও, ভিডিও ও শর্টফিল্ম — এজেন্ট পরিকল্পনা করে টুল চালিয়ে বাস্তবে তৈরি করে দেখায় এমন বাংলা Agentic AI ক্রিয়েটিভ স্টুডিও।",
  keywords: ["Z.ai", "Next.js", "TypeScript", "AI Creative Studio", "Agentic AI", "বাংলা"],
  authors: [{ name: "Z.ai Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও",
    description: "ছবি · অডিও · ভিডিও · ফিল্ম — এক স্টুডিওতে",
    url: "https://chat.z.ai",
    siteName: "Z.ai",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
