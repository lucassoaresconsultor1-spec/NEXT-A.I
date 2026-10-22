import type { Metadata } from "next";

export const metadata: Metadata = { title: "Fila da loja" };

// Shared entrance tablet (m13b): no app shell, no management screens.
export default function TabletLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <main id="conteudo" className="mx-auto max-w-5xl p-4 sm:p-6">
        {children}
      </main>
    </div>
  );
}
