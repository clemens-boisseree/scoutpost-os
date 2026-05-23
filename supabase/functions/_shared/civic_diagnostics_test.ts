import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  allTrackedUrlsAre4xx,
  firecrawlUpstreamStatus,
} from "./civic_diagnostics.ts";

Deno.test("firecrawlUpstreamStatus extracts wrapped provider 4xx", () => {
  assertEquals(
    firecrawlUpstreamStatus(
      new Error("firecrawl change-tracking failed: 404 not found"),
    ),
    404,
  );
  assertEquals(
    firecrawlUpstreamStatus(new Error("firecrawl scrape failed: 410 gone")),
    410,
  );
});

Deno.test("allTrackedUrlsAre4xx requires every tracked URL to fail with 4xx", () => {
  assertEquals(
    allTrackedUrlsAre4xx([
      {
        url: "https://city.example/a",
        status: "scrape_failed",
        upstream_status: 404,
      },
      {
        url: "https://city.example/b",
        status: "scrape_failed",
        upstream_status: 410,
      },
    ], 2),
    true,
  );
  assertEquals(
    allTrackedUrlsAre4xx([
      {
        url: "https://city.example/a",
        status: "scrape_failed",
        upstream_status: 404,
      },
      { url: "https://city.example/b", status: "scraped" },
    ], 2),
    false,
  );
});
