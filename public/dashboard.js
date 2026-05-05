const els = {
  analyticsSummary: document.querySelector('#analyticsSummary'),
  analyticsView: document.querySelector('#analyticsView'),
  settingsView: document.querySelector('#settingsView'),
  queueView: document.querySelector('#queueView'),
  metricStrip: document.querySelector('#metricStrip'),
  needsAction: document.querySelector('#needsAction'),
  teamQueue: document.querySelector('#teamQueue'),
  closedQueue: document.querySelector('#closedQueue'),
  needsCount: document.querySelector('#needsCount'),
  teamCount: document.querySelector('#teamCount'),
  closedCount: document.querySelector('#closedCount'),
  queueTotal: document.querySelector('#queueTotal'),
  detail: document.querySelector('#detail'),
  toast: document.querySelector('#toast'),
  modalRoot: document.querySelector('#modalRoot'),
  volumeChart: document.querySelector('#volumeChart'),
  outcomeBreakdown: document.querySelector('#outcomeBreakdown'),
  ruleDistribution: document.querySelector('#ruleDistribution'),
  perModStats: document.querySelector('#perModStats'),
  tabs: document.querySelectorAll('[data-view]'),
};

const EMPTY_DASHBOARD = Object.freeze({
  needsAction: [],
  teamQueue: [],
  closed: [],
  analytics: {
    open: 0,
    closed: 0,
    averageResponseHours: null,
    slaComplianceRate: null,
    outcomeBreakdown: [],
    volumeOverTime: [],
    ruleDistribution: [],
    perModStats: [],
  },
});

let state = structuredClone(EMPTY_DASHBOARD);
let activeId = null;
let activeView = 'queue';

els.tabs.forEach((button) => {
  button.addEventListener('click', () => {
    activeView = button.dataset.view;
    render();
  });
});

init();

async function init() {
  try {
    const response = await fetch('/api/dashboard');
    if (!response.ok) {
      const error = await safeJson(response);
      throw new Error(error.error || 'Live dashboard unavailable.');
    }
    state = await response.json();
    render();
  } catch {
    state = structuredClone(EMPTY_DASHBOARD);
    render('Live Devvit data is not available in this view. Real appeal records will appear here after installation.');
  }
}

function render(emptyReason = '') {
  renderView();
  renderMetricStrip(state.analytics);
  renderAnalytics(state.analytics);
  renderColumn(els.needsAction, state.needsAction, 'needs');
  renderColumn(els.teamQueue, state.teamQueue, 'team');
  renderColumn(els.closedQueue, state.closed, 'closed');

  els.needsCount.textContent = state.needsAction.length;
  els.teamCount.textContent = state.teamQueue.length;
  els.closedCount.textContent = state.closed.length;
  els.queueTotal.textContent = state.needsAction.length + state.teamQueue.length;

  const active = findAppeal(activeId) || state.needsAction[0] || state.teamQueue[0] || state.closed[0];
  if (active) {
    renderDetail(active);
  } else {
    renderEmptyDetail(emptyReason);
  }
}

function renderView() {
  els.queueView.classList.toggle('hidden', activeView !== 'queue');
  els.analyticsView.classList.toggle('hidden', activeView !== 'analytics');
  els.settingsView.classList.toggle('hidden', activeView !== 'settings');
  els.tabs.forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
}

function renderMetricStrip(analytics) {
  const outcomes = analytics.outcomeBreakdown || [];
  const rules = analytics.ruleDistribution || [];
  const hasClosed = Number(analytics.closed || 0) > 0;
  els.metricStrip.innerHTML = `
    <article class="metric-card">
      <span>Avg Response Time</span>
      <strong>${formatDays(analytics.averageResponseHours)}</strong>
      <small class="trend">${hasClosed ? 'calculated from closed appeals' : 'No closed appeals yet'}</small>
      ${sparkline(analytics.volumeOverTime)}
    </article>
    <article class="metric-card">
      <span>Outcome Breakdown</span>
      <div class="donut-row">
        ${donutMarkup(outcomes)}
        ${legendMarkup(outcomes)}
      </div>
    </article>
    <article class="metric-card">
      <span>SLA Compliance</span>
      <strong>${formatMetric(analytics.slaComplianceRate, '%')}</strong>
      <small class="trend">${hasClosed ? 'calculated from closed appeals' : 'No SLA history yet'}</small>
      <div class="progress-bar"><span style="width:${clampPercent(analytics.slaComplianceRate)}%"></span></div>
    </article>
    <article class="metric-card">
      <span>Rule Distribution</span>
      ${barRows(rules.slice(0, 4))}
    </article>
  `;
}

