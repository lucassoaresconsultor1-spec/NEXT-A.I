import { generateReportAction } from "@/app/(app)/relatorios/actions";
import NewReportForm from "./form";

export default function NewReportPage() {
  return <NewReportForm action={generateReportAction} />;
}
