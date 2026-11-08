const $ = (selector) => document.querySelector(selector);

const STATUS_LABELS = {
  completed: 'Paid',
  blocked: 'Blocked',
  pending: 'Needs approval',
  authorized: 'Cleared',
  denied: 'Denied',
  canceled: 'Canceled',
  refunded: 'Refunded',
};
const ACTOR_LABELS = { customer: 'You', agent: 'Agent', guard: 'Guard', payment: 'Test payment', refund: 'Refunds', reminder: 'Reminder', clock: 'Test clock', merchant: 'Merchant' };
const DAY_MS = 24 * 60 * 60 * 1000;
const PARENT_TABS = { report: 'activity', refund: 'refunds', purchase: 'agent', merchants: 'agent' };

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const toCents = (value) => Math.round(Number(value) * 100);
const time = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const day = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const dayAndTime = (iso) => `${day(iso)}, ${new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

let state = null;
let formDirty = false;
let renderedRules = '';
let currentTab = 'rules';
let reportPurchaseId = null;
let openRefundId = null;
let openPurchaseId = null;
let purchaseReturnTab = 'agent';
const seenPending = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function image(className, src, alt = '') {
  const node = el('img', className);
  node.src = src;
  node.alt = alt;
  return node;
}

function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

let toastTimer;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3500);
}

async function post(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

async function act(path, body, success) {
  try {
    await post(path, body);
    if (success) toast(success);
  } catch (error) {
    toast(error.message);
  }
}

function showTab(name) {
  currentTab = name;
  const navTab = PARENT_TABS[name] ?? name;
  document.querySelectorAll('.screen').forEach((screen) => { screen.hidden = screen.id !== `tab-${name}`; });
  document.querySelectorAll('.tabs button').forEach((node) => {
    if (node.dataset.tab === navTab) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function refundFor(purchaseId) {
  return state.refunds.find((refund) => refund.purchaseId === purchaseId);
}

function openRefund(id) {
  openRefundId = id;
  renderRefundDetail();
  showTab('refund');
}

function openReport(purchaseId) {
  const purchase = state.purchases.find((p) => p.id === purchaseId);
  reportPurchaseId = purchaseId;
  const charged = purchase.status === 'completed';
  $('#report-summary').textContent = charged
    ? `${purchase.item}, ${money(purchase.amountCents)} at ${purchase.merchantName}.`
    : `${purchase.item} at ${purchase.merchantName}. Nothing was charged for this purchase, so there is nothing to refund, but you can still report it.`;
  $('#report-form').reset();
  showTab('report');
}

function reportOrView(purchaseId) {
  const refund = refundFor(purchaseId);
  if (refund) openRefund(refund.id);
  else openReport(purchaseId);
}

const wasCharged = (purchase) => ['completed', 'refunded'].includes(purchase.status);

function openPurchase(id) {
  openPurchaseId = id;
  purchaseReturnTab = currentTab;
  renderPurchaseDetail();
  showTab('purchase');
}

function purchaseCard(purchase) {
  const card = el('li', purchase.flagged ? 'card flagged' : 'card');
  const row = el('div', 'card-row');
  row.append(el('strong', '', purchase.item), el('span', 'amount', money(purchase.amountCents)));
  const info = el('div', 'product-info');
  info.append(row, el('p', 'description', purchase.description));
  const details = [purchase.color && `Color: ${purchase.color}`, purchase.size && `Size: ${purchase.size}`].filter(Boolean);
  if (details.length) {
    const chips = el('p', 'chips');
    chips.append(...details.map((detail) => el('span', 'chip', detail)));
    info.append(chips);
  }
  const product = el('div', 'product');
  product.append(image('product-image', purchase.image), info);

  const merchant = el('span', 'merchant');
  merchant.append(
    image('logo', purchase.merchantLogo),
    el('span', 'muted', purchase.overreach ? `${purchase.merchantName} · Overreach test` : purchase.merchantName),
  );
  const meta = el('div', 'card-row meta');
  meta.append(merchant, el('span', `tag ${purchase.flagged ? 'flag' : purchase.status}`, purchase.flagged ? 'Flagged' : STATUS_LABELS[purchase.status]));
  card.append(product, meta);
  if (purchase.reason) card.append(el('p', 'reason', purchase.reason));
  if (wasCharged(purchase)) card.append(button('link', 'View purchase details', () => openPurchase(purchase.id)));
  return card;
}

function detailList(rows) {
  const list = el('dl', 'details');
  rows.filter(([, value]) => value).forEach(([label, value]) => {
    const row = el('div', 'detail-row');
    row.append(el('dt', '', label), el('dd', '', value));
    list.append(row);
  });
  return list;
}

function renderPurchaseDetail() {
  const purchase = state?.purchases.find((p) => p.id === openPurchaseId);
  if (!purchase) {
    $('#purchase-detail').replaceChildren();
    return;
  }
  const item = el('div', 'card');
  item.append(
    image('hero-image', purchase.image, purchase.item),
    el('h3', 'detail-name', purchase.item),
    el('p', 'description', purchase.description),
    detailList([
      ['Price paid', money(purchase.amountCents)],
      ['Quoted price', purchase.originalCents ? money(purchase.originalCents) : null],
      ['Color', purchase.color],
      ['Size', purchase.size],
      ['Purchased', dayAndTime(purchase.settledAt ?? purchase.at)],
      ['Status', purchase.flagged ? 'Flagged' : STATUS_LABELS[purchase.status]],
      ['Agent company', purchase.agentCompanyName],
    ]),
  );

  const seller = el('div', 'card');
  const merchant = state.merchants.find((m) => m.id === purchase.merchantId);
  const head = el('div', 'merchant-head');
  const name = el('div');
  name.append(el('strong', '', purchase.merchantName));
  if (merchant) name.append(el('p', 'muted', merchant.category));
  head.append(image('logo large', purchase.merchantLogo), name);
  seller.append(head);
  if (merchant) {
    seller.append(
      el('p', 'description', merchant.about),
      detailList([['Address', merchant.location], ['Support', merchant.support], ['Returns', merchant.returns]]),
    );
  } else {
    seller.append(el('p', 'description', 'No merchant information is available for this charge.'));
  }

  const report = button('button wide spaced', refundFor(purchase.id) ? 'View refund request' : 'Report a problem', () => reportOrView(purchase.id));
  $('#purchase-detail').replaceChildren(item, el('h3', '', 'Merchant'), seller, report);
}

function approvalCard(purchase) {
  const card = purchaseCard(purchase);
  card.classList.add('approval');
  const daysLeft = Math.ceil((Date.parse(purchase.expiresAt) - Date.parse(state.now)) / DAY_MS);
  const countdown = purchase.reminder ?? `This request expires in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
  card.append(el('p', 'countdown', `${countdown}, on ${day(purchase.expiresAt)}.`));
  card.append(el('p', 'reason', `If approved, ${money(state.remainingCents)} of your budget stays available.`));
  const actions = el('div', 'actions');
  const decide = (approve) => async () => {
    actions.querySelectorAll('button').forEach((node) => { node.disabled = true; });
    await act(`/api/purchases/${purchase.id}/decision`, { approve }, approve ? 'Approved.' : 'Denied.');
  };
  actions.append(button('button danger', 'Deny', decide(false)), button('button primary', 'Approve', decide(true)));
  card.append(actions);
  return card;
}

