import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "aiweb chat",
  description: "Talk to Claude",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer
          style={{
            marginTop: "2rem",
            padding: "1rem",
            borderTop: "1px solid #eee",
            fontSize: "0.85rem",
            textAlign: "center",
            color: "#666",
          }}
        >
          <a href="/tos">Terms of Service</a>
          {" · "}
          <a href="/privacy">Privacy Policy</a>
        </footer>
      </body>
    </html>
  );
}
