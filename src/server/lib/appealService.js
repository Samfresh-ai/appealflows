import {
  AppealOutcome,
  AppealState,
  DEFAULT_SETTINGS,
  computeSlaStatus,
  createAppealRecord,
  getNextEligibleAppealAt,
  isInCooldown,
  normalizeUsername,
  reduceToClosed,
  transitionAppeal,
  validateAppealInput,
} from '../../shared/state.js';
import { buildAssignmentNotice, buildResolutionMessage, buildSlaReminder } from '../../shared/templates.js';

export class AppealService {
  constructor({ store, redditAdapter, settings = DEFAULT_SETTINGS, clock = () => new Date(), logger = console }) {
    this.store = store;
    this.reddit = redditAdapter;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.clock = clock;
    this.logger = logger;
  }

  async createAppeal(input) {
    const errors = validateAppealInput(input);
    if (errors.length) return { ok: false, errors };

    const eligibility = await this.reddit.canUserSubmitAppeal(input.username, input.subredditName, this.settings.allowedBanTypes);
    if (!eligibility.ok) {
      return {
        ok: false,
        code: eligibility.code || 'NOT_ELIGIBLE',
        errors: [eligibility.message || 'This user is not eligible to submit an appeal.'],
      };
    }

    const existing = await this.store.findOpenByUser(input.subredditName, input.username);
    if (existing) {
      return {
        ok: false,
        errors: ['There is already an open appeal for this user.'],
        existing,
      };
    }

    const lastClosed = await this.store.findLastClosedByUser?.(input.subredditName, normalizeUsername(input.username));
    if (isInCooldown(lastClosed, this.settings, this.clock())) {
      return {
        ok: false,
        code: 'COOLDOWN_ACTIVE',
        errors: [`A prior upheld appeal is still in cooldown. Next eligible appeal: ${formatDate(getNextEligibleAppealAt(lastClosed, this.settings))}.`],
        existing: lastClosed,
        nextEligibleAppealAt: getNextEligibleAppealAt(lastClosed, this.settings),
      };
    }

    const context = await this.buildContext(input);
    const appeal = createAppealRecord({ ...input, context }, this.settings, this.clock());
    await this.store.save(appeal);

    const routed = await this.routeAppeal(appeal.id);
    if (input.sourceRef?.conversationId) {
      await this.store.addConversationRef(input.sourceRef.conversationId, appeal.id);
    }

    return { ok: true, appeal: routed.appeal || appeal };
  }

  async buildContext(input) {
    const context = await this.reddit.safeBuildContextPackage(input);
    const closedAppeals = await this.store.listClosedByUser?.(input.subredditName, normalizeUsername(input.username), 100) || [];
    const upheld = closedAppeals.filter((appeal) => appeal.outcome === AppealOutcome.UPHELD);
    const redFlags = new Set(context.redFlags || []);

    if (upheld.length) redFlags.add(`${upheld.length} previous upheld appeal${upheld.length === 1 ? '' : 's'}`);
    if ((context.priorWarnings || 0) >= 3) redFlags.add('Repeated prior moderation notes');

    return {
      ...context,
      priorAppeals: closedAppeals.length,
      priorUpheldAppeals: upheld.length,
      redFlags: [...redFlags],
    };
  }

  async routeAppeal(appealId) {
    const appeal = await this.requireAppeal(appealId);
    const reviewer = await this.reddit.findBestReviewer(appeal);

    if (!reviewer) {
      const escalated = transitionAppeal(appeal, AppealState.ESCALATED, 'system', 'No active reviewer available.', this.clock());
      const saved = await this.store.save({ ...escalated, escalatedAt: this.clock().toISOString() });
      await this.safeSideEffect('notify mod team about unassigned appeal', () => (
        this.reddit.notifyModTeam(saved, 'Appeal escalated: no active reviewer was available.')
      ));
      return { ok: true, appeal: saved };
    }

    const assigned = transitionAppeal(appeal, AppealState.ASSIGNED, 'system', `Assigned to u/${reviewer}.`, this.clock());
    const saved = await this.store.save({ ...assigned, assignedTo: reviewer });
    await this.safeSideEffect('notify assigned moderator', () => (
      this.reddit.notifyMod(reviewer, buildAssignmentNotice(saved, reviewer), saved)
    ));
    return { ok: true, appeal: saved };
  }

