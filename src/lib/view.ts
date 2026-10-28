// Small display rules for the posts list.

const LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  publishing: "Publishing",
  processing: "Processing",
  published: "Published",
  partial: "Partly published",
  failed: "Failed",
  pending: "Pending",
  pending_approval: "Waiting for approval",
  rejected: "Rejected",
}

export function statusLabel(status: string): string {
  return LABELS[status] ?? status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
}

/** A post whose failed destinations can be sent again. */
export function canRetry(status: string): boolean {
  return status === "failed" || status === "partial"
}
