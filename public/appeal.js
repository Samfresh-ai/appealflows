const form = document.querySelector('#appealForm');
const toast = document.querySelector('#toast');
const intakeStage = document.querySelector('#intakeStage');
const statusStage = document.querySelector('#statusStage');
const welcomeMessage = document.querySelector('#welcomeMessage');
const usernameField = document.querySelector('#username');
const userField = document.querySelector('.user-field');
const ruleSelect = document.querySelector('#rule');
const submitButton = document.querySelector('#submitButton');
const currentStamp = document.querySelector('#currentStamp');
const counters = [
  ['whatHappened', 'happenedCount'],
  ['reconsiderReason', 'reasonCount'],
  ['futureCommitment', 'futureCount'],
];

let lockedByStatus = false;
let settings = { slaDays: 7, upheldCooldownDays: 30 };

init();

for (const [fieldId, countId] of counters) {
  const field = document.getElementById(fieldId);
  const count = document.getElementById(countId);
  const sync = () => { count.textContent = String(field.value.trim().length); };
  field.addEventListener('input', sync);
  sync();
}

usernameField.addEventListener('blur', () => {
  if (usernameField.value.trim().length >= 2) checkStatus(usernameField.value.trim());
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (lockedByStatus) {
    showToast('This account cannot submit a new appeal yet.');
    return;
  }

  const payload = Object.fromEntries(new FormData(form));
  payload.source = 'custom-post';

  const errors = validate(payload);
  if (errors.length) {
    showToast(errors[0]);
    return;
  }

  setBusy(true);
  try {
    const result = await postJson('/api/appeals', payload);
    if (!result.ok) {
      if (result.existing) {
        renderStatusResult({
          status: result.code === 'COOLDOWN_ACTIVE' ? 'cooldown' : 'open',
          appeal: result.existing,
          nextEligibleAppealAt: result.nextEligibleAppealAt,
        });
        showToast(result.errors?.[0] || 'An existing appeal is still active.');
        return;
      }
      throw new Error(result.errors?.[0] || 'Appeal could not be submitted.');
    }
    renderSubmitted(result.appeal);
    setSubmissionLocked(true);
    showToast('Appeal submitted. You will get a clear answer when a moderator reviews it.');
  } catch (error) {
    showToast(`${error.message} Nothing was submitted.`);
  } finally {
    setBusy(false);
  }
});

async function init() {
  if (currentStamp) currentStamp.textContent = formatDateTime(new Date().toISOString());
  try {
    const intake = await getJson('/api/intake');
    if (intake.settings) settings = { ...settings, ...intake.settings };
    if (intake.settings?.welcomeMessage) welcomeMessage.textContent = intake.settings.welcomeMessage;
    populateRules(intake.rules || []);
    if (intake.currentUser) {
      usernameField.value = intake.currentUser;
      userField.classList.add('hidden');
      await checkStatus(intake.currentUser);
    }
  } catch {
    populateRules([]);
  }
}

async function checkStatus(username) {
  try {
    const result = await getJson(`/api/appeals/status?username=${encodeURIComponent(username)}`);
    if (result.status !== 'none') {
      renderStatusResult(result);
      setSubmissionLocked(result.status === 'open' || result.status === 'cooldown');
    } else {
      showIntake();
      setSubmissionLocked(false);
    }
  } catch {
    setSubmissionLocked(false);
  }
}

function populateRules(rules) {
  const options = [{ value: 'Not sure', label: 'Not sure' }, ...rules.filter((rule) => rule.value !== 'Not sure')];
  ruleSelect.innerHTML = options.map((rule) => `<option value="${escapeHtml(rule.value)}">${escapeHtml(rule.label)}</option>`).join('');
}

