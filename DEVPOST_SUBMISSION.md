# Devpost Submission Draft — AppealFlow

## Project name

AppealFlow

## Tagline

A structured ban appeal desk for Reddit moderators: every appeal gets an owner, a deadline, a decision, and a clear answer.

## App listing

https://developers.reddit.com/apps/appealflows

## Source code

https://github.com/Samfresh-ai/appealflows

## Reddit usernames

u/Numerous-Wrongdoer92

## Category

Best New Mod Tool

## Tool Overview

AppealFlow is a Devvit moderation app that replaces unstructured ban appeals in modmail with a complete case workflow.

A banned user gets a structured appeal intake with five decision-quality prompts: the post/comment involved, the rule they believe applies, what happened, why the decision should be reconsidered, and what they will do differently. Before a case is created, AppealFlow checks eligibility, prevents duplicate open appeals, and enforces cooldowns after upheld decisions.

For moderators, AppealFlow provides a private case desk with live queues, search and filters, SLA status, user-submitted appeal answers, ban context, prior warning/appeal signals, and four clear actions: uphold, reduce, overturn, or escalate. Every decision requires a moderator note so the user receives a plain-language answer instead of a vague or silent close.

Behind the UI, AppealFlow maintains a strict state machine:

`SUBMITTED -> ASSIGNED -> UNDER_REVIEW -> UPHELD | REDUCED | OVERTURNED -> CLOSED`

Open cases can become stale and escalate automatically through scheduled SLA sweeps. The scheduler sends reminders before deadlines, marks overdue cases stale, and escalates unresolved work to the team. The dashboard also exposes analytics: appeal volume, outcome breakdown, SLA compliance, rule distribution, and reviewer handling.

The result is a moderation workflow that is easier to install than a custom bot, more accountable than modmail, and more measurable than ad hoc team memory.

## Project Impact

AppealFlow is useful for communities where bans are frequent, contested, or high-trust: gaming communities, political/news communities, relationship/advice communities, marketplace communities, and large fandom subreddits.

Three likely high-impact community types:

1. **Large gaming or fandom communities** — These communities often see heated threads, repeat rule misunderstandings, and ban appeals that require context. AppealFlow helps mods review appeals faster because the user response, original rule context, and moderation signals are in one place.

2. **Politics, news, and debate communities** — These communities need consistency and defensible process. AppealFlow creates an audit trail for every appeal, which helps teams identify inconsistent enforcement, unclear rules, or overloaded reviewers.

3. **Marketplace, giveaway, or self-promotion-sensitive communities** — These communities deal with spam and edge cases. AppealFlow helps distinguish bad-faith spam from users who misunderstood promotion rules, while preserving cooldowns and prior-appeal history for repeat abuse.

The expected moderator benefit is time saved and fewer dropped appeals. A mod handling appeals manually may spend several minutes reconstructing what happened: finding the ban reason, reading modmail, checking prior warnings, and writing a response. AppealFlow front-loads the user’s explanation, organizes the case, tracks ownership, and provides a forced close loop. On a subreddit handling 50 appeals per month, even saving 5-8 minutes per appeal can recover several moderator-hours monthly while giving users clearer outcomes.

The community benefit is trust. Users may still receive an upheld decision, but they know the appeal was received, reviewed, and answered. Mods gain data about which rules trigger appeals and how often bans are reduced or overturned, which can reveal ambiguous rules or inconsistent enforcement.

## Built with

- Devvit / Reddit Developer Platform
- Devvit Web custom posts
- Hono server routes
- Redis-backed storage
- JavaScript
- Node test runner

## What makes it strong

AppealFlow is not a generic AI triage queue. It focuses on the actual moderation failure mode: appeals are stateful work, but modmail treats them like loose conversations. The app’s value is process reliability: ownership, deadlines, valid state transitions, required notes, notifications, and analytics.

It also avoids risky full automation. Moderators remain the decision-makers. The system automates routing, structure, reminders, escalation, and recordkeeping, while keeping final judgment human.

## Reliability and polish

The app includes:

- Moderator-gated dashboard and action APIs.
- Banned-user eligibility checks before appeal creation.
- Duplicate-open-appeal protection.
- Upheld-decision cooldown enforcement.
- Subreddit-scoped Redis indexes to prevent cross-community leakage.
- Idempotent SLA reminders to avoid spam.
- Failure-tolerant assignment and notification paths.
- A dashboard that only renders real stored records; it does not invent sample appeal data.
- Unit coverage for state transitions, storage scoping, cooldowns, SLA reminders/escalation, modmail import behavior, and notification failure persistence.

Current local validation:

- `npm run check` passes.
- `npm test` passes 14/14.
- `npm run build` passes.
- `npm audit --omit=dev` reports 0 vulnerabilities.
- Devvit config schema validates.

## Original bot username

Not applicable — this is a new Devvit mod tool, not a ported Data API bot.

## Port Completion

Not applicable — this is submitted for the Best New Mod Tool category.

## Developer Platform feedback

Devvit Web is strong for building moderator-facing workflows because it allows a real interface inside Reddit instead of forcing teams to operate in external dashboards. The main area that would help developers is clearer end-to-end examples for production moderation apps that combine custom posts, Redis, scheduler jobs, modmail, mod actions, and app settings in one reference project. Those pieces exist in the docs, but moderation workflow apps often need all of them together.

## Helper nomination

No helper nomination.

## Suggested demo script

1. Show the intake form and explain that it creates one structured appeal record.
2. Show duplicate/cooldown protection.
3. Open the mod dashboard and show search/filter queues.
4. Open a case and show appeal answers beside context.
5. Pick uphold/reduce/overturn/escalate and show the required response note.
6. Explain the SLA scheduler: reminder, stale state, escalation.
7. Show analytics: volume, outcomes, SLA compliance, rules, reviewer handling.
