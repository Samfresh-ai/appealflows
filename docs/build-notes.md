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
- Banned-user custom post access is treated as unproven until playtested.
- Dashboard and case APIs are moderator-gated through Devvit request context.
- Redis indexes are scoped per subreddit install to prevent cross-community leakage.
- Appeal submission verifies the requester is currently banned before opening a case.

## Verification snapshot — 2026-05-05

- Dependencies installed with `npm install`.
- Devvit CLI available locally: `@devvit/cli/0.12.22`.
- `devvit.json` validates against Reddit's config schema.
- Syntax/import check passes: `npm run check`.
- Unit tests pass: `npm test` — 6/6.
- Production dependency audit passes: `npm audit --omit=dev` — 0 vulnerabilities.
- Full audit has 4 low dev-only findings from Devvit CLI's `inquirer → external-editor → tmp` chain; no fix is currently published upstream.
- UI screenshots captured:
  - `screenshots/appeal-intake.png`
  - `screenshots/mod-dashboard.png`

## Live-gated limitations

- `src/server/lib/redditAdapter.js` isolates live Devvit calls that still need real subreddit playtest verification.
- `modmail-sync` is a placeholder until the exact ModMail query shape is validated.
- The dashboard does not show placeholder appeal records. It stays empty when live Devvit data is unavailable.
- Upload/playtest/publish are blocked until the Devvit CLI is authenticated with the app owner's Reddit account.
