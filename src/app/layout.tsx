import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Urbanist } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const urbanist = Urbanist({ variable: "--font-urbanist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "NEXT A.I", template: "%s · NEXT A.I" },
  description: "Gestão de lojas, equipes e operação de varejo.",
};

export const viewport: Viewport = { themeColor: "#062F28" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${jakarta.variable} ${urbanist.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
