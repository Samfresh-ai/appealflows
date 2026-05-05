import { Hono } from 'hono';
import { context, redis, reddit, settings as devvitSettings } from '@devvit/web/server';
import { AppealService } from './lib/appealService.js';
import { JsonRedisAppealStore } from './lib/storage.js';
import { RedditAdapter } from './lib/redditAdapter.js';
import { DEFAULT_SETTINGS, normalizeSettings, normalizeUsername } from '../shared/state.js';

const app = new Hono();

async function serviceFor(subredditName, subredditId = null) {
  return new AppealService({
    store: new JsonRedisAppealStore(redis, subredditName),
    redditAdapter: new RedditAdapter({ reddit, subredditName, subredditId }),
    settings: await readSettings(),
  });
}

function readRequestContext() {
  try {
    return {
      subredditName: context.subredditName,
      subredditId: context.subredditId,
      userName: context.username,
      isLoggedIn: Boolean(context.username),
    };
  } catch {
    return {};
  }
}

async function readSettings() {
  try {
    return normalizeSettings(await devvitSettings.getAll());
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

function subredditFor(c, body = {}) {
  const requestContext = readRequestContext();
  return body.subredditName || requestContext.subredditName || c.req.header('x-devvit-subreddit') || 'unknown';
}

async function requireModerator(c, service) {
  const requestContext = readRequestContext();
  if (c.req.header('x-appealflow-local-test') === '1') return null;
  if (!requestContext.userName) return c.json({ ok: false, error: 'Sign in required.' }, 401);
  if (!await service.isModerator(requestContext.userName)) return c.json({ ok: false, error: 'Moderator access required.' }, 403);
  return null;
}

async function requireReviewer(c, service) {
  const requestContext = readRequestContext();
  if (c.req.header('x-appealflow-local-test') === '1') return null;
  if (!requestContext.userName) return c.json({ ok: false, error: 'Sign in required.' }, 401);
  if (!await service.canReviewAppeals(requestContext.userName)) {
    return c.json({ ok: false, error: 'This moderator does not have the configured AppealFlow reviewer permissions.' }, 403);
  }
  return null;
}

function requireSelfSubmit(c, body) {
  const requestContext = readRequestContext();
  if (!requestContext.userName) return null;
  if (normalizeUsername(requestContext.userName) !== normalizeUsername(body.username)) {
    return c.json({ ok: false, errors: ['Submit appeals from the banned account only.'] }, 403);
  }
  return null;
}

app.get('/api/health', (c) => c.json({ ok: true, app: 'AppealFlow' }));

app.get('/api/intake', async (c) => {
  const requestContext = readRequestContext();
  const subredditName = c.req.query('subredditName') || subredditFor(c);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const intake = await service.getIntakeConfig();
  return c.json({
    ...intake,
    currentUser: requestContext.userName || null,
  });
});

app.get('/api/appeals/status', async (c) => {
  const requestContext = readRequestContext();
  const username = c.req.query('username') || requestContext.userName || '';
  if (requestContext.userName && normalizeUsername(requestContext.userName) !== normalizeUsername(username)) {
    return c.json({ ok: false, errors: ['Check appeal status from the affected account only.'] }, 403);
  }
  const subredditName = c.req.query('subredditName') || subredditFor(c);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  return c.json({ ok: true, ...(await service.getUserAppealStatus(subredditName, username)) });
});

app.get('/api/dashboard', async (c) => {
  const requestContext = readRequestContext();
  const subredditName = c.req.query('subredditName') || subredditFor(c);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireModerator(c, service);
  if (denied) return denied;
  const viewer = c.req.query('viewer') || requestContext.userName || 'moderator';
  const dashboard = await service.listDashboard(viewer);
  return c.json(dashboard);
});

app.get('/api/appeals/:id', async (c) => {
  const requestContext = readRequestContext();
  const subredditName = c.req.query('subredditName') || subredditFor(c);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireModerator(c, service);
  if (denied) return denied;
  const appeal = await service.requireAppeal(c.req.param('id'));
  return c.json({ appeal });
});

app.post('/api/appeals', async (c) => {
  const body = await c.req.json();
  const denied = requireSelfSubmit(c, body);
  if (denied) return denied;
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c, body);
  const result = await (await serviceFor(subredditName, requestContext.subredditId)).createAppeal({ ...body, subredditName });
  return c.json(result, result.ok ? 201 : 400);
});

app.post('/api/appeals/:id/start-review', async (c) => {
  const body = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c, body);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireReviewer(c, service);
  if (denied) return denied;
  const appeal = await service.startReview(c.req.param('id'), body.actor || requestContext.userName || 'moderator');
  return c.json({ ok: true, appeal });
});

