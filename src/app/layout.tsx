import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

/**
 * Plus Jakarta Sans is a geometric sans in the same family of shapes as the
 * logo wordmark, so headings sit next to the mark without a visible seam.
 * `display: swap` because a delivery app is often opened on a weak connection
 * and invisible text is worse than a font swap.
 */
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: {
    default: "FoodDash — Where Food Finds You.",
    template: "%s · FoodDash",
  },
  description:
    "Order from the local kitchens near you. FoodDash delivers from neighbourhood carinderias, cafés and family restaurants.",
  applicationName: "FoodDash",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FoodDash", statusBarStyle: "default" },
  icons: { icon: "/brand/fooddash-mark.svg", apple: "/brand/fooddash-mark.svg" },
};

export const viewport: Viewport = {
  // No user-scalable:false. Pinch-zoom is the only way some people can read a
  // receipt, and blocking it fails WCAG 1.4.4 for a purely cosmetic gain.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFD9C9" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH" suppressHydrationWarning>
      <body className={`${jakarta.variable} antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg focus:font-semibold"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
