import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";
import { Warmup } from "@/components/perf/Warmup";
import { Analytics } from "@/components/perf/Analytics";

// The SS Innovations typeface. Self-hosted by Next.js, so no request to Google at runtime.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SS Innovations Events",
  description: "Events by SS Innovations: SMRSC, SSi MantraM visits, CME programmes and conferences.",
  applicationName: "SS Innovations Events",
  icons: { icon: "/logos/ssilogo.png", apple: "/logos/ssilogo.png" },
  appleWebApp: { capable: true, title: "SSi Events", statusBarStyle: "default" },
  openGraph: {
    title: "SS Innovations Events",
    description: "Conferences, CME programmes and SSi MantraM visits by SS Innovations.",
    url: "https://events.ssistudios.com",
    siteName: "SS Innovations Events",
    images: [{ url: "/logos/ssii-logo.png", width: 520, height: 227, alt: "SS Innovations" }],
    type: "website",
  },
};

// Edge-to-edge on notched phones; the header and bottom bar pad themselves with safe-area insets.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <RealtimeProvider>{children}<Warmup /><Analytics /></RealtimeProvider>
      </body>
    </html>
  );
}
