import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { shapeScoutResponse } from "./db.ts";

Deno.test("shapeScoutResponse exposes stored run diagnostics", async () => {
  let selected = "";
  const db = {
    from(table: string) {
      assertEquals(table, "scout_runs");
      return {
        select(query: string) {
          selected = query;
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              started_at: "2026-05-22T00:00:00Z",
              status: "success",
              stage: "finalize",
              articles_count: 3,
              merged_existing_count: 2,
              sources_scraped: 4,
              sources_failed: 1,
              discovered_from_url: null,
              units_created_count: 3,
              units_merged_count: 2,
              error_class: null,
              notification_status: "sent",
              notification_reason: null,
              notification_provider_id: "email_123",
            },
          });
        },
      };
    },
  };

  const shaped = await shapeScoutResponse(db as never, {
    id: "scout-1",
    name: "Run detail scout",
    type: "beat",
  });

  assertStringIncludes(selected, "sources_scraped");
  assertStringIncludes(selected, "sources_failed");
  assertEquals(shaped.last_run?.sources_scraped, 4);
  assertEquals(shaped.last_run?.sources_failed, 1);
  assertEquals(shaped.last_run?.notification_status, "sent");
  assertEquals(shaped.last_run?.notification_provider_id, "email_123");
});