function validate(payload) {
  const checks = [
    ['username', 2, 40, 'Add your Reddit username.'],
    ['whatHappened', 100, 500, 'What happened needs 100-500 characters.'],
    ['reconsiderReason', 80, 500, 'The reconsideration reason needs 80-500 characters.'],
    ['futureCommitment', 40, 300, 'What you will do differently needs 40-300 characters.'],
  ];

  const errors = [];
  for (const [key, min, max, message] of checks) {
    const length = String(payload[key] || '').trim().length;
    if (length < min || length > max) errors.push(message);
  }
  if (payload.contentUrl && !/^https?:\/\/(www\.)?reddit\.com\//i.test(payload.contentUrl)) {
    errors.push('Use a Reddit URL, or leave the link blank.');
  }
  return errors;
}

function showIntake() {
  intakeStage.classList.remove('hidden');
  statusStage.classList.add('hidden');
}

function showStatus(html) {
  intakeStage.classList.add('hidden');
  statusStage.classList.remove('hidden');
  statusStage.innerHTML = html;
}

function renderSubmitted(appeal) {
  showStatus(`
    <div class="status-heading">
      <div>
        <h1>Appeal Received <span class="status-ok" aria-hidden="true"></span></h1>
        <p>We've received your appeal and it's now under review.</p>
      </div>
    </div>
    <div class="status-grid">
      <section class="status-main">
        <div class="receipt-card large">
          <div class="success-ring big" aria-hidden="true"></div>
          <div>
            <strong>Your appeal was received successfully.</strong>
            <b>You'll hear back within ${settings.slaDays || 7} days.</b>
          </div>
          <div class="mail-illustration" aria-hidden="true"></div>
        </div>
        ${progressMarkup(appeal, 'received')}
        ${summaryCard(appeal)}
        ${answersPreview(appeal, true)}
      </section>
      ${nextStepsAside('received')}
    </div>
    ${statusFooter('Back to Dashboard')}
  `);
}

function renderStatusResult(result) {
  const appeal = result.appeal;
  if (!appeal) return;
  if (appeal.state === 'CLOSED') {
    renderClosedAppeal(appeal, result.nextEligibleAppealAt || appeal.resolution?.nextEligibleAppealAt);
  } else {
    renderOpenAppeal(appeal);
  }
}

function renderOpenAppeal(appeal) {
  const sla = localSla(appeal);
  showStatus(`
    <div class="status-heading">
      <div>
        <h1>You already have an open appeal</h1>
        <p>You can't submit another appeal while your current one is in progress.</p>
      </div>
    </div>
    <div class="status-grid">
      <section class="status-main">
        <section class="open-hero">
          <div class="clock-ring" aria-hidden="true"></div>
          <div>
            <span>CURRENT STATUS</span>
            <strong>${escapeHtml(displayState(appeal.state))}</strong>
            <p>Your appeal is currently being reviewed by our team.</p>
          </div>
          <div class="sla-box">
            <span>SLA WINDOW</span>
            <strong>${escapeHtml(sla.label)}</strong>
            <small>of ${settings.slaDays || 7} days</small>
          </div>
          <footer>
            <p>Assigned on ${formatDate(appeal.history?.find((entry) => entry.to === 'ASSIGNED')?.at || appeal.updatedAt)}</p>
            <p>Assigned reviewer: ${escapeHtml(formatReviewer(appeal.assignedTo))}</p>
          </footer>
        </section>
        ${progressMarkup(appeal, 'open')}
        ${answersFull(appeal)}
        <section class="info-banner">
          <strong>Only one open appeal is allowed at a time</strong>
          <p>Please wait for a decision on your current appeal before submitting a new one.</p>
        </section>
      </section>
      <aside class="status-aside">
        ${detailsCard(appeal)}
        <section class="side-card blue-note">
          <strong>We're reviewing your appeal</strong>
          <p>Our team is carefully reviewing the details you submitted. You'll be notified here and via message when a decision has been made.</p>
        </section>
        ${nextStepsCard()}
      </aside>
    </div>
  `);
}