  async listDashboard(viewer) {
    const open = await this.store.listOpen();
    const closed = await this.store.listClosed(250);
    const now = this.clock();
    const normalizedViewer = normalizeUsername(viewer).toLowerCase();
    const closedLast30Days = closed.filter((appeal) => daysBetween(new Date(appeal.updatedAt), now) <= 30);

    const decorated = open.map((appeal) => ({
      ...appeal,
      sla: computeSlaStatus(appeal, this.settings, now),
    }));

    return {
      needsAction: decorated
        .filter((appeal) => normalizeUsername(appeal.assignedTo).toLowerCase() === normalizedViewer && appeal.state !== AppealState.CLOSED)
        .sort(sortByUrgency),
      teamQueue: decorated
        .filter((appeal) => normalizeUsername(appeal.assignedTo).toLowerCase() !== normalizedViewer && appeal.state !== AppealState.CLOSED)
        .sort(sortByUrgency),
      closed: closedLast30Days,
      analytics: buildAnalytics([...open, ...closed], now),
    };
  }

  async getUserAppealStatus(subredditName, username) {
    const normalized = normalizeUsername(username);
    if (!normalized) return { status: 'missing-user' };

    const open = await this.store.findOpenByUser(subredditName, normalized);
    if (open) return { status: 'open', appeal: open, sla: computeSlaStatus(open, this.settings, this.clock()) };

    const closed = await this.store.findLastClosedByUser?.(subredditName, normalized);
    if (!closed) return { status: 'none' };

    return {
      status: isInCooldown(closed, this.settings, this.clock()) ? 'cooldown' : 'closed',
      appeal: closed,
      nextEligibleAppealAt: getNextEligibleAppealAt(closed, this.settings),
    };
  }

  async getIntakeConfig() {
    return {
      settings: {
        slaDays: this.settings.slaDays,
        upheldCooldownDays: this.settings.upheldCooldownDays,
        welcomeMessage: this.settings.welcomeMessage,
        allowedBanTypes: this.settings.allowedBanTypes,
      },
      rules: await this.reddit.getSubredditRules(),
    };
  }

  async isModerator(username) {
    return this.reddit.isModerator(username);
  }

  async canReviewAppeals(username) {
    return this.reddit.canReviewAppeals(username, this.settings.reviewerPermissions);
  }

  async startReview(appealId, actor) {
    const appeal = await this.requireAppeal(appealId);
    this.assertActorCanWorkCase(appeal, actor);
    if (appeal.state === AppealState.UNDER_REVIEW) return appeal;
    const next = transitionAppeal(appeal, AppealState.UNDER_REVIEW, actor, 'Review started.', this.clock());
    return this.store.save(next);
  }

  async escalate(appealId, actor, note) {
    if (!note?.trim()) throw new Error('Escalation requires a note.');
    const appeal = await this.requireAppeal(appealId);
    this.assertActorCanWorkCase(appeal, actor);
    const next = transitionAppeal(appeal, AppealState.ESCALATED, actor, note, this.clock());
    const saved = await this.store.save({ ...next, escalatedAt: this.clock().toISOString(), assignedTo: null });
    await this.safeSideEffect('notify mod team about manual escalation', () => (
      this.reddit.notifyModTeam(saved, `Appeal escalated by u/${actor}: ${note}`)
    ));
    return saved;
  }

  async resolve(appealId, actor, outcome, note, payload = {}) {
    if (!Object.values(AppealOutcome).includes(outcome)) throw new Error(`Unsupported outcome: ${outcome}`);
    if (!note?.trim()) throw new Error('Resolution requires a moderator note.');

    const appeal = await this.ensureReviewing(await this.requireAppeal(appealId), actor);
    const now = this.clock();
    const nextEligibleAppealAt = outcome === AppealOutcome.UPHELD
      ? new Date(now.getTime() + this.settings.upheldCooldownDays * 864e5).toISOString()
      : null;
    const closed = reduceToClosed(appeal, outcome, note, actor, { ...payload, nextEligibleAppealAt }, now);

    await this.reddit.applyOutcome(closed, outcome, payload);
    const message = buildResolutionMessage({
      appeal: closed,
      outcome,
      moderatorNote: note,
      subredditName: appeal.subredditName,
      settings: this.settings,
      now,
    });
    const deliveryError = await this.safeSideEffect('notify user about appeal resolution', () => (
      this.reddit.notifyUser(closed, message)
    ));
    return this.store.save(deliveryError ? { ...closed, deliveryError } : closed);
  }

