"use client";

import { useEffect } from "react";
import { useFormAction } from "@/components/ui/use-form-action";
import { downloadReportAction } from "@/app/(app)/relatorios/actions";
import type { ActionState } from "@/lib/action-state";
import { FileText } from "lucide-react";

interface DownloadReportState extends ActionState {
  fileName?: string;
  content?: string;
}

interface DownloadReportButtonProps { runId: string; status: string }

export function DownloadReportButton({ runId, status }: DownloadReportButtonProps) {
  const [state, formAction] = useFormAction(downloadReportAction as unknown as (state: DownloadReportState, formData: FormData) => Promise<DownloadReportState>);

  useEffect(() => {
    const result = state as DownloadReportState;
    if (result.status !== "success" || !result.fileName || !result.content) return;
    const url = URL.createObjectURL(new Blob([result.content], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = result.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [state]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={runId} />
      {status === "done" ? (
        <button type="submit" className="rounded-full border border-brand bg-brand text-white px-2 py-1 text-xs font-medium hover:bg-brand-strong"><FileText className="size-3" aria-hidden /> Baixar CSV</button>
      ) : (
        <button className="rounded-full border border-line-strong bg-surface text-ink-soft px-2 py-1 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed" disabled>Indisponível</button>
      )}
    </form>
  );
}
