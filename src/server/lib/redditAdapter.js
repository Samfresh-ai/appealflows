import { emptyContextPackage, normalizeUsername } from '../../shared/state.js';

export class RedditAdapter {
  constructor({ reddit, subredditName, subredditId = null, logger = console }) {
    this.reddit = reddit;
    this.subredditName = subredditName;
    this.subredditId = subredditId;
    this.logger = logger;
  }

  async safeBuildContextPackage(input) {
    try {
      return await this.buildContextPackage(input);
    } catch (error) {
      this.logger.warn?.('Context package failed; using safe fallback.', error);
      return emptyContextPackage();
    }
  }

  async buildContextPackage(input) {
    const username = normalizeUsername(input.username);
    const context = emptyContextPackage();

    // Devvit API method names can shift between versions. Keep the calls isolated here.
    const [modlogEntry, priorNotes, priorAppeals, userStats, subredditKarma] = await Promise.allSettled([
      this.findMostRecentBanLog(username),
      this.getUserModerationNotes(username),
      this.getPriorAppeals(username),
      this.getUserStats(username),
      this.getUserSubredditKarma(username),
    ]);

    if (modlogEntry.status === 'fulfilled' && modlogEntry.value) {
      context.originalBanReason = modlogEntry.value.description || modlogEntry.value.details || 'Ban reason unavailable';
      context.originalModerator = modlogEntry.value.moderatorName || modlogEntry.value.mod || null;
      context.triggeringContent = modlogEntry.value.target?.permalink || modlogEntry.value.targetPermalink || null;
    }

    if (priorNotes.status === 'fulfilled' && Array.isArray(priorNotes.value)) {
      context.priorWarnings = priorNotes.value.length;
    }

    if (priorAppeals.status === 'fulfilled') {
      context.priorAppeals = priorAppeals.value.total;
      context.priorUpheldAppeals = priorAppeals.value.upheld;
    }

    if (userStats.status === 'fulfilled' && userStats.value) {
      Object.assign(context, userStats.value);
    }

    if (subredditKarma.status === 'fulfilled') {
      context.subredditKarma = subredditKarma.value;
    }

    if (input.contentUrl) {
      context.triggeringContent = await this.safeFetchContentPreview(input.contentUrl);
    }

    return context;
  }

  async findBestReviewer(appeal) {
    if (appeal.context?.originalModerator) {
      const active = await this.isModeratorActive(appeal.context.originalModerator, 7);
      if (active) return appeal.context.originalModerator;
    }
    return this.findRecentlyActiveModerator();
  }

  async canUserSubmitAppeal(username, subredditName = this.subredditName, allowedBanTypes = ['temporary', 'permanent']) {
    if (!this.reddit?.getBannedUsers) {
      return {
        ok: false,
        code: 'BAN_STATUS_UNAVAILABLE',
        message: 'AppealFlow could not verify that this account is currently banned.',
      };
    }

    const normalized = normalizeUsername(username);
    const listing = this.reddit.getBannedUsers({
      subredditName,
      username: normalized,
      limit: 1,
      pageSize: 1,
    });
    const users = await listing.all?.() || [];
    const bannedUser = users.find((user) => normalizeUsername(user.username || user.name || '').toLowerCase() === normalized.toLowerCase());
    const banType = inferBanType(bannedUser);

    if (!bannedUser) {
      return {
        ok: false,
        code: 'NOT_BANNED',
        message: 'Only currently banned users can submit a ban appeal.',
      };
    }

    if (banType && !allowedBanTypes.includes(banType)) {
      return {
        ok: false,
        code: 'BAN_TYPE_NOT_ALLOWED',
        message: `${banType === 'permanent' ? 'Permanently' : 'Temporarily'} banned users are not enabled for AppealFlow in this community.`,
      };
    }

    return { ok: true, banType };
  }

  async applyOutcome(appeal, outcome, payload = {}) {
    if (outcome === 'OVERTURNED') {
      return this.unbanUser(appeal.username, appeal.subredditName);
    }

    if (outcome === 'REDUCED') {
      const durationDays = payload.newBanDurationDays || 7;
      return this.tempBanUser(appeal.username, durationDays, appeal.subredditName, appeal.resolution?.note);
    }

    return null;
  }

