export type CivicTrackedUrlState =
  | "unsupported"
  | "scraped"
  | "scrape_failed"
  | "unchanged"
  | "queued"
  | "already_seen"
  | "no_new_documents";

export interface CivicTrackedUrlStatus {
  url: string;
  status: CivicTrackedUrlState;
  change_status?: string | null;
  upstream_status?: number | null;
  queued_documents?: number;
  error?: string | null;
}

export function firecrawlUpstreamStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/firecrawl [^:]+ failed:\s*(\d{3})\b/i) ??
    message.match(/\bstatus[=:\s]+(\d{3})\b/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export function allTrackedUrlsAre4xx(
  statuses: CivicTrackedUrlStatus[],
  trackedCount: number,
): boolean {
  return trackedCount > 0 && statuses.length === trackedCount &&
    statuses.every((entry) =>
      entry.status === "scrape_failed" &&
      typeof entry.upstream_status === "number" &&
      entry.upstream_status >= 400 &&
      entry.upstream_status < 500
    );
}
