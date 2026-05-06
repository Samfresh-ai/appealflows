# AppealFlow Submission Pack

## Project

**AppealFlow** — a Devvit ban appeal workflow that turns modmail chaos into tracked, accountable moderation cases.

- GitHub: https://github.com/Samfresh-ai/appealflows
- Reddit Devvit app: https://developers.reddit.com/apps/appealflows

## Short description

AppealFlow gives Reddit communities a structured, SLA-backed ban appeal system: intake, routing, moderator review, decision notes, user notification, escalation, and analytics.

## Problem

Ban appeals usually happen in modmail as loose threads. Mods have to reconstruct context manually, appeals can sit unresolved, users do not know what is happening, and teams have no reliable audit trail or data on appeal quality.

## Solution

AppealFlow makes each appeal a first-class case.

1. A banned user submits structured answers.
2. The app verifies eligibility and prevents duplicate open appeals.
3. The case is routed to a reviewer or escalated.
4. Moderators review the appeal beside ban context and prior signals.
5. A moderator chooses uphold, reduce, overturn, or escalate with a required note.
6. The user gets a clear decision.
7. SLA jobs remind, mark stale, and escalate unresolved cases.
8. Analytics expose response time, outcomes, SLA compliance, rule distribution, and reviewer handling.

## Why it matters

AppealFlow saves mod time and improves trust. It reduces repeated context digging, makes appeals measurable, and prevents users from being ghosted after a ban. It also helps moderation teams notice patterns: rules that generate too many appeals, reviewers who are overloaded, and decisions that are frequently overturned.

## What is built

- Devvit Web intake screen
- Moderator dashboard with queue, filters, case detail, analytics, and settings shell
- State machine and transition validation
- Redis-backed storage with subreddit-scoped indexes
- Eligibility, cooldown, and duplicate-open-appeal checks
- SLA reminder/stale/escalation scheduler logic
- Modmail `/appeal` import path
- Human-readable resolution templates
- Unit coverage for state, storage, cooldown, SLA, assignment failures, modmail failures, and notification-failure persistence

## Validation

Current validation commands:

```bash
npm run check
npm test
npm run build
npm audit --omit=dev
```

Current result:

- Syntax checks pass
- Tests pass: 14/14
- Build passes
- Production dependency audit reports 0 vulnerabilities
- Devvit config schema validates
- Devvit CLI auth confirmed for the registered app owner account

## Demo flow

1. Open the AppealFlow intake post.
2. Submit an appeal as a banned test account.
3. Open the moderator dashboard.
4. Filter/search the queue and open the case detail.
5. Review the appeal answers and context package.
6. Choose uphold, reduce, overturn, or escalate.
7. Confirm the required response note.
8. Show the closed case and analytics update.
9. Trigger or describe the SLA sweep for reminders/escalation.

## Suggested submission pitch

Moderation quality depends on closure, not just speed. AppealFlow gives Reddit communities a real appeal desk: every appeal gets structure, an owner, a deadline, a decision, and a record. Mods save time because the context is assembled in one place; users get a clear answer; teams get analytics that reveal where rules or enforcement need improvement.