function renderHeader() {
  const { access, paused, rules, spentCents, heldCents, remainingCents } = state;
  $('#access-dot').classList.toggle('on', access.active && !paused);
  let accessText = 'Agent has no access';
  if (paused) accessText = 'Agent paused';
  else if (access.active) accessText = `Active · ${access.token}`;
  $('#access-text').textContent = accessText;
  const accessButton = $('#access-button');
  accessButton.disabled = false;
  accessButton.textContent = access.active ? 'Revoke access' : 'Give access';
  accessButton.className = access.active ? 'button danger' : 'button primary';

  const percent = (cents) => (rules.budgetCents ? Math.min(100, (cents / rules.budgetCents) * 100) : 0);
  $('#meter-spent').style.width = `${percent(spentCents)}%`;
  $('#meter-held').style.width = `${percent(heldCents)}%`;
  $('#meter-text').textContent = `${money(spentCents)} spent · ${money(heldCents)} held · ${money(remainingCents)} left of ${money(rules.budgetCents)}`;
}

function renderAlert() {
  const box = $('#alert');
  const alert = state.alerts.at(-1);
  box.hidden = !alert;
  if (!alert) {
    box.replaceChildren();
    return;
  }
  const actions = el('div', 'actions');
  actions.append(
    button('button', refundFor(alert.purchaseId) ? 'View refund' : 'Report charge', () => reportOrView(alert.purchaseId)),
    button('button', 'Resume agent', () => act('/api/agent/resume', {}, 'Agent resumed.')),
  );
  box.replaceChildren(el('strong', '', 'Charge flagged. Agent paused.'), el('p', '', alert.message), actions);
}

