# AppealFlow

A senior-level Reddit Mod Tools hackathon build: a humane, stateful ban appeal workflow built for Devvit.

AppealFlow turns ban appeals from loose modmail threads into tracked cases:

`SUBMITTED → ASSIGNED → UNDER_REVIEW → UPHELD | REDUCED | OVERTURNED → CLOSED`

with escalation, SLA reminders, structured mod decisions, plain-language user responses, and an audit trail.

## What is built in this scaffold

- Static Devvit Web custom post UI:
  - `public/appeal.html` — appeal intake entry point
  - `public/dashboard.html` — moderator case dashboard
- Server/API shape:
  - appeal creation
  - queue listing
  - case detail
  - state transitions
  - SLA sweep
  - modmail sync placeholder
  - menu actions to create intake/dashboard posts
- Safety and production guards:
  - moderator-only dashboard/action APIs
  - requester self-submit check where Devvit user context is available
  - live banned-user eligibility check via `getBannedUsers`
  - subreddit-scoped Redis indexes
  - patched `protobufjs` override for the Devvit dependency-chain advisory
- Core domain logic:
  - state machine validation
  - appeal schema
  - SLA status
  - resolution templates
  - Redis-compatible storage abstraction
- Human-friendly UI language and restrained Civic Casefile design.

## Important implementation stance

Banned-user access to a Devvit custom post is not assumed. AppealFlow supports the custom-post form, but the production path must also support modmail-driven intake.

The app should tell banned users:

> Reply to this ban message with `/appeal` and answer the three questions below.

The scheduler can sync those modmail conversations and create structured appeal records.

## Commands

Use the local Devvit CLI installed in this package:

```bash
cd appealflow
npm install
npm run check
npm test
npm run whoami
DEVVIT_SUBREDDIT=your_small_test_sub npm run dev
npm run upload
```

`npm run whoami` must succeed before playtest/upload/publish can work.

## MVP path

1. Log in with Devvit: `npm run whoami` should show the Reddit developer account.
2. Playtest on a small subreddit: `DEVVIT_SUBREDDIT=your_small_test_sub npm run dev`.
3. Create the intake and dashboard posts from the subreddit menu.
4. Submit a real appeal from a banned test account and confirm it routes to a mod.
5. Resolve the case and verify the user notification, ban action, SLA state, and dashboard analytics.
6. Upload/publish only after the live Reddit API paths are proven in playtest logs.

## Official docs used

- Devvit Web overview: https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview
- Devvit config: https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_configuration
- Custom posts: https://developers.reddit.com/docs/capabilities/creating_custom_post
- Forms: https://developers.reddit.com/docs/capabilities/client/forms
- Scheduler: https://developers.reddit.com/docs/capabilities/server/scheduler
- Redis: https://developers.reddit.com/docs/capabilities/server/redis
- Reddit API: https://developers.reddit.com/docs/capabilities/server/reddit-api
- ModMailService: https://developers.reddit.com/docs/api/redditapi/models/classes/ModMailService
