export const AppealState = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  ASSIGNED: 'ASSIGNED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ESCALATED: 'ESCALATED',
  STALE: 'STALE',
  UPHELD: 'UPHELD',
  REDUCED: 'REDUCED',
  OVERTURNED: 'OVERTURNED',
  CLOSED: 'CLOSED',
});

export const AppealOutcome = Object.freeze({
  UPHELD: 'UPHELD',
  REDUCED: 'REDUCED',
  OVERTURNED: 'OVERTURNED',
});

export const VALID_TRANSITIONS = Object.freeze({
  SUBMITTED: ['ASSIGNED', 'ESCALATED', 'CLOSED'],
  ASSIGNED: ['UNDER_REVIEW', 'ESCALATED', 'STALE', 'CLOSED'],
  UNDER_REVIEW: ['UPHELD', 'REDUCED', 'OVERTURNED', 'ESCALATED'],
  ESCALATED: ['ASSIGNED', 'UNDER_REVIEW', 'STALE', 'CLOSED'],
  STALE: ['ESCALATED', 'ASSIGNED', 'UNDER_REVIEW', 'CLOSED'],
  UPHELD: ['CLOSED'],
  REDUCED: ['CLOSED'],
  OVERTURNED: ['CLOSED'],
  CLOSED: [],
});

export const DEFAULT_SETTINGS = Object.freeze({
  slaDays: 7,
  upheldCooldownDays: 30,
  escalationAfterHours: 48,
  reminderHoursBeforeSla: 24,
  reviewerPermissions: ['all', 'mail'],
  welcomeMessage: 'Appeals are reviewed by real moderators. Be specific, honest, and concise.',
  allowedBanTypes: ['temporary', 'permanent'],
  intakeMode: 'custom-post-and-modmail',
});

export const MODERATOR_PERMISSIONS = Object.freeze([
  'all',
  'mail',
  'access',
  'posts',
  'config',
  'wiki',
  'flair',
  'chat_operator',
  'chat_config',
  'channels',
  'community_chat',
]);

export function createAppealId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AF-${stamp}-${suffix}`;
}

export function assertValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid appeal transition: ${from} → ${to}`);
  }
}

export function transitionAppeal(appeal, nextState, actor, note = '', now = new Date()) {
  assertValidTransition(appeal.state, nextState);
  const timestamp = now.toISOString();
  const historyEntry = {
    from: appeal.state,
    to: nextState,
    actor: actor || 'system',
    note: normalizeWhitespace(note),
    at: timestamp,
  };

  return {
    ...appeal,
    state: nextState,
    updatedAt: timestamp,
    history: [...(appeal.history || []), historyEntry],
  };
}

export function createAppealRecord(input, settings = DEFAULT_SETTINGS, now = new Date()) {
  const createdAt = now.toISOString();
  const slaDueAt = addDays(now, settings.slaDays ?? DEFAULT_SETTINGS.slaDays).toISOString();
  const username = normalizeUsername(input.username);

  return {
    id: input.id || createAppealId(now),
    subredditName: input.subredditName,
    username,
    state: AppealState.SUBMITTED,
    createdAt,
    updatedAt: createdAt,
    slaDueAt,
    assignedTo: null,
    escalatedAt: null,
    source: input.source || 'custom-post',
    sourceRef: input.sourceRef || null,
    intake: {
      contentUrl: normalizeWhitespace(input.contentUrl || ''),
      rule: normalizeWhitespace(input.rule || 'Not sure'),
      whatHappened: normalizeWhitespace(input.whatHappened || ''),
      reconsiderReason: normalizeWhitespace(input.reconsiderReason || ''),
      futureCommitment: normalizeWhitespace(input.futureCommitment || ''),
    },
    context: input.context || emptyContextPackage(),
    outcome: null,
    resolution: null,
    history: [
      {
        from: null,
        to: AppealState.SUBMITTED,
        actor: username,
        note: 'Appeal submitted.',
        at: createdAt,
      },
    ],
  };
}

export function emptyContextPackage() {
  return {
    originalBanReason: 'Not available yet',
    originalModerator: null,
    triggeringContent: null,
    accountCreatedAt: null,
    accountAgeDays: null,
    linkKarma: null,
    commentKarma: null,
    subredditKarma: null,
    banHistory: [],
    priorWarnings: 0,
    priorAppeals: 0,
    priorUpheldAppeals: 0,
    redFlags: [],
  };
}

export function validateAppealInput(input) {
  const errors = [];
  if (!input?.subredditName) errors.push('Missing subreddit name.');
  if (!input?.username) errors.push('Missing username.');
  if (!withinLength(input?.whatHappened, 100, 500)) errors.push('What happened must be 100–500 characters.');
  if (!withinLength(input?.reconsiderReason, 80, 500)) errors.push('Why reconsider must be 80–500 characters.');
  if (!withinLength(input?.futureCommitment, 40, 300)) errors.push('What you will do differently must be 40–300 characters.');
  if (input?.contentUrl && !looksLikeRedditUrl(input.contentUrl)) errors.push('Content URL must be a Reddit link or left blank.');
  return errors;
}

