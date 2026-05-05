# AppealFlow

AppealFlow is a Devvit app for turning ban appeals into a tracked moderation workflow.

Today, ban appeals usually land in modmail as loose text threads. There is no required intake shape, no owner, no SLA, no audit trail, and no reliable way for a user or mod team to know whether a case is actually moving. AppealFlow makes appeals first-class cases: structured intake, routed review, deadline enforcement, clear decisions, and a closed loop back to the user.

## What it does

- Gives banned users a structured appeal form with five required decision-quality answers.
- Prevents duplicate open appeals and enforces cooldowns after upheld decisions.
- Verifies that the requester is currently banned before creating a case.
- Routes each case to a reviewer or escalates when no reviewer is available.
- Shows moderators a queue with the appeal, ban context, SLA state, and valid actions.
- Requires a moderator note before any decision is applied.
- Supports uphold, reduce, overturn, and escalate decisions.
- Sends plain-language user notifications after resolution.
- Runs scheduled SLA sweeps for reminders, stale cases, and escalation.
- Keeps analytics for volume, outcomes, SLA compliance, rules, and reviewer handling.

## Workflow model

```text
SUBMITTED
  -> ASSIGNED
  -> UNDER_REVIEW
  -> UPHELD | REDUCED | OVERTURNED
  -> CLOSED

SUBMITTED / ASSIGNED / UNDER_REVIEW
  -> STALE
  -> ESCALATED
```

Every transition is timestamped and stored in the case history. Invalid transitions are rejected by the domain layer, not just hidden in the UI.

## Screenshots

### Appeal intake

![Appeal intake](screenshots/appeal-intake.png)

### Moderator dashboard

![Moderator dashboard](screenshots/mod-dashboard.png)

### Mobile intake

![Mobile appeal intake](screenshots/appeal-intake-mobile.png)

## Architecture

```text
public/
  appeal.html / appeal.js       User-facing appeal intake and status view
  dashboard.html / dashboard.js Moderator queue, detail panel, analytics, settings shell
  styles.css                    Shared UI system

src/shared/
  state.js                      State machine, validation, SLA helpers, cooldown rules
  templates.js                  Mod/user notification copy

src/server/
  index.js                      Hono routes for Devvit Web
  lib/appealService.js          Application workflow orchestration
  lib/storage.js                Redis-backed case storage with subreddit-scoped indexes
  lib/redditAdapter.js          Reddit API boundary for bans, rules, modmail, reviewers, notifications

tests/
  state.test.js                 State, storage, cooldown, SLA, decision, and modmail-sync coverage
```

## API surface

Public Devvit Web endpoints:

- `GET /api/intake` — current user, subreddit rules, and app settings for the intake screen.
- `GET /api/appeals/status?username=...` — existing appeal/cooldown status for the requester.
- `POST /api/appeals` — create a new appeal after eligibility checks.
- `GET /api/dashboard` — moderator dashboard data.
- `GET /api/appeals/:id` — case detail.
- `POST /api/appeals/:id/start-review` — move an assigned case into review.
- `POST /api/appeals/:id/escalate` — escalate with a required note.
- `POST /api/appeals/:id/resolve` — uphold, reduce, or overturn with a required note.

Internal Devvit endpoints:

- `POST /internal/scheduler/sla-sweep`
- `POST /internal/scheduler/modmail-sync`
- `POST /internal/settings/validate-sla-days`
- `POST /internal/settings/validate-cooldown-days`
- `POST /internal/menu/create-intake`
- `POST /internal/menu/open-dashboard`

## Safety and production guards

AppealFlow does not rely on UI hiding for safety.

- Moderator dashboard and case actions are gated through Devvit request context.
- Appeal creation checks the logged-in requester where context is available.
- Appeal creation verifies ban status with Reddit before opening a case.
- Redis indexes are scoped by subreddit to avoid cross-community data leakage.
- Resolution actions require a human-written note.
- SLA reminders are idempotent; a reminder is not spammed repeatedly for the same case.
- The dashboard does not render local sample appeal records when live data is unavailable.
- `.env`, `node_modules`, build output, and old generated screenshots are ignored.

## Install and local checks

```bash
npm install
npm run check
npm test
npm run build
npm audit --omit=dev
```

Expected current result:

- `npm run check` passes.
- `npm test` passes 11 tests.
- `npm run build` produces the Devvit server bundle.
- `npm audit --omit=dev` reports 0 vulnerabilities.

## Devvit workflow

The package uses local Devvit CLI scripts:

```bash
npm run whoami
npm run dev
npm run upload
npm run publish
```

`npm run whoami` must show a logged-in Reddit developer account before playtest, upload, or publish will work.

For a real validation pass:

1. Create or use a small test subreddit that can install private Devvit uploads.
2. Run `npm run dev` and install/playtest the app.
3. Create the intake and dashboard posts from the subreddit menu.
4. Ban a test account and submit an appeal from that account.
5. Confirm duplicate-open-appeal blocking and cooldown behavior.
6. Resolve the case and verify the user notification and ban action.
7. Let the SLA scheduler run or call the scheduler endpoint in playtest to verify reminder/escalation behavior.

## Current honest limit

The code is built and locally validated, but Reddit-hosted production behavior still needs Devvit playtest with an authenticated developer account. That is where Reddit API method behavior, modmail access, ban status reads, and custom-post access for banned users must be proven.

## Why this matters

Good moderation is not just removal speed. It is consistency, accountability, and closure. AppealFlow gives mod teams a process they can measure and gives banned users a clear answer instead of a forgotten thread.

## Official references

- Devvit Web: https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview
- Devvit configuration: https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_configuration
- Custom posts: https://developers.reddit.com/docs/capabilities/creating_custom_post
- Scheduler: https://developers.reddit.com/docs/capabilities/server/scheduler
- Redis: https://developers.reddit.com/docs/capabilities/server/redis
- Reddit API: https://developers.reddit.com/docs/capabilities/server/reddit-api