  async notifyUser(appeal, message) {
    if (appeal.sourceRef?.conversationId && this.reddit?.modMail?.reply) {
      return this.reddit.modMail.reply({
        conversationId: appeal.sourceRef.conversationId,
        body: message,
        isAuthorHidden: false,
      });
    }

    if (this.reddit?.modMail?.createConversation) {
      return this.reddit.modMail.createConversation({
        subject: `AppealFlow decision for u/${appeal.username}`,
        body: message,
        subredditName: appeal.subredditName || this.subredditName,
        to: `u/${appeal.username}`,
        isAuthorHidden: false,
      });
    }

    this.logger.info?.('[notifyUser fallback]', { appealId: appeal.id, message });
    return null;
  }

  async notifyMod(reviewer, message, appeal) {
    const body = `Assigned reviewer: u/${reviewer}\n\n${message}`;
    if (this.subredditId && this.reddit?.modMail?.createModNotification) {
      return this.reddit.modMail.createModNotification({
        subject: `AppealFlow: ${appeal.id} assigned`,
        bodyMarkdown: body,
        subredditId: this.subredditId,
      });
    }
    if (this.reddit?.modMail?.createConversation) {
      return this.reddit.modMail.createConversation({
        subject: `AppealFlow: ${appeal.id} assigned to u/${reviewer}`,
        body,
        subredditName: appeal.subredditName || this.subredditName,
        to: null,
      });
    }
    this.logger.info?.('[notifyMod fallback]', { reviewer, message });
    return null;
  }

  async notifyModTeam(appeal, message) {
    if (this.subredditId && this.reddit?.modMail?.createModNotification) {
      return this.reddit.modMail.createModNotification({
        subject: `AppealFlow: ${appeal.id}`,
        bodyMarkdown: message,
        subredditId: this.subredditId,
      });
    }
    if (this.reddit?.modMail?.createConversation) {
      return this.reddit.modMail.createConversation({
        subject: `AppealFlow: ${appeal.id}`,
        body: message,
        subredditName: appeal.subredditName || this.subredditName,
        to: null,
      });
    }
    this.logger.info?.('[notifyModTeam fallback]', { appealId: appeal.id, message });
    return null;
  }

  async findMostRecentBanLog(username) {
    if (!this.reddit?.getModerationLog) return null;
    const logs = await this.reddit.getModerationLog({
      subredditName: this.subredditName,
      type: 'banuser',
      limit: 100,
    }).all?.() || [];
    return logs.find((entry) => normalizeUsername(entry.targetAuthorName || entry.targetUser || '').toLowerCase() === username.toLowerCase()) || null;
  }

  async getUserModerationNotes(username) {
    if (!this.reddit?.getModNotes) return [];
    const notes = await this.reddit.getModNotes({
      subreddit: this.subredditName,
      user: username,
      limit: 50,
    }).all?.();
    return notes || [];
  }

  async getPriorAppeals(_username) {
    return { total: 0, upheld: 0 };
  }

