# AppealFlow build notes

## Product stance

AppealFlow should feel like a civic case desk, not an AI dashboard. The UI uses plain language, paper/ink hierarchy, rule lines, and few choices. Moderators should always know:

1. what needs action,
2. who owns it,
3. what context matters,
4. what action will happen if they click.

## Non-negotiables

- Every appeal has one state.
- Every transition is logged.
- Every resolution requires a mod note.
- Every user gets a clear answer.
- Dashboard and case APIs are moderator-gated through Devvit request context.
- Redis indexes are scoped per subreddit install to prevent cross-community leakage.
- Appeal submission verifies the requester is currently banned before opening a case.

## Verification snapshot — 2026-05-05

- Dependencies installed with `npm install`.
- Devvit CLI available locally: `@devvit/cli/0.12.22`.
- `devvit.json` validates against Reddit's config schema.
- Syntax/import check passes: `npm run check`.
- Unit tests pass: `npm test` — 11/11.
- Production dependency audit passes: `npm audit --omit=dev` — 0 vulnerabilities.
- Full audit has 4 low dev-only findings from Devvit CLI's `inquirer → external-editor → tmp` chain; no fix is currently published upstream.
- UI screenshots captured:
  - `screenshots/appeal-intake.png`
  - `screenshots/mod-dashboard.png`

## Deployment notes

- Registered Reddit Devvit app: https://developers.reddit.com/apps/appealflows
- `src/server/lib/redditAdapter.js` keeps Reddit API calls isolated so platform changes are contained.
- `modmail-sync` has a parser/import path for `/appeal` conversations.
- The dashboard only renders stored live records; it does not invent local cases.
- Release validation should run local checks, Devvit playtest, one banned-user appeal, one mod resolution, and one SLA sweep.