function renderReminders() {
  const box = $('#reminders');
  const reminders = state.purchases.filter((purchase) => purchase.status === 'pending' && purchase.reminder);
  box.hidden = reminders.length === 0;
  box.replaceChildren(...reminders.map((purchase) => {
    const notice = el('div', 'reminder-notice');
    const text = el('div');
    text.append(el('strong', '', purchase.reminder), el('p', '', `${purchase.item} at ${purchase.merchantName}, ${money(purchase.amountCents)}`));
    notice.append(text, button('button', 'Review', () => showTab('approvals')));
    return notice;
  }));
}

function renderRules() {
  $('#save-rules').textContent = state.access.active ? 'Save rules' : 'Save rules and give agent access';
  const serialized = JSON.stringify(state.rules);
  if (formDirty || serialized === renderedRules) return;
  renderedRules = serialized;
  $('#budget').value = (state.rules.budgetCents / 100).toFixed(2);
  $('#approval').value = (state.rules.approvalCents / 100).toFixed(2);
  const categories = [...new Set(state.merchants.map((merchant) => merchant.category))];
  $('#merchant-options').replaceChildren(...categories.map((category) => {
    const group = el('div', 'category');
    const head = el('label', 'category-head');
    const all = el('input');
    all.type = 'checkbox';
    all.dataset.category = category;
    head.append(all, el('strong', '', `All ${category}`));
    group.append(head, ...state.merchants.filter((merchant) => merchant.category === category).map((merchant) => {
      const label = el('label', 'check');
      const input = el('input');
      input.type = 'checkbox';
      input.value = merchant.id;
      input.dataset.merchant = merchant.id;
      input.checked = state.rules.allowedMerchantIds.includes(merchant.id);
      const text = el('span');
      text.append(el('strong', '', merchant.name), el('span', 'muted', merchant.about));
      label.append(input, image('logo large', merchant.logo), text);
      return label;
    }));
    return group;
  }));
  syncCategories();
}

function syncCategories() {
  document.querySelectorAll('#merchant-options .category').forEach((group) => {
    const boxes = [...group.querySelectorAll('input[data-merchant]')];
    const all = group.querySelector('input[data-category]');
    all.checked = boxes.every((box) => box.checked);
    all.indeterminate = !all.checked && boxes.some((box) => box.checked);
  });
}

function renderMerchantSettings() {
  document.querySelectorAll('#merchant-settings input').forEach((input) => {
    input.checked = state.merchantAgents[input.dataset.merchantId].includes(input.value);
  });
}

function buildMerchantSettings() {
  $('#merchant-settings').replaceChildren(...state.merchants.map((merchant) => {
    const card = el('li', 'card');
    const head = el('div', 'merchant-head');
    const name = el('div');
    name.append(el('strong', '', merchant.name), el('p', 'muted', merchant.category));
    head.append(image('logo large', merchant.logo), name);
    card.append(head);
    state.agentCompanies.forEach((company) => {
      const label = el('label', 'check compact');
      const input = el('input');
      input.type = 'checkbox';
      input.value = company.id;
      input.dataset.merchantId = merchant.id;
      input.addEventListener('change', () => {
        const agentCompanyIds = [...card.querySelectorAll('input:checked')].map((box) => box.value);
        act(`/api/merchants/${merchant.id}/agents`, { agentCompanyIds });
      });
      label.append(input, el('span', '', company.name));
      card.append(label);
    });
    return card;
  }));
}

function buildAgentCompanies() {
  $('#agent-company').replaceChildren(...state.agentCompanies.map((company) => {
    const option = el('option', '', company.name);
    option.value = company.id;
    return option;
  }));
}

function renderAgent() {
  $('#agent-company').value = state.agentCompanyId;
  $('#agent-company').disabled = state.agent.running;
  const ahead = state.simulatedDays;
  $('#sim-day').textContent = ahead
    ? `Simulated time is ${ahead} ${ahead === 1 ? 'day' : 'days'} ahead.`
    : 'A pending approval lasts 3 days. Simulated time is on today.';
  $('#agent-status').textContent = !state.access.active && !state.agent.running && !state.purchases.length
    ? 'The agent has no access yet, so its purchases will be blocked.'
    : state.agent.message;
  $('#run-agent').disabled = state.agent.running;
  $('#simulate-overreach').disabled = state.agent.running;
  $('#run-agent').textContent = state.agent.running ? 'Agent is shopping…' : 'Send agent shopping';
  const purchases = [...state.purchases].reverse();
  $('#purchases').replaceChildren(...(purchases.length ? purchases.map(purchaseCard) : [el('li', 'empty', 'No purchases yet.')]));
}