  async getUserStats(username) {
    if (!this.reddit?.getUserByUsername) return {};
    const user = await this.reddit.getUserByUsername(username);
    if (!user) return {};
    const createdAt = user.createdAt instanceof Date ? user.createdAt : null;
    return {
      accountCreatedAt: createdAt?.toISOString() || null,
      accountAgeDays: createdAt ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 864e5)) : null,
      linkKarma: Number.isFinite(user.linkKarma) ? user.linkKarma : null,
      commentKarma: Number.isFinite(user.commentKarma) ? user.commentKarma : null,
    };
  }

  async getUserSubredditKarma(username) {
    if (!this.reddit?.getUserKarmaFromCurrentSubreddit) return null;
    const karma = await this.reddit.getUserKarmaFromCurrentSubreddit(username);
    return karma || null;
  }

  async safeFetchContentPreview(url) {
    try {
      if (!this.reddit?.getPostByUrl && !this.reddit?.getCommentById) return url;
      return url;
    } catch {
      return url;
    }
  }

  async isModeratorActive(_username, _days) {
    const username = normalizeUsername(_username);
    const moderators = await this.listModerators();
    if (!moderators.some((name) => name.toLowerCase() === username.toLowerCase())) return false;
    if (!this.reddit?.getModerationLog) return true;

    const since = Date.now() - (_days * 864e5);
    const logs = await this.reddit.getModerationLog({
      subredditName: this.subredditName,
      moderatorUsernames: [username],
      limit: 100,
      pageSize: 100,
    }).all?.() || [];
    return logs.some((entry) => new Date(entry.createdAt).getTime() >= since);
  }

  async findRecentlyActiveModerator() {
    const moderators = await this.listModerators();
    if (!moderators.length) return null;
    if (!this.reddit?.getModerationLog) return moderators.find((name) => name.toLowerCase() !== 'automoderator') || null;

    const logs = await this.reddit.getModerationLog({
      subredditName: this.subredditName,
      limit: 100,
      pageSize: 100,
    }).all?.() || [];
    const activeMods = logs
      .map((entry) => normalizeUsername(entry.moderatorName || entry.mod || ''))
      .filter((name) => name && name.toLowerCase() !== 'automoderator');
    return activeMods.find((name) => moderators.some((mod) => mod.toLowerCase() === name.toLowerCase()))
      || moderators.find((name) => name.toLowerCase() !== 'automoderator')
      || null;
  }

  async listModerators() {
    if (!this.reddit?.getModerators) return [];
    const users = await this.reddit.getModerators({
      subredditName: this.subredditName,
      limit: 100,
      pageSize: 100,
    }).all?.() || [];
    return users.map((user) => normalizeUsername(user.username || user.name || '')).filter(Boolean);
  }

  async getSubredditRules() {
    if (!this.reddit?.getRules) return fallbackRules();
    const rules = await this.reddit.getRules(this.subredditName);
    const mapped = (rules || []).map((rule, index) => ({
      value: rule.shortName || `Rule ${index + 1}`,
      label: rule.shortName || `Rule ${index + 1}`,
      description: rule.description || '',
    }));
    return mapped.length ? mapped : fallbackRules();
  }

  async getModeratorProfile(username) {
    if (!this.reddit?.getModerators) return null;
    const normalized = normalizeUsername(username);
    const users = await this.reddit.getModerators({
      subredditName: this.subredditName,
      username: normalized,
      limit: 1,
      pageSize: 1,
    }).all?.() || [];
    const user = users.find((candidate) => normalizeUsername(candidate.username || candidate.name || '').toLowerCase() === normalized.toLowerCase());
    if (!user) return null;
    const permissions = user.modPermissions?.get?.(this.subredditName)
      || await user.getModPermissionsForSubreddit?.(this.subredditName)
      || [];
    return { username: normalized, permissions };
  }

  async isModerator(username) {
    return Boolean(await this.getModeratorProfile(username));
  }

  async canReviewAppeals(username, requiredPermissions = ['all', 'mail']) {
    const profile = await this.getModeratorProfile(username);
    if (!profile) return false;
    if (!requiredPermissions.length) return true;
    if (profile.permissions.includes('all')) return true;
    return requiredPermissions.some((permission) => profile.permissions.includes(permission));
  }

  async findModmailAppealInputs() {
    if (!this.reddit?.modMail?.getConversations || !this.reddit?.modMail?.getConversation) return [];

    const listing = await this.reddit.modMail.getConversations({
      subreddits: [this.subredditName],
      limit: 50,
      sort: 'user',
      state: 'all',
    });

    const inputs = [];
    for (const conversationId of listing.conversationIds || Object.keys(listing.conversations || {})) {
      const summary = listing.conversations?.[conversationId];
      if (!looksAppealLike(summary)) continue;

      const details = await this.reddit.modMail.getConversation({ conversationId, markRead: false });
      const parsed = parseAppealConversation(details.conversation || summary, details.user, this.subredditName);
      if (parsed) inputs.push(parsed);
    }
    return inputs;
  }

  async unbanUser(username, subredditName = this.subredditName) {
    if (this.reddit?.unbanUser) {
      return this.reddit.unbanUser(username, subredditName);
    }
    this.logger.info?.('[unban fallback]', { username, subredditName });
    return null;
  }

  async tempBanUser(username, durationDays, subredditName = this.subredditName, note = '') {
    if (this.reddit?.banUser) {
      return this.reddit.banUser({
        subredditName,
        username,
        duration: durationDays,
        note,
      });
    }
    this.logger.info?.('[tempBan fallback]', { username, durationDays, subredditName, note });
    return null;
  }
}

