import { addDays } from './state.js';

export function buildResolutionMessage({ appeal, outcome, moderatorNote, subredditName, settings, now = new Date() }) {
  const note = moderatorNote?.trim() || defaultNoteForOutcome(outcome);
  const user = `u/${appeal.username}`;
  const communityName = subredditName || appeal.subredditName;
  const community = `r/${communityName}`;
  const rulesUrl = `https://www.reddit.com/r/${communityName}/about/rules`;

  if (outcome === 'OVERTURNED') {
    return [
      `Hi ${user},`,
      '',
      `Your appeal for ${community} has been reviewed. The ban has been overturned and you are welcome back.`,
      '',
      `Moderator note: ${note}`,
      '',
      `Before posting again, please reread the community rules: ${rulesUrl}`,
      '',
      'We are glad to have this resolved clearly.',
      '',
      '— AppealFlow',
    ].join('\n');
  }

  if (outcome === 'REDUCED') {
    const days = appeal.resolution?.newBanDurationDays || 'the updated duration';
    return [
      `Hi ${user},`,
      '',
      `Your appeal for ${community} has been reviewed. The ban was not fully overturned, but it has been reduced to ${days} days.`,
      '',
      `Moderator note: ${note}`,
      '',
      'Please use the remaining time to review the community rules so the next interaction is clean.',
      '',
      '— AppealFlow',
    ].join('\n');
  }

  const cooldownDays = settings?.upheldCooldownDays ?? 30;
  const nextEligible = addDays(now, cooldownDays).toLocaleDateString('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    `Hi ${user},`,
    '',
    `Your appeal for ${community} has been reviewed. The ban remains in place.`,
    '',
    `Moderator note: ${note}`,
    '',
    `You may submit another appeal after ${nextEligible}.`,
    '',
    '— AppealFlow',
  ].join('\n');
}

export function defaultNoteForOutcome(outcome) {
  if (outcome === 'OVERTURNED') return 'After review, this ban no longer appears necessary.';
  if (outcome === 'REDUCED') return 'The ban was warranted, but a shorter restriction is enough here.';
  return 'After review, the original moderation decision still stands.';
}

export function buildAssignmentNotice(appeal, reviewer) {
  return [
    `New appeal assigned to u/${reviewer}.`,
    '',
    `Case: ${appeal.id}`,
    `User: u/${appeal.username}`,
    `Rule: ${appeal.intake.rule}`,
    `SLA: ${new Date(appeal.slaDueAt).toLocaleString()}`,
    '',
    'Open the AppealFlow dashboard to review the full context and close the loop.',
  ].join('\n');
}

export function buildSlaReminder(appeal) {
  return [
    `AppealFlow reminder: ${appeal.id} is nearing its response deadline.`,
    '',
    `User: u/${appeal.username}`,
    `Due: ${new Date(appeal.slaDueAt).toLocaleString()}`,
    '',
    'Please review, resolve, or escalate it before the SLA is breached.',
  ].join('\n');
}
