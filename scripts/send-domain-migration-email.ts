/**
 * Manual Scoutpost domain migration announcement sender.
 *
 * Dry-run by default. To send real email, set:
 *
 *   CONFIRM_SEND=scoutpost-domain-migration
 *
 * Usage:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   MUCKROCK_CLIENT_ID=... MUCKROCK_CLIENT_SECRET=... RESEND_API_KEY=... \
 *   deno run --allow-env --allow-net --allow-read \
 *     scripts/send-domain-migration-email.ts --template USER_UPDATE_EMAIL.md
 *
 * Test to a single address:
 *
 *   CONFIRM_SEND=scoutpost-domain-migration RESEND_API_KEY=... \
 *   deno run --allow-env --allow-net --allow-read \
 *     scripts/send-domain-migration-email.ts --to you@example.com
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  escapeHtml,
  markdownToHtml,
} from "../supabase/functions/_shared/notifications.ts";
import { MuckrockClient } from "../supabase/functions/_shared/muckrock.ts";

const RESEND_URL = "https://api.resend.com/emails";
const CONFIRM_VALUE = "scoutpost-domain-migration";
const DEFAULT_TEMPLATE = "USER_UPDATE_EMAIL.md";
const DEFAULT_FROM = "Scoutpost <updates@scoutpost.ai>";
const DEFAULT_REPLY_TO = "updates@scoutpost.ai";
const DEFAULT_SUBJECT = "coJournalist is now Scoutpost";
const DEFAULT_PER_PAGE = 100;

const EMAIL_COLORS = {
  bg: "#F6F1E8",
  surface: "#FFFDF9",
  surfaceSoft: "#F7FBFF",
  ink: "#1F1A17",
  inkMuted: "#4B433B",
  inkSubtle: "#5A5148",
  border: "#D5C7B6",
  borderStrong: "#AB9986",
  accent: "#3F5EA6",
} as const;

const FONT_DISPLAY = "Georgia, 'Times New Roman', serif";
const FONT_BODY = "Arial, Helvetica, sans-serif";
const FONT_MONO = "'Courier New', Courier, monospace";

interface Args {
  templatePath: string;
  to?: string;
  limit?: number;
  resumeFrom?: string;
  perPage: number;
}

interface Recipient {
  userId: string;
  email: string;
  source: "manual" | "muckrock";
}

interface Template {
  subject: string;
  text: string;
  html: string;
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  deno run --allow-env --allow-net --allow-read scripts/send-domain-migration-email.ts [options]",
      "",
      "Options:",
      "  --template <path>     Markdown template path. Default: USER_UPDATE_EMAIL.md",
      "  --to <email>          Send or dry-run a single test recipient.",
      "  --limit <n>           Stop after n resolved recipients.",
      "  --resume-from <uuid>  Skip users until this Supabase/MuckRock UUID, then continue after it.",
      "  --per-page <n>        Supabase auth users page size. Default: 100",
      "  -h, --help           Show this help.",
      "",
      `Real sends require CONFIRM_SEND=${CONFIRM_VALUE}.`,
    ].join("\n"),
  );
  Deno.exit(1);
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

function parseArgs(args: string[]): Args {
  const parsed: Args = {
    templatePath: DEFAULT_TEMPLATE,
    perPage: DEFAULT_PER_PAGE,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--template") {
      parsed.templatePath = args[++i] ?? usage();
    } else if (arg === "--to") {
      parsed.to = args[++i] ?? usage();
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveInt(args[++i], "--limit");
    } else if (arg === "--resume-from") {
      parsed.resumeFrom = args[++i] ?? usage();
    } else if (arg === "--per-page") {
      parsed.perPage = parsePositiveInt(args[++i], "--per-page");
    } else if (arg === "-h" || arg === "--help") {
      usage();
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (parsed.to && parsed.resumeFrom) {
    throw new Error("--to and --resume-from cannot be combined");
  }
  if (parsed.to && parsed.limit) {
    throw new Error("--to and --limit cannot be combined");
  }
  return parsed;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  const value = Deno.env.get(name)?.trim();
  return value || fallback;
}

function sendConfirmed(): boolean {
  return Deno.env.get("CONFIRM_SEND") === CONFIRM_VALUE;
}

function applyTemplateVars(markdown: string): string {
  const vars: Record<string, string> = {
    APP_URL: optionalEnv("SCOUTPOST_APP_URL", "https://www.scoutpost.ai"),
    OLD_APP_URL: optionalEnv(
      "SCOUTPOST_OLD_APP_URL",
      "https://www.cojournalist.ai",
    ),
    SUPPORT_EMAIL: optionalEnv("SCOUTPOST_SUPPORT_EMAIL", DEFAULT_REPLY_TO),
  };
  return markdown.replace(
    /\{\{([A-Z0-9_]+)\}\}/g,
    (_match, key: string) => vars[key] ?? "",
  );
}

function parseTemplate(raw: string): Template {
  const normalized = applyTemplateVars(raw.replace(/\r\n/g, "\n")).trim();
  const lines = normalized.split("\n");
  let subject = DEFAULT_SUBJECT;
  if (lines[0]?.toLowerCase().startsWith("subject:")) {
    subject = lines.shift()?.replace(/^subject:\s*/i, "").trim() ||
      DEFAULT_SUBJECT;
  }
  const text = lines.join("\n").trim();
  const html = renderAnnouncementHtml(subject, text);
  return { subject, text, html };
}