function renderApprovals() {
  const pending = state.purchases.filter((purchase) => purchase.status === 'pending');
  $('#approvals').replaceChildren(...(pending.length ? pending.map(approvalCard) : [el('li', 'empty', 'Nothing is waiting for you.')]));
  const badge = $('#approval-badge');
  badge.hidden = pending.length === 0;
  badge.textContent = pending.length;

  const fresh = pending.find((purchase) => !seenPending.has(purchase.id));
  pending.forEach((purchase) => seenPending.add(purchase.id));
  if (fresh && currentTab !== 'report') showTab('approvals');
}

function renderLog() {
  const entries = [...state.log].reverse();
  const purchasesById = new Map(state.purchases.map((purchase) => [purchase.id, purchase]));
  // Each purchase gets one report button, on its newest entry.
  const withButton = new Set();
  $('#log').replaceChildren(...(entries.length ? entries.map((entry) => {
    const item = el('li', `log-entry ${entry.actor}${entry.flagged ? ' flagged' : ''}`);
    const head = el('div', 'card-row');
    head.append(el('strong', '', entry.flagged ? 'Flagged' : ACTOR_LABELS[entry.actor]), el('time', 'muted', time(entry.at)));
    const body = el('div', 'log-body');
    const purchase = purchasesById.get(entry.purchaseId);
    if (purchase) body.append(image('logo', purchase.merchantLogo, `${purchase.merchantName} logo`));
    body.append(el('p', '', entry.message));
    item.append(head, body);
    if (entry.purchaseId && !withButton.has(entry.purchaseId)) {
      withButton.add(entry.purchaseId);
      if (wasCharged(purchase)) item.append(button('link details', 'View purchase details', () => openPurchase(purchase.id)));
      item.append(button('link report', refundFor(entry.purchaseId) ? 'View refund request' : 'Report a problem', () => reportOrView(entry.purchaseId)));
    }
    return item;
  }) : [el('li', 'empty', 'Nothing has happened yet.')]));
}

function refundStatus(refund) {
  return refund.timeline[refund.stageIndex].label;
}

function refundTagClass(refund) {
  return refund.outcome ?? 'open';
}

function renderRefunds() {
  const refunds = [...state.refunds].reverse();
  $('#refunds').replaceChildren(...(refunds.length ? refunds.map((refund) => {
    const card = el('li', 'card');
    const open = button('card-button', '', () => openRefund(refund.id));
    const row = el('span', 'card-row');
    row.append(el('strong', '', refund.item), el('span', 'amount', money(refund.amountCents)));
    const meta = el('span', 'card-row');
    meta.append(el('span', 'muted', `${refund.ref} · ${refund.merchantName}`), el('span', `tag ${refundTagClass(refund)}`, refundStatus(refund)));
    const expected = refund.outcome ? `Resolved ${day(refund.resolvedAt)}` : `Expected by ${day(refund.expectedResolveAt)}`;
    open.append(row, meta, el('span', 'reason block', expected));
    card.append(open);
    return card;
  }) : [el('li', 'empty', 'No refund requests yet. Report a problem from Activity.')]));
}

function simulateButtons(refund) {
  const path = `/api/refunds/${refund.id}/advance`;
  const nextIsFinal = refund.stageIndex === refund.timeline.length - 2;
  if (!nextIsFinal) return [button('button primary wide', 'Simulate next step', () => act(path))];
  if (!refund.charged) return [button('button primary wide', 'Simulate next step: Declined', () => act(path, { outcome: 'declined' }))];
  const actions = el('div', 'actions');
  actions.append(
    button('button', 'Simulate next step: Declined', () => act(path, { outcome: 'declined' })),
    button('button primary', 'Simulate next step: Refunded', () => act(path, { outcome: 'refunded' })),
  );
  return [actions];
}

function renderRefundDetail() {
  const refund = state?.refunds.find((r) => r.id === openRefundId);
  if (!refund) {
    $('#refund-detail').replaceChildren();
    return;
  }
  $('#refund-title').textContent = `Refund ${refund.ref}`;

  const summary = el('div', 'card');
  const row = el('div', 'card-row');
  row.append(el('strong', '', refund.item), el('span', 'amount', money(refund.amountCents)));
  const meta = el('div', 'card-row');
  meta.append(el('span', 'muted', refund.merchantName), el('span', `tag ${refundTagClass(refund)}`, refundStatus(refund)));
  summary.append(row, meta, el('p', 'reason', `Reason: ${refund.reasonLabel}`));
  if (refund.note) summary.append(el('p', 'reason note', `Your note: ${refund.note}`));

  let eta = `Expected to resolve in about ${refund.expectedDays} days, by ${day(refund.expectedResolveAt)}. This is a mock estimate.`;
  if (refund.outcome) eta = refund.declineReason ?? `Resolved on ${day(refund.resolvedAt)}.`;

  const timeline = el('ol', 'timeline');
  refund.timeline.forEach((step, index) => {
    const done = Boolean(step.at);
    const item = el('li', `step${done ? ' done' : ''}${index === refund.stageIndex && !refund.outcome ? ' current' : ''}`);
    item.append(el('strong', '', step.label), el('span', 'muted', done ? dayAndTime(step.at) : `Expected by ${day(step.expectedAt)}`));
    timeline.append(item);
  });

  const children = [summary, el('p', 'eta', eta), el('h3', '', 'Status timeline'), timeline];
  if (!refund.outcome) children.push(...simulateButtons(refund));
  $('#refund-detail').replaceChildren(...children);
}