function renderAnalytics(analytics) {
  const summaryCards = [
    ['Avg Response Time', formatDays(analytics.averageResponseHours), analytics.closed ? 'calculated from closed appeals' : 'No closed appeals yet'],
    ['Appeal Volume', totalVolume(analytics.volumeOverTime), analytics.volumeOverTime?.length ? 'live volume history' : 'No volume history yet'],
    ['Outcome Breakdown', totalOutcomes(analytics.outcomeBreakdown), 'total resolved appeals'],
    ['SLA Compliance', formatMetric(analytics.slaComplianceRate, '%'), `${analytics.closed || 0} closed appeals`],
    ['Per-Mod Performance', efficiencyFromStats(analytics.perModStats), 'overall efficiency'],
  ];
  els.analyticsSummary.innerHTML = summaryCards.map(([label, value, trend]) => `
    <article class="metric-card analytics-top">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small class="trend up">${escapeHtml(trend)}</small>
      ${sparkline(analytics.volumeOverTime)}
    </article>
  `).join('');

  renderVolumeChart(analytics.volumeOverTime || []);
  renderOutcomePanel(analytics.outcomeBreakdown || []);
  renderRuleDistribution(analytics.ruleDistribution || []);
  renderModeratorStats(analytics.perModStats || []);
}

