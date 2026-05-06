import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppealState,
  createAppealRecord,
  emptyContextPackage,
  reduceToClosed,
  transitionAppeal,
  validateAppealInput,
} from '../src/shared/state.js';
import { AppealService } from '../src/server/lib/appealService.js';
import { JsonRedisAppealStore, MemoryAppealStore } from '../src/server/lib/storage.js';

const validInput = {
  subredditName: 'ExampleSub',
  username: 'quiet-otter',
  contentUrl: 'https://www.reddit.com/r/ExampleSub/comments/abc/example/',
  rule: 'Rule 1',
  whatHappened: 'I responded badly in a heated thread and made the conversation personal instead of stepping back or reporting the issue to moderators.',
  reconsiderReason: 'I understand the rule and believe a shorter ban would be enough because this was a first serious mistake after years of normal participation.',
  futureCommitment: 'I will report hostile replies and stop participating when a thread gets personal.',
};

test('validates structured appeal input', () => {
  assert.deepEqual(validateAppealInput(validInput), []);
});

test('creates a submitted appeal with SLA', () => {
  const now = new Date('2026-05-05T00:00:00.000Z');
  const appeal = createAppealRecord(validInput, { slaDays: 7 }, now);
  assert.equal(appeal.state, AppealState.SUBMITTED);
  assert.equal(appeal.slaDueAt, '2026-05-12T00:00:00.000Z');
  assert.equal(appeal.username, 'quiet-otter');
});

test('prevents invalid state transition', () => {
  const appeal = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-05T00:00:00.000Z'));
  assert.throws(() => transitionAppeal(appeal, AppealState.OVERTURNED, 'mod'), /Invalid appeal transition/);
});

test('closes appeal with outcome', () => {
  const appeal = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-05T00:00:00.000Z'));
  const assigned = transitionAppeal(appeal, AppealState.ASSIGNED, 'system');
  const reviewing = transitionAppeal(assigned, AppealState.UNDER_REVIEW, 'sam_mod');
  const closed = reduceToClosed(reviewing, 'OVERTURNED', 'Clear accountability.', 'sam_mod');
  assert.equal(closed.state, AppealState.CLOSED);
  assert.equal(closed.outcome, 'OVERTURNED');
});

test('keeps Redis indexes scoped to one subreddit install', async () => {
  const redis = new FakeRedis();
  const appeal = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-05T00:00:00.000Z'));

  await new JsonRedisAppealStore(redis, 'ExampleSub').save(appeal);

  assert.equal((await new JsonRedisAppealStore(redis, 'ExampleSub').listOpen()).length, 1);
  assert.equal((await new JsonRedisAppealStore(redis, 'OtherSub').listOpen()).length, 0);
});

test('rejects appeals when ban status cannot be verified', async () => {
  const service = new AppealService({
    store: new MemoryAppealStore(),
    redditAdapter: {
      canUserSubmitAppeal: async () => ({
        ok: false,
        code: 'NOT_BANNED',
        message: 'Only currently banned users can submit a ban appeal.',
      }),
    },
  });

  const result = await service.createAppeal(validInput);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_BANNED');
  assert.match(result.errors[0], /currently banned/);
});

test('enforces upheld appeal cooldown before accepting another appeal', async () => {
  const submitted = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-01T00:00:00.000Z'));
  const assigned = transitionAppeal(submitted, AppealState.ASSIGNED, 'system', '', new Date('2026-05-01T01:00:00.000Z'));
  const reviewing = transitionAppeal(assigned, AppealState.UNDER_REVIEW, 'sam_mod', '', new Date('2026-05-01T02:00:00.000Z'));
  const closed = reduceToClosed(reviewing, 'UPHELD', 'Decision stands.', 'sam_mod', {
    nextEligibleAppealAt: '2026-05-31T02:00:00.000Z',
  }, new Date('2026-05-01T03:00:00.000Z'));
  const service = new AppealService({
    store: new MemoryAppealStore([closed]),
    redditAdapter: fakeRedditAdapter(),
    clock: () => new Date('2026-05-10T00:00:00.000Z'),
  });

  const result = await service.createAppeal(validInput);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COOLDOWN_ACTIVE');
  assert.equal(result.nextEligibleAppealAt, '2026-05-31T02:00:00.000Z');
});

test('decision actions move assigned appeals through under review before closing', async () => {
  const submitted = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-05T00:00:00.000Z'));
  const assigned = { ...transitionAppeal(submitted, AppealState.ASSIGNED, 'system'), assignedTo: 'sam_mod' };
  const service = new AppealService({
    store: new MemoryAppealStore([assigned]),
    redditAdapter: fakeRedditAdapter(),
    clock: () => new Date('2026-05-06T00:00:00.000Z'),
  });

  const closed = await service.resolve(assigned.id, 'sam_mod', 'OVERTURNED', 'Clear accountability.');
  assert.equal(closed.state, AppealState.CLOSED);
  assert.equal(closed.history.some((entry) => entry.to === AppealState.UNDER_REVIEW), true);
});