function renderAnnouncementHtml(subject: string, text: string): string {
  const bodyHtml = markdownToHtml(text, EMAIL_COLORS.accent);
  const appUrl = escapeHtml(
    optionalEnv("SCOUTPOST_APP_URL", "https://www.scoutpost.ai"),
  );
  const supportEmail = escapeHtml(
    optionalEnv("SCOUTPOST_SUPPORT_EMAIL", DEFAULT_REPLY_TO),
  );
  const preheader =
    "The backend migration is complete, Scoutpost is live, and the app should be much more stable from here.";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light only; supported-color-schemes: light only; }
    body, table, td, div, p, a { font-family: ${FONT_BODY}; }
    @media screen and (max-width: 600px) {
      .outer-cell { padding: 16px 10px !important; }
      .header-cell { padding: 22px 20px 18px 20px !important; }
      .body-cell { padding: 20px !important; }
      .email-title { font-size: 28px !important; line-height: 1.12 !important; }
      .summary-cell { padding: 16px !important; }
    }
  </style>
</head>
<body bgcolor="${EMAIL_COLORS.bg}" style="margin: 0; padding: 0; background: ${EMAIL_COLORS.bg}; color: ${EMAIL_COLORS.ink}; font-family: ${FONT_BODY}; line-height: 1.6;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent; mso-hide: all;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${EMAIL_COLORS.bg}" style="width: 100%; background: ${EMAIL_COLORS.bg};">
    <tr>
      <td class="outer-cell" align="center" bgcolor="${EMAIL_COLORS.bg}" style="padding: 24px 16px; background: ${EMAIL_COLORS.bg};">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${EMAIL_COLORS.surface}" style="width: 100%; max-width: 640px; background: ${EMAIL_COLORS.surface}; border: 1px solid ${EMAIL_COLORS.borderStrong};">
          <tr>
            <td class="header-cell" bgcolor="${EMAIL_COLORS.surface}" style="padding: 24px 24px 20px 24px; border-bottom: 1px solid ${EMAIL_COLORS.border}; background: ${EMAIL_COLORS.surface};">
              <div style="margin-bottom: 14px; font-family: ${FONT_MONO}; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: ${EMAIL_COLORS.accent};">
                SCOUTPOST UPDATE <span style="color: ${EMAIL_COLORS.inkSubtle};">/ FORMERLY COJOURNALIST</span>
              </div>
              <h1 class="email-title" style="margin: 0; font-family: ${FONT_DISPLAY}; font-size: 34px; line-height: 1.1; font-weight: 700; color: ${EMAIL_COLORS.ink};">
                ${escapeHtml(subject)}
              </h1>
              <p style="margin: 10px 0 0 0; font-family: ${FONT_BODY}; font-size: 16px; line-height: 1.5; color: ${EMAIL_COLORS.inkMuted};">
                Backend migration complete. New domain: <a href="${appUrl}" style="color: ${EMAIL_COLORS.accent}; text-decoration: none;">${appUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td class="body-cell" bgcolor="${EMAIL_COLORS.surface}" style="padding: 24px; background: ${EMAIL_COLORS.surface};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${EMAIL_COLORS.surfaceSoft}" style="width: 100%; background: ${EMAIL_COLORS.surfaceSoft}; border: 1px solid ${EMAIL_COLORS.border}; border-left: 3px solid ${EMAIL_COLORS.accent};">
                <tr>
                  <td class="summary-cell" bgcolor="${EMAIL_COLORS.surfaceSoft}" style="padding: 18px 18px 16px 18px; background: ${EMAIL_COLORS.surfaceSoft}; color: ${EMAIL_COLORS.ink};">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid ${EMAIL_COLORS.border}; text-align: center; font-size: 11px; color: ${EMAIL_COLORS.inkSubtle}; line-height: 1.5; font-family: ${FONT_BODY};">
                Scoutpost, formerly coJournalist. Reply to this email or contact
                <a href="mailto:${supportEmail}" style="color: ${EMAIL_COLORS.accent}; text-decoration: none;">${supportEmail}</a>.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const prefix = local.length <= 2 ? local[0] ?? "*" : local.slice(0, 2);
  return `${prefix}***@${domain}`;
}