function renderClosedAppeal(appeal, nextEligible) {
  const upheld = appeal.outcome === 'UPHELD';
  const outcomeTitle = outcomeLabel(appeal.outcome);
  showStatus(`
    <div class="status-heading row-heading">
      <div>
        <h1>Appeal Outcome <span class="pill">Closed</span></h1>
        <p>Your appeal has been reviewed. Please see the results and next steps below.</p>
      </div>
      <p>Appeal ID: ${escapeHtml(appeal.id)}</p>
    </div>
    ${progressMarkup(appeal, 'closed')}
    <div class="status-grid">
      <section class="status-main">
        <section class="outcome-card ${upheld ? 'upheld' : 'positive'}">
          <div class="outcome-icon" aria-hidden="true"></div>
          <div>
            <span>FINAL DECISION</span>
            <strong>${escapeHtml(outcomeTitle)}</strong>
            <p>${escapeHtml(outcomeDescription(appeal.outcome))}</p>
          </div>
          <aside>
            <span>Reviewed on</span>
            <strong>${formatDateTime(appeal.resolution?.decidedAt || appeal.updatedAt)}</strong>
            <small>Reviewed by: ${escapeHtml(appeal.resolution?.decidedBy || 'Moderation Team')}</small>
          </aside>
        </section>
        <section class="status-card">
          <h2>Moderator Response</h2>
          <p>${escapeHtml(appeal.resolution?.note || 'This appeal has been reviewed and closed by the moderation team.')}</p>
        </section>
        ${nextEligibleCard(nextEligible)}
      </section>
      <aside class="status-aside">
        ${closedSummaryCard(appeal)}
        <section class="side-card">
          <h2>Community Rules & Guidance</h2>
          <p>Please review our rules to help keep our community safe and welcoming.</p>
          <div class="rule-links">
            <a href="#">Respectful and Civil Behavior</a>
            <a href="#">Harassment and Hate Speech</a>
            <a href="#">Appeals Policy</a>
          </div>
        </section>
      </aside>
    </div>
  `);
}

function progressMarkup(appeal, mode) {
  const items = [
    ['SUBMITTED', 'SUBMITTED'],
    ['ASSIGNED', 'ASSIGNED'],
    ['UNDER_REVIEW', 'UNDER REVIEW'],
    ['RESOLVED', 'RESOLVED'],
    ['CLOSED', 'CLOSED'],
  ];
  const activeIndex = progressIndex(appeal);
  return `
    <div class="status-timeline ${mode === 'closed' ? 'closed-progress' : ''}" aria-label="Appeal progress">
      ${items.map(([key, label], index) => {
        const done = index < activeIndex || (mode === 'closed' && index <= activeIndex);
        const current = index === activeIndex && mode !== 'closed';
        const date = stepDate(appeal, key);
        return `<span class="step ${done ? 'done' : ''} ${current ? 'current' : ''} ${mode === 'closed' && key === 'CLOSED' ? 'closed-step' : ''}">
          <b>${done ? '' : index + 1}</b>
          <strong>${label}</strong>
          <small>${escapeHtml(date)}</small>
        </span>`;
      }).join('')}
    </div>
  `;
}

function summaryCard(appeal) {
  return `
    <section class="status-card summary-card">
      <h2>Appeal Summary</h2>
      <div class="summary-grid">
        ${summaryItem('Appeal ID', appeal.id)}
        ${summaryItem('Submitted', formatDateTime(appeal.createdAt))}
        ${summaryItem('Expected response by', formatDateTime(appeal.slaDueAt), localSla(appeal).label)}
        ${summaryItem('Rule selected', appeal.intake?.rule || 'Not sure')}
      </div>
    </section>
  `;
}

function closedSummaryCard(appeal) {
  return `
    <section class="side-card">
      <h2>Appeal Summary <span>(Read-Only)</span></h2>
      <dl class="detail-list">
        ${detailItem('Appeal ID', appeal.id)}
        ${detailItem('Submitted', formatDateTime(appeal.createdAt))}
        ${detailItem('Ban Reason', appeal.context?.originalBanReason || appeal.intake?.rule || 'Not available')}
        ${detailItem('Ban Issued By', appeal.context?.originalModerator || 'Unavailable')}
        ${detailItem('Ban Date', formatDateTime(appeal.createdAt))}
        ${detailItem('Your Comment', shortText(appeal.intake?.whatHappened, 92))}
      </dl>
    </section>
  `;
}