test('SLA sweep sends one reminder before deadline', async () => {
  const submitted = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-05T00:00:00.000Z'));
  const assigned = {
    ...transitionAppeal(submitted, AppealState.ASSIGNED, 'system'),
    assignedTo: 'sam_mod',
    slaDueAt: '2026-05-06T23:00:00.000Z',
  };
  const notices = [];
  const service = new AppealService({
    store: new MemoryAppealStore([assigned]),
    redditAdapter: fakeRedditAdapter({ notifyMod: async (...args) => notices.push(args) }),
    clock: () => new Date('2026-05-06T00:00:00.000Z'),
  });

  assert.deepEqual((await service.sweepSla()).actions.map((item) => item.action), ['reminded']);
  assert.deepEqual((await service.sweepSla()).actions, []);
  assert.equal(notices.length, 1);
});

test('SLA sweep marks stale then escalates assigned overdue appeals', async () => {
  const submitted = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-01T00:00:00.000Z'));
  const assigned = {
    ...transitionAppeal(submitted, AppealState.ASSIGNED, 'system'),
    assignedTo: 'sam_mod',
    slaDueAt: '2026-05-02T00:00:00.000Z',
  };
  const store = new MemoryAppealStore([assigned]);
  const service = new AppealService({
    store,
    redditAdapter: fakeRedditAdapter(),
    clock: () => new Date('2026-05-03T00:00:00.000Z'),
  });

  const sweep = await service.sweepSla();
  const saved = await store.get(assigned.id);
  assert.deepEqual(sweep.actions.map((item) => item.action), ['escalated']);
  assert.equal(saved.state, AppealState.ESCALATED);
  assert.equal(saved.history.some((entry) => entry.to === AppealState.STALE), true);
});

test('modmail sync imports parseable appeal inputs once', async () => {
  const store = new MemoryAppealStore();
  const service = new AppealService({
    store,
    redditAdapter: fakeRedditAdapter({
      findModmailAppealInputs: async () => [{
        ...validInput,
        source: 'modmail',
        sourceRef: { conversationId: 'conv-1' },
      }],
    }),
  });

  const first = await service.syncModmailAppeals();
  const second = await service.syncModmailAppeals();
  assert.equal(first.imported, 1);
  assert.equal(second.results[0].action, 'skipped-existing');
});

test('assignment still succeeds when moderator notification fails', async () => {
  const store = new MemoryAppealStore();
  const warnings = [];
  const service = new AppealService({
    store,
    redditAdapter: fakeRedditAdapter({
      findBestReviewer: async () => 'sam_mod',
      notifyMod: async () => {
        throw new Error('modmail unavailable');
      },
    }),
    logger: { warn: (...args) => warnings.push(args) },
  });

  const result = await service.createAppeal(validInput);
  assert.equal(result.ok, true);
  assert.equal(result.appeal.state, AppealState.ASSIGNED);
  assert.equal(result.appeal.assignedTo, 'sam_mod');
  assert.equal(warnings.length, 1);
});

test('modmail sync reports upstream failures without throwing', async () => {
  const warnings = [];
  const service = new AppealService({
    store: new MemoryAppealStore(),
    redditAdapter: fakeRedditAdapter({
      findModmailAppealInputs: async () => {
        throw new Error('modmail fetch failed');
      },
    }),
    logger: { warn: (...args) => warnings.push(args) },
  });

  const result = await service.syncModmailAppeals();
  assert.equal(result.checked, 0);
  assert.equal(result.imported, 0);
  assert.equal(result.error, 'modmail fetch failed');
  assert.equal(warnings.length, 1);
});

test('closed decisions persist when user notification delivery fails', async () => {
  const submitted = createAppealRecord(validInput, { slaDays: 7 }, new Date('2026-05-05T00:00:00.000Z'));
  const assigned = { ...transitionAppeal(submitted, AppealState.ASSIGNED, 'system'), assignedTo: 'sam_mod' };
  const warnings = [];
  const service = new AppealService({
    store: new MemoryAppealStore([assigned]),
    redditAdapter: fakeRedditAdapter({
      notifyUser: async () => {
        throw new Error('user modmail failed');
      },
    }),
    clock: () => new Date('2026-05-06T00:00:00.000Z'),
    logger: { warn: (...args) => warnings.push(args) },
  });

  const closed = await service.resolve(assigned.id, 'sam_mod', 'UPHELD', 'The ban stands after review.');
  assert.equal(closed.state, AppealState.CLOSED);
  assert.equal(closed.deliveryError, 'user modmail failed');
  assert.equal(warnings.length, 1);
});

function fakeRedditAdapter(overrides = {}) {
  return {
    canUserSubmitAppeal: async () => ({ ok: true }),
    safeBuildContextPackage: async () => emptyContextPackage(),
    findBestReviewer: async () => null,
    notifyMod: async () => null,
    notifyModTeam: async () => null,
    notifyUser: async () => null,
    applyOutcome: async () => null,
    findModmailAppealInputs: async () => [],
    isModerator: async () => true,
    canReviewAppeals: async () => true,
    getSubredditRules: async () => [{ value: 'Rule 1', label: 'Rule 1' }],
    ...overrides,
  };
}

class FakeRedis {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async set(key, value) {
    this.values.set(key, value);
  }
}
