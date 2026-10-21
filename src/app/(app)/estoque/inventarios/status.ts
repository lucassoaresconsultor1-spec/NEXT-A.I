import type { CountStatus } from "@/server/inventory/count-schemas";

export const STATUS_TONES: Record<CountStatus, "attention" | "positive" | "neutral"> = {
  open: "attention",
  approved: "positive",
  cancelled: "neutral",
};