function detailsCard(appeal) {
  return `
    <section class="side-card">
      <h2>Appeal details</h2>
      <dl class="detail-list">
        ${detailItem('Appeal ID', appeal.id)}
        ${detailItem('Subreddit', appeal.subredditName ? `r/${appeal.subredditName}` : 'Unavailable')}
        ${detailItem('Rule', appeal.intake?.rule || 'Not sure')}
        ${detailItem('Submitted on', formatDateTime(appeal.createdAt))}
        ${detailItem('Assigned reviewer', formatReviewer(appeal.assignedTo))}
        ${detailItem('Expected decision window', `${formatDate(appeal.createdAt)} - ${formatDate(appeal.slaDueAt)}`)}
      </dl>
    </section>
  `;
}

function answersPreview(appeal) {
  const rows = [
    ['1. Which post or comment got you banned?', appeal.intake?.contentUrl || 'Not provided'],
    ['2. Which rule applies to your situation?', appeal.intake?.rule || 'Not sure'],
    ['3. In your own words, what happened?', shortText(appeal.intake?.whatHappened, 70)],
  ];
  return `
    <section class="status-card answers-preview">
      <h2>Your Submitted Answers <span>(Preview)</span></h2>
      <div>
        ${rows.map(([label, value]) => `<p><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></p>`).join('')}
      </div>
      <button class="link-button" type="button">View all answers</button>
    </section>
  `;
}

function answersFull(appeal) {
  const rows = [
    ['1. Which post or comment got you banned? (optional)', linkOrText(appeal.intake?.contentUrl || 'Not provided')],
    ['2. Which rule applies to your situation?', escapeHtml(appeal.intake?.rule || 'Not sure')],
    ['3. In your own words, what happened?', escapeHtml(appeal.intake?.whatHappened || '')],
    ['4. Why do you think this decision should be reconsidered?', escapeHtml(appeal.intake?.reconsiderReason || '')],
    ['5. What will you do differently going forward?', escapeHtml(appeal.intake?.futureCommitment || '')],
  ];
  return `
    <section class="status-card submitted-answers">
      <h2>Your submitted appeal <span>Read-only</span></h2>
      <p>Here are the answers you provided when you submitted your appeal.</p>
      <div class="answer-table">
        ${rows.map(([label, value]) => `<div><strong>${label}</strong><p>${value}</p></div>`).join('')}
      </div>
    </section>
  `;
}

function nextStepsAside() {
  return `
    <aside class="status-aside">
      <section class="side-card next-panel">
        <h2>What happens next</h2>
        <p>Here's what to expect while we review your appeal.</p>
        ${nextStepsList()}
      </section>
      <section class="side-card care-card">
        <strong>We treat your information with care</strong>
        <p>Your appeal is private and only visible to the moderation team. We do not share it with other users.</p>
      </section>
    </aside>
  `;
}

function nextStepsCard() {
  return `
    <section class="side-card next-panel">
      <h2>What happens next?</h2>
      ${nextStepsList()}
    </section>
  `;
}

function nextStepsList() {
  return `
    <ol class="next-list">
      <li><strong>We'll review your appeal</strong><span>A moderator will review your submission based on the selected rule and context.</span></li>
      <li><strong>We'll notify you</strong><span>You'll receive a message once a decision has been made.</span></li>
      <li><strong>You can reply</strong><span>If you have additional information, reply directly to the decision message.</span></li>
    </ol>
  `;
}

function nextEligibleCard(nextEligible) {
  if (!nextEligible) {
    return `
      <section class="status-card next-eligible positive">
        <h2>Next Eligible Appeal</h2>
        <p>This outcome does not require an upheld-appeal cooldown.</p>
      </section>
    `;
  }
  return `
    <section class="status-card next-eligible">
      <h2>Next Eligible Appeal</h2>
      <p>Due to our appeal cooldown policy, you must wait before submitting another appeal.</p>
      <div>
        <span>You can submit another appeal on:</span>
        <strong>${formatDateTime(nextEligible)}</strong>
        <b>${daysUntil(nextEligible)} days remaining</b>
      </div>
    </section>
    <section class="locked-note">
      <strong>You cannot submit another appeal yet.</strong>
      <p>Please wait until ${formatDateTime(nextEligible)} to submit a new appeal.</p>
    </section>
  `;
}