  async ensureReviewing(appeal, actor) {
    this.assertActorCanWorkCase(appeal, actor);
    if (appeal.state === AppealState.UNDER_REVIEW) return appeal;
    if ([AppealState.ASSIGNED, AppealState.ESCALATED, AppealState.STALE].includes(appeal.state)) {
      return this.store.save(transitionAppeal(appeal, AppealState.UNDER_REVIEW, actor, 'Review started by decision action.', this.clock()));
    }
    return appeal;
  }

  assertActorCanWorkCase(appeal, actor) {
    if (!appeal.assignedTo || appeal.state === AppealState.ESCALATED || appeal.state === AppealState.STALE) return;
    if (normalizeUsername(appeal.assignedTo).toLowerCase() !== normalizeUsername(actor).toLowerCase()) {
      throw new Error(`This appeal is assigned to u/${appeal.assignedTo}. Escalate it before another reviewer resolves it.`);
    }
  }

  async sweepSla() {
    const open = await this.store.listOpen();
    const now = this.clock();
    const actions = [];

    for (const appeal of open) {
      const sla = computeSlaStatus(appeal, this.settings, now);
      if (appeal.state === AppealState.CLOSED) continue;

      if (sla.overdue && appeal.state !== AppealState.ESCALATED && appeal.state !== AppealState.STALE) {
        const stale = appeal.state === AppealState.ASSIGNED
          ? transitionAppeal(appeal, AppealState.STALE, 'system', 'SLA breached.', now)
          : appeal;
        const escalated = transitionAppeal(stale, AppealState.ESCALATED, 'system', 'SLA breached; auto-escalated.', now);
        const saved = await this.store.save({ ...escalated, assignedTo: null, escalatedAt: now.toISOString() });
        await this.safeSideEffect('notify mod team about SLA escalation', () => (
          this.reddit.notifyModTeam(saved, `Appeal ${saved.id} breached SLA and was escalated.`)
        ));
        actions.push({ appealId: appeal.id, action: 'escalated' });
        continue;
      }

      if (appeal.state === AppealState.ESCALATED && appeal.escalatedAt && !appeal.adminEscalationNotifiedAt) {
        const escalatedHours = (now - new Date(appeal.escalatedAt)) / 36e5;
        if (escalatedHours >= this.settings.escalationAfterHours) {
          const saved = await this.store.save({ ...appeal, adminEscalationNotifiedAt: now.toISOString(), updatedAt: now.toISOString() });
          await this.safeSideEffect('notify admins about long escalation', () => (
            this.reddit.notifyModTeam(saved, `Appeal ${saved.id} has been escalated for ${Math.round(escalatedHours)}h without resolution. Mods with full permissions should take ownership.`)
          ));
          actions.push({ appealId: appeal.id, action: 'admin-notified' });
          continue;
        }
      }

      if (!sla.overdue && sla.hoursRemaining <= this.settings.reminderHoursBeforeSla && appeal.assignedTo && !appeal.slaReminderSentAt) {
        const saved = await this.store.save({ ...appeal, slaReminderSentAt: now.toISOString(), updatedAt: now.toISOString() });
        await this.safeSideEffect('notify assigned moderator about SLA reminder', () => (
          this.reddit.notifyMod(appeal.assignedTo, buildSlaReminder(saved), saved)
        ));
        actions.push({ appealId: appeal.id, action: 'reminded' });
      }
    }

    return { checked: open.length, actions };
  }

  async syncModmailAppeals() {
    let inputs;
    try {
      inputs = await this.reddit.findModmailAppealInputs();
    } catch (error) {
      const message = errorToMessage(error);
      this.logger.warn?.('[AppealFlow] modmail appeal sync failed', error);
      return {
        checked: 0,
        imported: 0,
        results: [],
        error: message,
      };
    }
    const results = [];

    for (const input of inputs) {
      const conversationId = input.sourceRef?.conversationId;
      if (conversationId && await this.store.getByConversationRef(conversationId)) {
        results.push({ conversationId, action: 'skipped-existing' });
        continue;
      }

      try {
        const result = await this.createAppeal(input);
        results.push({
          conversationId,
          action: result.ok ? 'imported' : 'rejected',
          appealId: result.appeal?.id,
          errors: result.errors,
        });
      } catch (error) {
        results.push({
          conversationId,
          action: 'failed',
          errors: [errorToMessage(error)],
        });
      }
    }

    return {
      checked: inputs.length,
      imported: results.filter((item) => item.action === 'imported').length,
      results,
    };
  }