function render() {
  renderHeader();
  renderAlert();
  renderReminders();
  renderRules();
  renderAgent();
  renderApprovals();
  renderLog();
  renderRefunds();
  renderRefundDetail();
  renderPurchaseDetail();
  renderMerchantSettings();
}

function setLive(isLive) {
  $('#live-state').textContent = isLive ? 'Live.' : 'Reconnecting…';
}

function buildReportReasons() {
  $('#report-reasons').replaceChildren(...Object.entries(state.refundReasons).map(([value, label]) => {
    const option = el('label', 'check compact');
    const input = el('input');
    input.type = 'radio';
    input.name = 'report-reason';
    input.value = value;
    input.required = true;
    option.append(input, el('span', '', label));
    return option;
  }));
}

document.querySelectorAll('.tabs button').forEach((node) => {
  node.addEventListener('click', () => showTab(node.dataset.tab));
});

$('#rules-form').addEventListener('input', () => { formDirty = true; });

$('#merchant-options').addEventListener('change', ({ target }) => {
  if (target.dataset.category) {
    target.closest('.category').querySelectorAll('input[data-merchant]').forEach((box) => { box.checked = target.checked; });
  }
  syncCategories();
});

$('#agent-company').addEventListener('change', (event) => act('/api/agent-company', { id: event.target.value }));
$('#open-merchants').addEventListener('click', () => showTab('merchants'));
$('#merchants-back').addEventListener('click', () => showTab('agent'));
$('#purchase-back').addEventListener('click', () => showTab(purchaseReturnTab));

$('#rules-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const allowedMerchantIds = [...document.querySelectorAll('#merchant-options input[data-merchant]:checked')].map((input) => input.value);
  try {
    await post('/api/rules', {
      budgetCents: toCents($('#budget').value),
      approvalCents: toCents($('#approval').value),
      allowedMerchantIds,
    });
    formDirty = false;
    if (!state.access.active) await post('/api/access', { active: true });
    toast('Rules saved.');
    showTab('agent');
  } catch (error) {
    toast(error.message);
  }
});

$('#access-button').addEventListener('click', () => {
  const active = !state.access.active;
  act('/api/access', { active }, active ? 'The agent has access.' : 'Access revoked.');
});

$('#run-agent').addEventListener('click', () => act('/api/agent/run'));
$('#simulate-overreach').addEventListener('click', () => act('/api/agent/overreach'));
$('#simulate-uncleared').addEventListener('click', () => act('/api/simulate/uncleared-charge'));
$('#simulate-next-day').addEventListener('click', () => act('/api/simulate/next-day'));
$('#report-back').addEventListener('click', () => showTab('activity'));
$('#refund-back').addEventListener('click', () => showTab('refunds'));

$('#report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const before = state.refunds.length;
    const reason = document.querySelector('input[name="report-reason"]:checked').value;
    const updated = await post(`/api/purchases/${reportPurchaseId}/report`, { reason, note: $('#report-note').value });
    state = updated;
    render();
    toast('Refund request submitted.');
    openRefund(updated.refunds[before].id);
  } catch (error) {
    toast(error.message);
  }
});

$('#reset').addEventListener('click', async () => {
  try {
    formDirty = false;
    renderedRules = '';
    seenPending.clear();
    await post('/api/reset');
    toast('Demo reset.');
    showTab('rules');
  } catch (error) {
    toast(error.message);
  }
});

const events = new EventSource('/api/events');
events.onopen = () => setLive(true);
events.onerror = () => setLive(false);
events.onmessage = (event) => {
  const firstState = !state;
  state = JSON.parse(event.data);
  if (firstState) {
    buildReportReasons();
    buildMerchantSettings();
    buildAgentCompanies();
  }
  render();
};