export function computeSlaStatus(appeal, settings = DEFAULT_SETTINGS, now = new Date()) {
  if (appeal.state === AppealState.CLOSED) return { label: 'Closed', tone: 'neutral', hoursRemaining: 0, overdue: false };

  const dueMs = new Date(appeal.slaDueAt).getTime();
  const diffHours = Math.round((dueMs - now.getTime()) / 36e5);

  if (diffHours < 0) return { label: `${Math.abs(diffHours)}h overdue`, tone: 'danger', hoursRemaining: diffHours, overdue: true };
  if (diffHours <= (settings.reminderHoursBeforeSla ?? DEFAULT_SETTINGS.reminderHoursBeforeSla)) {
    return { label: `${diffHours}h left`, tone: 'warning', hoursRemaining: diffHours, overdue: false };
  }
  const days = Math.ceil(diffHours / 24);
  return { label: `${days}d left`, tone: 'good', hoursRemaining: diffHours, overdue: false };
}

export function reduceToClosed(appeal, outcome, moderatorNote, actor, payload = {}, now = new Date()) {
  if (!Object.values(AppealOutcome).includes(outcome)) {
    throw new Error(`Unsupported outcome: ${outcome}`);
  }

  const decided = transitionAppeal(appeal, outcome, actor, moderatorNote, now);
  const closed = transitionAppeal(decided, AppealState.CLOSED, 'system', `Closed after ${outcome}.`, now);

  return {
    ...closed,
    outcome,
    resolution: {
      outcome,
      note: normalizeWhitespace(moderatorNote),
      decidedBy: actor,
      decidedAt: now.toISOString(),
      newBanDurationDays: payload.newBanDurationDays ?? null,
      nextEligibleAppealAt: payload.nextEligibleAppealAt ?? null,
    },
  };
}

export function normalizeSettings(values = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...values };
  const reviewerPermissions = normalizeArray(settings.reviewerPermissions, DEFAULT_SETTINGS.reviewerPermissions)
    .filter((permission) => MODERATOR_PERMISSIONS.includes(permission));
  const allowedBanTypes = normalizeArray(settings.allowedBanTypes, DEFAULT_SETTINGS.allowedBanTypes)
    .filter((type) => ['temporary', 'permanent'].includes(type));

  return {
    ...settings,
    slaDays: clampInteger(settings.slaDays, 3, 14, DEFAULT_SETTINGS.slaDays),
    upheldCooldownDays: clampInteger(settings.upheldCooldownDays, 1, 365, DEFAULT_SETTINGS.upheldCooldownDays),
    escalationAfterHours: clampInteger(settings.escalationAfterHours, 1, 168, DEFAULT_SETTINGS.escalationAfterHours),
    reminderHoursBeforeSla: clampInteger(settings.reminderHoursBeforeSla, 1, 168, DEFAULT_SETTINGS.reminderHoursBeforeSla),
    reviewerPermissions: reviewerPermissions.length ? reviewerPermissions : [...DEFAULT_SETTINGS.reviewerPermissions],
    allowedBanTypes: allowedBanTypes.length ? allowedBanTypes : [...DEFAULT_SETTINGS.allowedBanTypes],
    welcomeMessage: normalizeWhitespace(settings.welcomeMessage) || DEFAULT_SETTINGS.welcomeMessage,
    intakeMode: normalizeWhitespace(settings.intakeMode) || DEFAULT_SETTINGS.intakeMode,
  };
}

export function getNextEligibleAppealAt(closedAppeal, settings = DEFAULT_SETTINGS) {
  if (!closedAppeal || closedAppeal.state !== AppealState.CLOSED || closedAppeal.outcome !== AppealOutcome.UPHELD) {
    return null;
  }

  if (closedAppeal.resolution?.nextEligibleAppealAt) return closedAppeal.resolution.nextEligibleAppealAt;
  const decidedAt = closedAppeal.resolution?.decidedAt || closedAppeal.updatedAt || closedAppeal.createdAt;
  return addDays(new Date(decidedAt), settings.upheldCooldownDays ?? DEFAULT_SETTINGS.upheldCooldownDays).toISOString();
}

export function isInCooldown(closedAppeal, settings = DEFAULT_SETTINGS, now = new Date()) {
  const nextEligibleAppealAt = getNextEligibleAppealAt(closedAppeal, settings);
  return nextEligibleAppealAt ? new Date(nextEligibleAppealAt) > now : false;
}

export function normalizeUsername(username) {
  return String(username || '').replace(/^u\//i, '').trim();
}

export function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function withinLength(value, min, max) {
  const length = normalizeWhitespace(value).length;
  return length >= min && length <= max;
}

function looksLikeRedditUrl(value) {
  return /^https?:\/\/(www\.)?reddit\.com\//i.test(String(value).trim());
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeArray(value, fallback) {
  if (Array.isArray(value)) return value.map((item) => normalizeWhitespace(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map((item) => normalizeWhitespace(item)).filter(Boolean);
  }
  return [...fallback];
}