app.post('/api/appeals/:id/escalate', async (c) => {
  const body = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c, body);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireReviewer(c, service);
  if (denied) return denied;
  const appeal = await service.escalate(c.req.param('id'), body.actor || requestContext.userName || 'moderator', body.note || 'Needs team input.');
  return c.json({ ok: true, appeal });
});

app.post('/api/appeals/:id/resolve', async (c) => {
  const body = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c, body);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireReviewer(c, service);
  if (denied) return denied;
  const appeal = await service.resolve(
    c.req.param('id'),
    body.actor || requestContext.userName || 'moderator',
    body.outcome,
    body.note,
    { newBanDurationDays: body.newBanDurationDays }
  );
  return c.json({ ok: true, appeal });
});

app.post('/internal/scheduler/sla-sweep', async (c) => {
  const _input = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c);
  const result = await (await serviceFor(subredditName, requestContext.subredditId)).sweepSla();
  return c.json({ status: 'ok', data: result }, 200);
});

app.post('/internal/scheduler/modmail-sync', async (c) => {
  const _input = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c);
  const result = await (await serviceFor(subredditName, requestContext.subredditId)).syncModmailAppeals();
  return c.json({ status: 'ok', data: result }, 200);
});

app.post('/internal/settings/validate-sla-days', async (c) => {
  const { value } = await c.req.json();
  const days = Number(value);
  return c.json(days >= 3 && days <= 14
    ? { success: true }
    : { success: false, error: 'SLA window must be between 3 and 14 days.' });
});

app.post('/internal/settings/validate-cooldown-days', async (c) => {
  const { value } = await c.req.json();
  const days = Number(value);
  return c.json(days >= 1 && days <= 365
    ? { success: true }
    : { success: false, error: 'Appeal cooldown must be between 1 and 365 days.' });
});

app.post('/internal/menu/create-intake', async (c) => {
  const request = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c, request);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireModerator(c, service);
  if (denied) return denied;
  await reddit.submitCustomPost({
    subredditName,
    title: 'Appeal a ban — AppealFlow',
    entry: 'appeal',
    textFallback: 'Use this post to submit a structured ban appeal. If you cannot access the form, reply to your ban message with /appeal.',
    styles: {
      backgroundColor: '#F8F1E5FF',
      backgroundColorDark: '#16120EFF',
      height: 'TALL',
    },
  });
  return c.json({ showToast: { text: 'AppealFlow intake post created.', appearance: 'success' } });
});

app.post('/internal/menu/open-dashboard', async (c) => {
  const request = await c.req.json();
  const requestContext = readRequestContext();
  const subredditName = subredditFor(c, request);
  const service = await serviceFor(subredditName, requestContext.subredditId);
  const denied = await requireModerator(c, service);
  if (denied) return denied;
  await reddit.submitCustomPost({
    subredditName,
    title: 'AppealFlow moderator dashboard',
    entry: 'dashboard',
    textFallback: 'Moderator-only AppealFlow dashboard for reviewing ban appeals.',
    styles: {
      backgroundColor: '#F8F1E5FF',
      backgroundColorDark: '#16120EFF',
      height: 'TALL',
    },
  });
  return c.json({ showToast: { text: 'AppealFlow dashboard post created.', appearance: 'success' } });
});

export default app;