async function* listUserIds(args: Args): AsyncGenerator<string> {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_KEY");
  if (!serviceRoleKey) {
    throw new Error(
      "missing env SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY",
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let page = 1;
  let yielded = 0;
  let pastResume = !args.resumeFrom;
  let sawResume = !args.resumeFrom;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: args.perPage,
    });
    if (error) {
      throw new Error(`listUsers page ${page} failed: ${error.message}`);
    }

    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      const userId = user.id;
      if (!userId) continue;
      if (!pastResume) {
        if (userId === args.resumeFrom) {
          pastResume = true;
          sawResume = true;
        }
        continue;
      }
      yield userId;
      yielded += 1;
      if (args.limit && yielded >= args.limit) return;
    }

    const total = typeof data.total === "number" ? data.total : undefined;
    if (
      users.length < args.perPage || (total && page * args.perPage >= total)
    ) break;
    page += 1;
  }

  if (!sawResume && args.resumeFrom) {
    console.error(`[warn] resume id not found: ${args.resumeFrom}`);
  }
}

async function resolveRecipients(args: Args): Promise<Recipient[]> {
  if (args.to) {
    return [{ userId: "manual-test", email: args.to, source: "manual" }];
  }

  const client = new MuckrockClient();
  const recipients: Recipient[] = [];
  for await (const userId of listUserIds(args)) {
    try {
      const user = await client.fetchUserData(userId);
      const email = user.email?.trim();
      if (!email) {
        console.error(`[skip] ${userId}: MuckRock returned no email`);
        continue;
      }
      recipients.push({ userId, email, source: "muckrock" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skip] ${userId}: MuckRock lookup failed: ${message}`);
    }
  }
  return recipients;
}

async function sendEmail(
  recipient: Recipient,
  template: Template,
): Promise<void> {
  const resendKey = requiredEnv("RESEND_API_KEY");
  const from = optionalEnv("RESEND_ANNOUNCEMENT_FROM", DEFAULT_FROM);
  const replyTo = optionalEnv("RESEND_ANNOUNCEMENT_REPLY_TO", DEFAULT_REPLY_TO);
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [recipient.email],
      subject: template.subject,
      text: template.text,
      html: template.html,
      reply_to: replyTo,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}: ${detail.slice(0, 500)}`);
  }
  await response.body?.cancel();
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const template = parseTemplate(await Deno.readTextFile(args.templatePath));
  const confirmed = sendConfirmed();
  const recipients = await resolveRecipients(args);

  console.log(`subject: ${template.subject}`);
  console.log(`mode: ${confirmed ? "SEND" : "DRY-RUN"}`);
  console.log(`recipients: ${recipients.length}`);

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const label = `${recipient.userId} ${
      maskEmail(recipient.email)
    } (${recipient.source})`;
    if (!confirmed) {
      console.log(`[dry-run] ${label}`);
      continue;
    }
    try {
      await sendEmail(recipient, template);
      sent += 1;
      console.log(`[sent] ${label}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[failed] ${label}: ${message}`);
    }
  }

  console.log(
    `done: sent=${sent} failed=${failed} dry_run=${
      confirmed ? 0 : recipients.length
    }`,
  );
  if (failed > 0) Deno.exit(1);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
