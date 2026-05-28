import type { Metadata, Viewport } from "next";
import { Provider } from "@/components/common/ui/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ICEDR",
  description: "Workspace file drive for ICEDR",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f6" },
    { media: "(prefers-color-scheme: dark)", color: "#010102" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                color-scheme: light dark;
              }

              html, body {
                background: var(--background, #f5f6f6) !important;
                color: var(--foreground, #111217);
              }
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                try {
                  const storedTheme = window.localStorage.getItem("icedr.ui.themeMode");
                  const theme = storedTheme === "dark" || storedTheme === "light"
                    ? storedTheme
                    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                  document.documentElement.dataset.theme = theme;
                  document.documentElement.classList.toggle("dark", theme === "dark");
                  document.documentElement.classList.toggle("light", theme === "light");
                  document.documentElement.style.colorScheme = theme;
                } catch {
                  document.documentElement.dataset.theme = "light";
                  document.documentElement.classList.add("light");
                  document.documentElement.classList.remove("dark");
                  document.documentElement.style.colorScheme = "light";
                }
              })();
            `,
          }}
        />
      </head>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
