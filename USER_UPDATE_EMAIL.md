Subject: coJournalist is now Scoutpost

Hi,

coJournalist is now Scoutpost - [{{APP_URL}}]({{APP_URL}}).

The old name was getting in the way. It made the tool sound like it was only for journalists, it isn't. Scoutpost is for local newsrooms, researchers, investigators, watchdogs, and anyone who needs to track changes on the open web.

Honestly, the last two weeks were tough. The product has been buggier than it should have been. The backend migration was larger than expected, and rough edges showed up in the app. I've been head-down on fixes since.

The migration is now complete, and Scoutpost should be much more stable from here.

## What's new

- Support for Claude and Codex desktop apps is live with improved MCP. Your agent can spin up Scouts, pull findings, and route what matters into your workflow without leaving the app.
- The backend has been fully migrated to the new architecture.
- Page monitoring is significantly hardened. On complex news and municipal websites, Scouts now follow subpages instead of only reading list-page titles and descriptions, so they extract the full article, agenda, notice, or document.
- Civic Scouts, Beat Scouts, and Social Scouts have all been hardened.
- The inbox now has better records for verification, rejection, and article-use tracking.
- The public REST API, `scout` CLI, and remote MCP setup are available for agent workflows.
- MuckRock sign-in, team credit handling, and email notifications are more reliable.

I've also started onboarding local newsrooms running Scoutpost in their own environments via the Docker setup. Hosted and self-hosted are both first-class deployment paths.

## What you need to do

- Use [{{APP_URL}}]({{APP_URL}}) for sign-in going forward.
- Existing accounts, Scouts, credits, and inbox records carry over.
- Existing links on {{OLD_APP_URL}} will redirect after the migration window.

## Feedback

Any feedback is appreciated. If something is still broken, confusing, slow, or not useful enough, reply to this email, contact {{SUPPORT_EMAIL}}, or use the feedback button in the UI for ideas and bug reports.

Specific examples are the most useful: Scout name, URL, location, search topic, or what you expected to happen.

Thanks for the patience, and for the pressure to make this better.

Tom
