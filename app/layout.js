import "./globals.css";

export const metadata = {
  title: "Riverside County Sheriff's Office Terminal",
  description: "Internal law-enforcement records terminal"
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
