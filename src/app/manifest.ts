import type { MetadataRoute } from "next";

// Static, public web app manifest (served at /manifest.webmanifest). It makes the
// app installable only: no service worker or offline cache yet (ADR-006, m15).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "NEXT A.I",
    short_name: "NEXT A.I",
    description: "Gestão de lojas, equipes e operação de varejo.",
    lang: "pt-BR",
    dir: "ltr",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#062F28",
    theme_color: "#062F28",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