function statusFooter(buttonText) {
  return `
    <footer class="status-footer">
      <p><span class="lock-dot" aria-hidden="true"></span>Your information is private and will only be seen by the moderation team. <a href="#">Learn more</a></p>
      <button class="primary-blue" type="button">${buttonText}</button>
    </footer>
  `;
}

function summaryItem(label, value, badge = '') {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Not available')}</strong>${badge ? `<b>${escapeHtml(badge)}</b>` : ''}</div>`;
}

function detailItem(label, value) {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Not available')}</dd>`;
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Request failed.');
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) return { ok: false, ...result };
  return result;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy || lockedByStatus;
  submitButton.innerHTML = isBusy ? 'Submitting...' : 'Submit Appeal <span aria-hidden="true">send</span>';
}

function setSubmissionLocked(isLocked) {
  lockedByStatus = isLocked;
  submitButton.disabled = isLocked;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3800);
}

function progressIndex(appeal) {
  if (appeal.state === 'CLOSED') return 4;
  if (appeal.outcome || ['UPHELD', 'REDUCED', 'OVERTURNED'].includes(appeal.state)) return 3;
  if (appeal.state === 'UNDER_REVIEW' || appeal.state === 'ESCALATED' || appeal.state === 'STALE') return 2;
  if (appeal.state === 'ASSIGNED') return 1;
  return 0;
}

function stepDate(appeal, key) {
  const history = appeal.history || [];
  if (key === 'RESOLVED') {
    return formatShortDate(appeal.resolution?.decidedAt || history.find((entry) => ['UPHELD', 'REDUCED', 'OVERTURNED'].includes(entry.to))?.at);
  }
  const hit = key === 'CLOSED' ? appeal.updatedAt : history.find((entry) => entry.to === key)?.at;
  if (hit) return formatShortDate(hit);
  return key === 'SUBMITTED' ? formatShortDate(appeal.createdAt) : 'Pending';
}

function localSla(appeal) {
  if (appeal.state === 'CLOSED') return { label: 'Closed', tone: 'neutral' };
  const hours = Math.round((new Date(appeal.slaDueAt) - Date.now()) / 36e5);
  if (!Number.isFinite(hours)) return { label: `${settings.slaDays || 7}d left`, tone: 'good' };
  if (hours < 0) return { label: `${Math.abs(hours)}h overdue`, tone: 'danger' };
  if (hours <= 24) return { label: `${hours}h left`, tone: 'warning' };
  const days = Math.ceil(hours / 24);
  return { label: `${days}d left`, tone: 'good' };
}

function displayState(value) {
  return String(value || 'SUBMITTED').replace(/_/g, ' ');
}

function outcomeLabel(value) {
  if (value === 'REDUCED') return 'BAN REDUCED';
  if (value === 'OVERTURNED') return 'BAN OVERTURNED';
  return 'BAN UPHELD';
}

function outcomeDescription(value) {
  if (value === 'REDUCED') return 'After review, the ban has been shortened.';
  if (value === 'OVERTURNED') return 'After review, the ban has been lifted.';
  return "After a thorough review, we've determined the ban should remain in place.";
}

function linkOrText(value) {
  if (/^https?:\/\//i.test(value)) {
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
  }
  return escapeHtml(value);
}

function shortText(value, max = 80) {
  const text = String(value || 'Not provided');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function daysUntil(value) {
  const diff = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
  return Math.max(0, diff);
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Pending';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatShortDate(value) {
  if (!value) return 'Pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Pending';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Pending';
  return date.toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatReviewer(value) {
  return value ? `u/${value}` : 'Not assigned yet';
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