function fallbackRules() {
  return [
    { value: 'Not sure', label: 'Not sure', description: '' },
  ];
}

function looksAppealLike(conversation = {}) {
  const haystack = [
    conversation.subject,
    conversation.state,
    ...Object.values(conversation.messages || {}).map((message) => message.bodyMarkdown || message.body || ''),
  ].join('\n').toLowerCase();
  return haystack.includes('/appeal') || haystack.includes('appeal');
}

function parseAppealConversation(conversation = {}, user = {}, subredditName) {
  const messages = Object.values(conversation.messages || {})
    .filter((message) => !message.isInternal && !message.author?.isMod)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const text = messages.map((message) => message.bodyMarkdown || message.body || '').join('\n\n');
  if (!/\/appeal|appeal/i.test(`${conversation.subject || ''}\n${text}`)) return null;

  const username = normalizeUsername(user?.name || conversation.participant?.name || messages[0]?.author?.name || '');
  if (!username) return null;

  const fields = extractAppealFields(text);
  return {
    subredditName,
    username,
    contentUrl: fields.contentUrl,
    rule: fields.rule || 'Not sure',
    whatHappened: fields.whatHappened,
    reconsiderReason: fields.reconsiderReason,
    futureCommitment: fields.futureCommitment,
    source: 'modmail',
    sourceRef: {
      conversationId: conversation.id,
      subject: conversation.subject || '',
    },
  };
}

function extractAppealFields(text) {
  const fields = {
    contentUrl: '',
    rule: '',
    whatHappened: '',
    reconsiderReason: '',
    futureCommitment: '',
  };
  let activeKey = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === '/appeal') continue;

    const matched = matchAppealLabel(line);
    if (matched) {
      activeKey = matched.key;
      appendField(fields, activeKey, matched.value);
      continue;
    }

    if (activeKey) appendField(fields, activeKey, line);
  }

  if (!fields.contentUrl) {
    fields.contentUrl = text.match(/https?:\/\/(?:www\.)?reddit\.com\/\S+/i)?.[0] || '';
  }

  return fields;
}

function matchAppealLabel(line) {
  const labels = [
    ['contentUrl', /^(?:post(?:\s+or\s+comment)?|comment|content|link|url)\s*[:\-]\s*(.*)$/i],
    ['rule', /^rule\s*[:\-]\s*(.*)$/i],
    ['whatHappened', /^(?:what\s+happened|happened|situation)\s*[:\-]\s*(.*)$/i],
    ['reconsiderReason', /^(?:why(?:\s+should\s+this)?(?:\s+be)?\s+reconsidered|why\s+reconsider|reconsider(?:ation)?\s+reason)\s*[:\-]\s*(.*)$/i],
    ['futureCommitment', /^(?:what\s+will\s+you\s+do\s+differently|future|going\s+forward|differently|commitment)\s*[:\-]\s*(.*)$/i],
  ];

  for (const [key, pattern] of labels) {
    const match = line.match(pattern);
    if (match) return { key, value: match[1] || '' };
  }
  return null;
}

function appendField(fields, key, value) {
  if (!value) return;
  fields[key] = fields[key] ? `${fields[key]} ${value}` : value;
}

function inferBanType(user) {
  if (!user) return null;
  if (user.banStatus?.isPermanent === true || user.isPermanent === true) return 'permanent';
  if (user.banStatus?.endDate || user.bannedUntil || user.duration) return 'temporary';
  return null;
}