  async requireAppeal(id) {
    const appeal = await this.store.get(id);
    if (!appeal) throw new Error(`Appeal not found: ${id}`);
    return appeal;
  }

  async safeSideEffect(label, callback) {
    try {
      await callback();
      return null;
    } catch (error) {
      const message = errorToMessage(error);
      this.logger.warn?.(`[AppealFlow] ${label} failed`, error);
      return message;
    }
  }
}

function sortByUrgency(a, b) {
  return new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime();
}

function buildAnalytics(appeals, now) {
  const closed = appeals.filter((appeal) => appeal.state === AppealState.CLOSED);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const closedThisMonth = closed.filter((appeal) => new Date(appeal.updatedAt) >= monthStart);
  const outcomeCount = (outcome) => closed.filter((appeal) => appeal.outcome === outcome).length;
  const withinSla = closedThisMonth.filter((appeal) => new Date(appeal.updatedAt) <= new Date(appeal.slaDueAt)).length;

  return {
    open: appeals.length - closed.length,
    closed: closed.length,
    averageResponseHours: averageResponseHours(closedThisMonth),
    slaComplianceRate: closedThisMonth.length ? Math.round((withinSla / closedThisMonth.length) * 100) : 100,
    outcomes: {
      upheld: outcomeCount(AppealOutcome.UPHELD),
      reduced: outcomeCount(AppealOutcome.REDUCED),
      overturned: outcomeCount(AppealOutcome.OVERTURNED),
    },
    outcomeBreakdown: Object.values(AppealOutcome).map((outcome) => ({
      outcome,
      count: outcomeCount(outcome),
      percent: percent(outcomeCount(outcome), closed.length),
    })),
    volumeOverTime: buildMonthlyVolume(appeals, now),
    perModStats: buildPerModStats(closed),
    ruleDistribution: toCountRows(appeals.map((appeal) => appeal.intake?.rule || 'Not sure')),
    generatedAt: now.toISOString(),
  };
}

function averageResponseHours(appeals) {
  return appeals.length
    ? Math.round(appeals.reduce((sum, appeal) => sum + ((new Date(appeal.updatedAt) - new Date(appeal.createdAt)) / 36e5), 0) / appeals.length)
    : 0;
}

function buildMonthlyVolume(appeals, now) {
  const months = [];
  for (let index = 5; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    months.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en', { month: 'short' }),
      count: 0,
    });
  }

  for (const appeal of appeals) {
    const created = new Date(appeal.createdAt);
    const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    const bucket = months.find((month) => month.key === key);
    if (bucket) bucket.count += 1;
  }

  return months.map(({ label, count }) => ({ label, count }));
}

function buildPerModStats(closed) {
  const grouped = new Map();
  for (const appeal of closed) {
    const reviewer = appeal.resolution?.decidedBy || 'Unknown';
    const current = grouped.get(reviewer) || { reviewer, handled: 0, totalHours: 0 };
    current.handled += 1;
    current.totalHours += (new Date(appeal.updatedAt) - new Date(appeal.createdAt)) / 36e5;
    grouped.set(reviewer, current);
  }

  return [...grouped.values()]
    .map((item) => ({
      reviewer: item.reviewer,
      handled: item.handled,
      averageResponseHours: Math.round(item.totalHours / item.handled),
    }))
    .sort((a, b) => b.handled - a.handled || a.averageResponseHours - b.averageResponseHours);
}

function toCountRows(values) {
  const grouped = new Map();
  for (const value of values) {
    grouped.set(value, (grouped.get(value) || 0) + 1);
  }
  return [...grouped.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function percent(count, total) {
  return total ? Math.round((count / total) * 100) : 0;
}

function daysBetween(earlier, later) {
  return (later - earlier) / 864e5;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function errorToMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}
