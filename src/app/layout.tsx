import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { SplashScreen } from "@/components/splash-screen";
import "./globals.css";

/**
 * Poppins - the geometric, rounded sans most food-delivery apps in this
 * category lean on. `display: swap` because a delivery app is often opened
 * on a weak connection and invisible text is worse than a font swap.
 */
const poppins = Poppins({
  variable: "--font-poppins",
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
  icons: { icon: "/brand/fooddash-mark.png", apple: "/brand/fooddash-mark.png" },
};

export const viewport: Viewport = {
  // No user-scalable:false. Pinch-zoom is the only way some people can read a
  // receipt, and blocking it fails WCAG 1.4.4 for a purely cosmetic gain.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The app is pinned to light mode (data-theme="light" below), so the
  // browser chrome should match rather than follow the OS into dark.
  themeColor: "#FFD9C9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-PH" data-theme="light" suppressHydrationWarning>
      <body className={`${poppins.variable} antialiased`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg focus:font-semibold"
        >
          Skip to content
        </a>
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
