const INDEX_KEYS = Object.freeze({
  OPEN: 'appeals:index:open',
  CLOSED: 'appeals:index:closed',
  ESCALATED: 'appeals:index:escalated',
});

export class JsonRedisAppealStore {
  constructor(redis, scope = 'global') {
    this.redis = redis;
    this.scope = normalizeScope(scope);
  }

  async get(id) {
    const raw = await this.redis.get(appealKey(id));
    return raw ? JSON.parse(raw) : null;
  }

  async save(appeal) {
    await this.redis.set(appealKey(appeal.id), JSON.stringify(appeal));
    await this.#syncIndexes(appeal);
    await this.redis.set(userOpenKey(appeal.subredditName, appeal.username), appeal.state === 'CLOSED' ? '' : appeal.id);
    return appeal;
  }

  async listOpen() {
    return this.#listFromIndex(this.#indexKey(INDEX_KEYS.OPEN));
  }

  async listClosed(limit = 30) {
    const ids = await this.#readIndex(this.#indexKey(INDEX_KEYS.CLOSED));
    const selected = ids.slice(-limit).reverse();
    return this.#hydrate(selected);
  }

  async findOpenByUser(subredditName, username) {
    const id = await this.redis.get(userOpenKey(subredditName, username));
    return id ? this.get(id) : null;
  }

  async findLastClosedByUser(subredditName, username) {
    const ids = (await this.#readIndex(this.#indexKey(INDEX_KEYS.CLOSED))).slice().reverse();
    const normalized = username.toLowerCase();
    for (const id of ids) {
      const appeal = await this.get(id);
      if (
        appeal?.subredditName?.toLowerCase() === subredditName.toLowerCase() &&
        appeal?.username?.toLowerCase() === normalized
      ) {
        return appeal;
      }
    }
    return null;
  }

  async listClosedByUser(subredditName, username, limit = 100) {
    const ids = (await this.#readIndex(this.#indexKey(INDEX_KEYS.CLOSED))).slice().reverse();
    const normalized = username.toLowerCase();
    const records = [];
    for (const id of ids) {
      const appeal = await this.get(id);
      if (
        appeal?.subredditName?.toLowerCase() === subredditName.toLowerCase() &&
        appeal?.username?.toLowerCase() === normalized
      ) {
        records.push(appeal);
      }
      if (records.length >= limit) break;
    }
    return records;
  }

  async addConversationRef(conversationId, appealId) {
    if (conversationId) await this.redis.set(conversationKey(conversationId), appealId);
  }

  async getByConversationRef(conversationId) {
    const id = await this.redis.get(conversationKey(conversationId));
    return id ? this.get(id) : null;
  }

  async #syncIndexes(appeal) {
    const openKey = this.#indexKey(INDEX_KEYS.OPEN);
    const closedKey = this.#indexKey(INDEX_KEYS.CLOSED);
    const escalatedKey = this.#indexKey(INDEX_KEYS.ESCALATED);
    const open = await this.#readIndex(openKey);
    const closed = await this.#readIndex(closedKey);
    const escalated = await this.#readIndex(escalatedKey);

    const without = (ids) => ids.filter((id) => id !== appeal.id);
    const nextOpen = appeal.state === 'CLOSED' ? without(open) : appendUnique(without(open), appeal.id);
    const nextClosed = appeal.state === 'CLOSED' ? appendUnique(without(closed), appeal.id) : without(closed);
    const nextEscalated = appeal.state === 'ESCALATED' || appeal.state === 'STALE'
      ? appendUnique(without(escalated), appeal.id)
      : without(escalated);

    await this.redis.set(openKey, JSON.stringify(nextOpen));
    await this.redis.set(closedKey, JSON.stringify(nextClosed));
    await this.redis.set(escalatedKey, JSON.stringify(nextEscalated));
  }

  #indexKey(key) {
    return `${this.scope}:${key}`;
  }

  async #listFromIndex(key) {
    const ids = await this.#readIndex(key);
    return this.#hydrate(ids);
  }

  async #hydrate(ids) {
    const records = [];
    for (const id of ids) {
      const appeal = await this.get(id);
      if (appeal) records.push(appeal);
    }
    return records;
  }

  async #readIndex(key) {
    const raw = await this.redis.get(key);
    if (!raw) return [];
    try {
      const ids = JSON.parse(raw);
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }
}

export class MemoryAppealStore {
  constructor(seed = []) {
    this.records = new Map(seed.map((appeal) => [appeal.id, structuredClone(appeal)]));
    this.conversations = new Map();
  }

  async get(id) {
    const appeal = this.records.get(id);
    return appeal ? structuredClone(appeal) : null;
  }

  async save(appeal) {
    this.records.set(appeal.id, structuredClone(appeal));
    return appeal;
  }

  async listOpen() {
    return [...this.records.values()]
      .filter((appeal) => appeal.state !== 'CLOSED')
      .map((appeal) => structuredClone(appeal));
  }

  async listClosed(limit = 30) {
    return [...this.records.values()]
      .filter((appeal) => appeal.state === 'CLOSED')
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, limit)
      .map((appeal) => structuredClone(appeal));
  }

  async findOpenByUser(subredditName, username) {
    return [...this.records.values()].find((appeal) => (
      appeal.subredditName === subredditName &&
      appeal.username.toLowerCase() === username.toLowerCase() &&
      appeal.state !== 'CLOSED'
    )) || null;
  }

  async findLastClosedByUser(subredditName, username) {
    return [...this.records.values()]
      .filter((appeal) => (
        appeal.subredditName === subredditName &&
        appeal.username.toLowerCase() === username.toLowerCase() &&
        appeal.state === 'CLOSED'
      ))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0] || null;
  }

  async listClosedByUser(subredditName, username, limit = 100) {
    return [...this.records.values()]
      .filter((appeal) => (
        appeal.subredditName === subredditName &&
        appeal.username.toLowerCase() === username.toLowerCase() &&
        appeal.state === 'CLOSED'
      ))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, limit)
      .map((appeal) => structuredClone(appeal));
  }

  async addConversationRef(conversationId, appealId) {
    this.conversations.set(conversationId, appealId);
  }

  async getByConversationRef(conversationId) {
    const id = this.conversations.get(conversationId);
    return id ? this.get(id) : null;
  }
}

function appealKey(id) {
  return `appeal:${id}`;
}

function userOpenKey(subredditName, username) {
  return `appeal:user-open:${subredditName.toLowerCase()}:${username.toLowerCase()}`;
}

function conversationKey(conversationId) {
  return `appeal:conversation:${conversationId}`;
}

function appendUnique(items, item) {
  return items.includes(item) ? items : [...items, item];
}

function normalizeScope(value) {
  return String(value || 'global').toLowerCase().replace(/^r\//, '').replace(/[^a-z0-9_-]/g, '-');
}
