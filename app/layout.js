import "./globals.css";

export const metadata = {
  title: "Riverside County Sheriff's Office Terminal",
  description: "Internal law-enforcement records terminal",
  icons: {
    icon: "/rcso-logo.png",
    shortcut: "/rcso-logo.png",
    apple: "/rcso-logo.png"
  }
};

export default function RootLayout({ children }) {
  return <html lang="de"><body>{children}</body></html>;
}