function renderVolumeChart(points) {
  if (!points.length) {
    els.volumeChart.innerHTML = '<p class="empty-copy">No appeal volume yet.</p>';
    return;
  }
  const max = Math.max(...points.map((point) => point.count), 1);
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
    const y = 92 - (point.count / max) * 76;
    return `${x},${y}`;
  }).join(' ');
  els.volumeChart.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="2.5" />
    </svg>
    <div class="chart-axis">
      ${points.map((point) => `<span>${escapeHtml(point.label)}</span>`).join('')}
    </div>
    <div class="chart-total">
      <p><span>This Period</span><strong>${totalVolume(points)}</strong></p>
      <p><span>Data points</span><strong>${points.length}</strong></p>
    </div>
  `;
}

function renderOutcomePanel(rows) {
  if (!rows.length) {
    els.outcomeBreakdown.innerHTML = '<p class="empty-copy">No outcome data yet.</p>';
    return;
  }
  els.outcomeBreakdown.innerHTML = `
    <div class="donut-large-wrap">
      ${donutMarkup(rows, 'large')}
      ${legendMarkup(rows, true)}
    </div>
    <button class="view-report" type="button">View full report</button>
  `;
}

function renderRuleDistribution(rows) {
  if (!rows.length) {
    els.ruleDistribution.innerHTML = '<p class="empty-copy">No rule data yet.</p>';
    return;
  }
  els.ruleDistribution.innerHTML = `${barRows(rows, true)}<button class="view-report" type="button">View full report</button>`;
}

function renderModeratorStats(rows) {
  if (!rows.length) {
    els.perModStats.innerHTML = '<p class="empty-copy">No reviewer data yet.</p>';
    return;
  }
  els.perModStats.innerHTML = `
    <div class="mod-table">
      <div class="mod-row head"><span>#</span><span>Moderator</span><span>Resolved</span><span>Avg Response Time</span><span>SLA</span><span>Efficiency</span></div>
      ${rows.slice(0, 6).map((row, index) => `
        <div class="mod-row">
          <span>${index + 1}</span>
          <strong><span class="avatar small">${initials(row.reviewer)}</span>u/${escapeHtml(row.reviewer || 'Mod')}</strong>
          <span>${escapeHtml(row.handled ?? 0)}</span>
          <span>${formatDays(row.averageResponseHours)}</span>
          <span><b class="mini-progress"><i style="width:${clampPercent(row.slaComplianceRate ?? 90)}%"></i></b></span>
          <span>${clampPercent(row.efficiency ?? row.slaComplianceRate ?? 85)}%</span>
        </div>
      `).join('')}
    </div>
    <button class="view-report" type="button">View full leaderboard</button>
  `;
}

function renderColumn(node, appeals, lane) {
  if (!appeals.length) {
    node.innerHTML = `<p class="empty-copy">No ${lane === 'closed' ? 'resolved' : 'live'} cases in this lane.</p>`;
    return;
  }
  node.innerHTML = appeals.map((appeal) => card(appeal, lane)).join('');
  node.querySelectorAll('.case-card').forEach((cardNode) => {
    cardNode.addEventListener('click', () => {
      activeId = cardNode.dataset.id;
      renderDetail(findAppeal(activeId));
      document.querySelectorAll('.case-card').forEach((item) => item.classList.toggle('active', item.dataset.id === activeId));
    });
  });
}

function card(appeal, lane) {
  const sla = appeal.sla || localSla(appeal);
  const preview = appeal.intake?.reconsiderReason || appeal.intake?.whatHappened || 'No appeal text was captured.';
  const compact = lane === 'closed' ? 'compact-card' : '';
  return `
    <button class="case-card ${compact} ${appeal.id === activeId ? 'active' : ''}" data-id="${escapeHtml(appeal.id)}">
      <span class="case-top">
        <span><i class="avatar small">${initials(appeal.username)}</i>u/${escapeHtml(appeal.username)}</span>
        <b class="sla-badge ${escapeHtml(sla.tone)}">${escapeHtml(sla.label)}</b>
      </span>
      <span class="case-meta">Rule: ${escapeHtml(appeal.intake?.rule || appeal.context?.originalBanReason || 'Not sure')}</span>
      <span class="case-meta">${lane === 'closed' ? 'Resolved' : 'Submitted'} ${relativeDate(appeal.createdAt)}</span>
      <span class="preview">${escapeHtml(shortText(preview, lane === 'closed' ? 56 : 104))}</span>
    </button>
  `;
}

function renderDetail(appeal) {
  if (!appeal) return;
  activeId = appeal.id;
  const isClosed = appeal.state === 'CLOSED';
  const canAct = canActOnAppeal(appeal);
  els.detail.innerHTML = `
    <header class="detail-head">
      <button class="back-button" type="button" aria-label="Back"></button>
      <h2>Appeal #${escapeHtml(appeal.id)}</h2>
      <button class="close-button" type="button" aria-label="Close"></button>
    </header>
    <div class="detail-body">
      <section class="appeal-answers">
        <h3>Appeal Answers</h3>
        ${answer('1. Which post or comment got you banned?', linkOrText(appeal.intake?.contentUrl || 'Not provided'), true)}
        ${answer('2. Which rule applies to your situation?', escapeHtml(appeal.intake?.rule || 'Not sure'))}
        ${answer('3. In your own words, what happened?', escapeHtml(appeal.intake?.whatHappened || ''))}
        ${answer('4. Why do you think this decision should be reconsidered?', escapeHtml(appeal.intake?.reconsiderReason || ''))}
        ${answer('5. What will you do differently going forward?', escapeHtml(appeal.intake?.futureCommitment || ''))}
      </section>
      <aside class="context-package">
        <h3>Context Package</h3>
        ${contextRow('Original Ban Reason', appeal.context?.originalBanReason || appeal.intake?.rule || 'Not available')}
        ${contextRow('Issued By', appeal.context?.originalModerator || 'Unknown')}
        ${contextRow('Issued On', formatDateTime(appeal.createdAt))}
        ${contextRow('Post/Comment', linkOrText(appeal.context?.triggeringContent || appeal.intake?.contentUrl || 'Not provided'), true)}
        ${contextRow('Account Age', accountAge(appeal.context))}
        ${contextRow('Karma', karmaTotal(appeal.context))}
        ${contextRow('Prior Warnings', appeal.context?.priorWarnings ?? 0)}
        ${redFlags(appeal.context?.redFlags || [])}
      </aside>
    </div>
    ${isClosed ? closedDetail(appeal) : canAct ? actionBlock() : readOnlyBlock(appeal)}
  `;

  if (!isClosed && canAct) wireActions(appeal);
}

function renderEmptyDetail(reason) {
  els.detail.innerHTML = `
    <section class="empty-detail">
      <h2>No case selected</h2>
      <p>${escapeHtml(reason || 'When a banned user submits an appeal, it will appear here with its Reddit context, SLA, owner, and valid actions.')}</p>
    </section>
  `;
}

function answer(label, value, isHtml = false) {
  return `<div class="answer-block"><strong>${escapeHtml(label)}</strong><p>${isHtml ? value : escapeHtml(value)}</p></div>`;
}

function contextRow(label, value, isHtml = false) {
  return `<div class="context-row"><span>${escapeHtml(label)}</span><strong>${isHtml ? value : escapeHtml(value)}</strong></div>`;
}

function redFlags(flags) {
  if (!flags.length) return '<div class="context-row"><span>Red Flags</span><strong>None</strong></div>';
  return `
    <div class="context-row flags-row">
      <span>Red Flags</span>
      <strong>${flags.map((flag) => `<b>${escapeHtml(flag)}</b>`).join('')}</strong>
    </div>
  `;
}

function actionBlock() {
  return `
    <footer class="decision-panel">
      <div class="decision-actions">
        <button class="action-button uphold" data-action="UPHELD" type="button">UPHOLD BAN</button>
        <button class="action-button reduce" data-action="REDUCED" type="button">REDUCE</button>
        <button class="action-button overturn" data-action="OVERTURNED" type="button">OVERTURN</button>
        <button class="action-button escalate" data-action="ESCALATE" type="button">ESCALATE</button>
      </div>
      <label class="response-note">
        <span>Response note (visible to user)</span>
        <textarea id="decisionNote" placeholder="Explain your decision to the user..."></textarea>
      </label>
      <div class="decision-confirm-row">
        <label><input id="sendModmail" type="checkbox" checked /> Send modmail notification</label>
        <button id="confirmDecision" class="primary-blue" type="button">Confirm Decision</button>
      </div>
    </footer>
  `;
}

function closedDetail(appeal) {
  return `
    <footer class="decision-panel closed-decision">
      <strong>${escapeHtml(appeal.outcome || 'CLOSED')}</strong>
      <p>${escapeHtml(appeal.resolution?.note || 'This case has been resolved.')}</p>
    </footer>
  `;
}

function readOnlyBlock(appeal) {
  return `
    <footer class="decision-panel closed-decision">
      <strong>READ ONLY</strong>
      <p>This appeal is assigned to u/${escapeHtml(appeal.assignedTo || 'another reviewer')}. Team visibility is preserved, but actions are limited to the assigned reviewer or escalated queue.</p>
    </footer>
  `;
}

function wireActions(appeal) {
  const noteBox = els.detail.querySelector('#decisionNote');
  const confirmButton = els.detail.querySelector('#confirmDecision');
  let selectedAction = '';

  els.detail.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === 'REDUCED') {
        openReduceModal(appeal);
        return;
      }
      selectedAction = action;
      els.detail.querySelectorAll('[data-action]').forEach((item) => item.classList.toggle('selected', item === button));
      if (!noteBox.value.trim()) noteBox.value = noteTemplate(action);
    });
  });

  confirmButton.addEventListener('click', () => {
    if (!selectedAction) {
      showToast('Choose an action before confirming.');
      return;
    }
    if (!noteBox.value.trim()) noteBox.value = noteTemplate(selectedAction);
    openConfirmModal(appeal, selectedAction, noteBox.value.trim());
  });
}

function openConfirmModal(appeal, action, note) {
  const actionLabel = action === 'OVERTURNED' ? 'Overturn Ban' : action === 'ESCALATE' ? 'Escalate Appeal' : 'Uphold Ban';
  const confirmClass = action === 'OVERTURNED' ? 'overturn' : action === 'ESCALATE' ? 'escalate' : 'uphold';
  openModal(`
    <section class="modal-card">
      <button class="modal-close" type="button" data-close-modal aria-label="Close"></button>
      <header class="modal-head ${confirmClass}">
        <span aria-hidden="true"></span>
        <div>
          <h2>Confirm ${escapeHtml(actionLabel)}</h2>
          <p>${escapeHtml(confirmationCopy(action))}</p>
        </div>
      </header>
      <section class="modal-summary">
        <h3>Appeal Summary</h3>
        <div class="modal-grid">
          <p><span>User</span><strong>u/${escapeHtml(appeal.username)}</strong></p>
          <p><span>Appeal ID</span><strong>${escapeHtml(appeal.id)}</strong></p>
          <p><span>Rule Violated</span><strong>${escapeHtml(appeal.intake?.rule || 'Not sure')}</strong></p>
          <p><span>Banned On</span><strong>${formatDateTime(appeal.createdAt)}</strong></p>
        </div>
        <div class="modal-preview">
          <span>User Statement (Preview)</span>
          <p>${escapeHtml(shortText(appeal.intake?.whatHappened, 150))}</p>
        </div>
        <div class="modal-preview">
          <span>Reviewer Note (Preview)</span>
          <p>${escapeHtml(note)}</p>
        </div>
      </section>
      <label class="modal-check"><input type="checkbox" checked /> Send modmail notification to the user</label>
      <footer class="modal-actions">
        <button class="modal-cancel" type="button" data-close-modal>Cancel</button>
        <button class="modal-confirm ${confirmClass}" type="button" data-confirm-action>Confirm ${escapeHtml(actionLabel)}</button>
      </footer>
    </section>
  `);
  els.modalRoot.querySelector('[data-confirm-action]').addEventListener('click', () => takeAction(appeal, action, note));
}

function openReduceModal(appeal) {
  openModal(`
    <section class="modal-card reduce-modal">
      <button class="modal-close" type="button" data-close-modal aria-label="Close"></button>
      <header class="modal-head reduce">
        <span aria-hidden="true"></span>
        <div>
          <h2>Reduce Ban Duration</h2>
          <p>Reduce the ban length for this user. They will be notified of the new expiry date.</p>
        </div>
      </header>
      <div class="duration-picker" aria-label="Choose a reduction">
        <button class="selected" type="button" data-days="7">7 days</button>
        <button type="button" data-days="30">30 days</button>
        <button type="button" data-days="90">90 days</button>
        <button type="button" data-days="custom">Custom</button>
      </div>
      <label class="duration-input">
        <span>New ban duration</span>
        <input id="customDays" type="number" min="1" max="365" value="7" />
      </label>
      <div class="duration-preview">
        <span>The user's ban will expire on:</span>
        <strong id="expiryPreview">${formatDateTime(addDays(new Date(), 7).toISOString())}</strong>
      </div>
      <label class="response-note">
        <span>Response note (required)</span>
        <textarea id="reduceNote" maxlength="500" placeholder="Explain why you are reducing the ban duration...">${noteTemplate('REDUCED')}</textarea>
      </label>
      <p class="modal-info">The user will be notified via modmail with their new ban expiry date and the reason for this change.</p>
      <footer class="modal-actions">
        <button class="modal-cancel" type="button" data-close-modal>Cancel</button>
        <button class="modal-confirm reduce" type="button" data-apply-reduction>Apply Reduction</button>
      </footer>
    </section>
  `);

  const customDays = els.modalRoot.querySelector('#customDays');
  const expiryPreview = els.modalRoot.querySelector('#expiryPreview');
  const buttons = els.modalRoot.querySelectorAll('[data-days]');

  const sync = (days) => {
    const value = Number(days || customDays.value || 7);
    customDays.value = String(value);
    expiryPreview.textContent = formatDateTime(addDays(new Date(), value).toISOString());
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      buttons.forEach((item) => item.classList.toggle('selected', item === button));
      if (button.dataset.days !== 'custom') sync(button.dataset.days);
      customDays.focus();
    });
  });
  customDays.addEventListener('input', () => sync(customDays.value));
  els.modalRoot.querySelector('[data-apply-reduction]').addEventListener('click', () => {
    const note = els.modalRoot.querySelector('#reduceNote').value.trim();
    const days = Number(customDays.value || 7);
    if (!note) {
      showToast('Write a response note before reducing a ban.');
      return;
    }
    if (!Number.isFinite(days) || days < 1) {
      showToast('Choose a valid reduced duration.');
      return;
    }
    takeAction(appeal, 'REDUCED', note, days);
  });
}

function openModal(html) {
  els.modalRoot.innerHTML = html;
  els.modalRoot.classList.remove('hidden');
  els.modalRoot.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  els.modalRoot.addEventListener('click', (event) => {
    if (event.target === els.modalRoot) closeModal();
  }, { once: true });
}

function closeModal() {
  els.modalRoot.classList.add('hidden');
  els.modalRoot.innerHTML = '';
}

async function takeAction(appeal, action, note, durationDays) {
  try {
    const endpoint = action === 'ESCALATE' ? `/api/appeals/${appeal.id}/escalate` : `/api/appeals/${appeal.id}/resolve`;
    const payload = action === 'ESCALATE'
      ? { note }
      : { outcome: action, note, newBanDurationDays: action === 'REDUCED' ? durationDays : undefined };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = await safeJson(response);
      throw new Error(error.error || 'Live action failed.');
    }
    closeModal();
    showToast('Action saved. The user notification has been queued.');
    await init();
  } catch (error) {
    showToast(`${error.message} Nothing was changed.`);
  }
}

function noteTemplate(action) {
  if (action === 'OVERTURNED') return 'After reviewing the context and your appeal, we are overturning this ban. Please reread the community rules before participating again.';
  if (action === 'REDUCED') return 'After reviewing the context and your appeal, we are reducing the ban. The original decision had a basis, but a shorter restriction is enough here.';
  if (action === 'ESCALATE') return 'This appeal needs another moderator to review the context before a final decision is sent.';
  return 'After reviewing the context and your appeal, the original moderation decision still stands.';
}

function confirmationCopy(action) {
  if (action === 'OVERTURNED') return "You are about to overturn this ban. This will lift the user's restriction and send a modmail notification with your decision.";
  if (action === 'ESCALATE') return 'You are about to move this appeal to the team queue for another moderator to review.';
  return 'You are about to uphold this ban. This will close the appeal and notify the user.';
}

function localSla(appeal) {
  if (appeal.state === 'CLOSED') return { label: 'Uphold', tone: 'good' };
  const hours = Math.round((new Date(appeal.slaDueAt) - Date.now()) / 36e5);
  if (!Number.isFinite(hours)) return { label: '5 days', tone: 'good' };
  if (hours < 0) return { label: 'Overdue', tone: 'danger' };
  if (hours <= 48) return { label: `${Math.max(1, Math.ceil(hours / 24))} days`, tone: 'warning' };
  return { label: `${Math.ceil(hours / 24)} days`, tone: 'good' };
}

function findAppeal(id) {
  return [...state.needsAction, ...state.teamQueue, ...state.closed].find((appeal) => appeal.id === id);
}

function canActOnAppeal(appeal) {
  return state.needsAction.some((item) => item.id === appeal.id) || !appeal.assignedTo || appeal.state === 'ESCALATED' || appeal.state === 'STALE';
}

function donutMarkup(rows, size = '') {
  const colors = ['#3f7cff', '#4bc6c8', '#ff714f', '#8d5cf6', '#77c65a'];
  let cursor = 0;
  const segments = rows.length
    ? rows.map((row, index) => {
      const percent = Number(row.percent ?? row.value ?? 0);
      const start = cursor;
      cursor += percent;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    }).join(', ')
    : '#233246 0% 100%';
  return `<div class="donut ${size}" style="background: conic-gradient(${segments});"><span>${size ? totalOutcomes(rows) : ''}</span></div>`;
}

function legendMarkup(rows, includeCounts = false) {
  if (!rows.length) return '<p class="empty-copy">No outcomes yet.</p>';
  return `
    <div class="legend-list">
      ${rows.slice(0, 5).map((row, index) => `
        <p><i style="--dot:${legendColor(index)}"></i><span>${escapeHtml(outcomeName(row.outcome || row.label))}</span><strong>${escapeHtml(row.percent ?? row.value ?? 0)}%${includeCounts && row.count ? ` (${escapeHtml(row.count)})` : ''}</strong></p>
      `).join('')}
    </div>
  `;
}

function barRows(rows, withCounts = false) {
  if (!rows.length) return '<p class="empty-copy">No rule data yet.</p>';
  return `
    <div class="bar-rows">
      ${rows.map((row) => `
        <p>
          <span>${escapeHtml(row.label || row.rule || 'Other')}</span>
          <b><i style="width:${clampPercent(row.percent ?? row.value ?? 0)}%"></i></b>
          <strong>${escapeHtml(row.percent ?? row.value ?? 0)}%${withCounts && row.count ? ` (${escapeHtml(row.count)})` : ''}</strong>
        </p>
      `).join('')}
    </div>
  `;
}

function sparkline(points = []) {
  if (!points.length) return '<div class="sparkline empty-sparkline" aria-hidden="true"></div>';
  const values = points.map((point) => point.count);
  const max = Math.max(...values, 1);
  return `<div class="sparkline">${values.map((value) => `<i style="height:${Math.max(18, (value / max) * 100)}%"></i>`).join('')}</div>`;
}

function linkOrText(value) {
  if (/^https?:\/\//i.test(value)) {
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
  }
  return escapeHtml(value);
}

function accountAge(context = {}) {
  if (context.accountAgeDays) {
    const years = Math.floor(context.accountAgeDays / 365);
    const months = Math.floor((context.accountAgeDays % 365) / 30);
    if (years) return `${years}y ${months}m`;
    return `${months || 1}m`;
  }
  return 'Not available';
}

function karmaTotal(context = {}) {
  const total = Number(context.linkKarma || 0) + Number(context.commentKarma || 0) + Number(context.subredditKarma || 0);
  return total ? total.toLocaleString() : 'Not available';
}

function initials(name = '') {
  const cleaned = String(name).replace(/^u\//, '').replace(/[^a-z0-9]/gi, '');
  return (cleaned.slice(0, 2) || 'AF').toUpperCase();
}

function shortText(value, max = 80) {
  const text = String(value || 'Not provided');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function relativeDate(value) {
  const created = new Date(value).getTime();
  if (!Number.isFinite(created)) return 'recently';
  const days = Math.max(0, Math.round((Date.now() - created) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatMetric(value, suffix) {
  return value === null || value === undefined ? '--' : `${value}${suffix}`;
}

function formatDays(hours) {
  if (hours === null || hours === undefined) return '--';
  const days = Number(hours) / 24;
  if (!Number.isFinite(days)) return '--';
  return `${days.toFixed(days >= 10 ? 0 : 1)} days`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function totalVolume(points = []) {
  const total = points.reduce((sum, point) => sum + Number(point.count || 0), 0);
  return total ? total.toLocaleString() : '0';
}

function totalOutcomes(rows = []) {
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return total ? total.toLocaleString() : '0';
}

function efficiencyFromStats(rows = []) {
  if (!rows.length) return '--';
  const values = rows.map((row) => Number(row.efficiency ?? row.slaComplianceRate ?? 0)).filter(Number.isFinite);
  if (!values.length) return '--';
  return `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}%`;
}

function outcomeName(value) {
  return String(value || 'Other').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function legendColor(index) {
  return ['#3f7cff', '#4bc6c8', '#ff714f', '#8d5cf6', '#77c65a'][index % 5];
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  setTimeout(() => els.toast.classList.add('hidden'), 3600);
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
