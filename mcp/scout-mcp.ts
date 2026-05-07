#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * scout-mcp — stdio bridge for the Scoutpost MCP Edge Function.
 *
 * Launched by MCP clients that only speak stdio (Claude Desktop, some
 * Cursor configs, local agent frameworks). Forwards JSON-RPC messages to
 * the deployed HTTP MCP server with the user's cj_… API key.
 *
 * Usage:
 *   scout-mcp                      # read config from ~/.scoutpost/config.json
 *   scout-mcp --version            # print version, exit
 *   scout-mcp --help               # print help, exit
 *
 * Config precedence (per key): env var > ~/.scoutpost/config.json.
 * Accepted env vars:
 *   SCOUTPOST_API_URL (default: https://www.scoutpost.ai/functions/v1)
 *   SCOUTPOST_API_KEY (required)
 *   SCOUTPOST_SUPABASE_ANON_KEY (required when api_url is a Supabase host)
 */

import { loadConfig } from "./lib/config.ts";
import { runBridge } from "./lib/bridge.ts";
import { VERSION } from "./lib/version.ts";

async function main(): Promise<void> {
  const args = Deno.args;

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`scout-mcp ${VERSION}`);
    Deno.exit(0);
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      `scout-mcp ${VERSION} — stdio bridge to the Scoutpost MCP Edge Function

Runs as a subprocess of your MCP client (Claude Desktop, Cursor, …).
The client speaks newline-delimited JSON-RPC on stdin/stdout; this bridge
forwards each request to the configured /mcp-server Edge Function with
your cj_… API key.

Configure with the scout CLI before first use:
  scout config set api_url=https://<project-ref>.supabase.co/functions/v1
  scout config set supabase_anon_key=<public anon key>
  scout config set api_key=cj_<your api key>

Claude Desktop example (~/Library/Application Support/Claude/claude_desktop_config.json):
  {
    "mcpServers": {
      "scoutpost": {
        "command": "scout-mcp"
      }
    }
  }
`,
    );
    Deno.exit(0);
  }

  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    await Deno.stderr.write(
      new TextEncoder().encode(
        `scout-mcp: config error — ${
          e instanceof Error ? e.message : String(e)
        }\n`,
      ),
    );
    Deno.exit(2);
  }

  try {
    await runBridge(cfg, {
      stdin: Deno.stdin.readable,
      stdout: Deno.stdout.writable,
      stderr: Deno.stderr.writable,
      fetch: fetch,
    });
  } catch (e) {
    await Deno.stderr.write(
      new TextEncoder().encode(
        `scout-mcp: fatal — ${e instanceof Error ? e.message : String(e)}\n`,
      ),
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
