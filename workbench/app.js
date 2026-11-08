import { MockAgent, UNCLEARED_CHARGE } from '../engine/agent.js';
import { Guard } from '../engine/guard.js';
import { MemoryConnections } from '../engine/memory-connections.js';
import { configForScenario, configWarnings, decodeConfig, effectiveShares, encodeConfig, FEATURE_BLOCKS, normalizeConfig } from './config.js';
import { AGENTS, buildCatalog, SCENARIO_IDS, SCENARIOS, shoppingList } from './scenarios.js';
import { buildSpec, specToMarkdown } from './spec.js';

const $ = (selector) => document.querySelector(selector);
const STEP_MS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;
const CONNECTION_DAYS = 30;
const NO_LIMIT_CENTS = 1_000_000_000_000;
const APPROVAL_WARNING = "Approval doesn't reserve funds; this can still fail if your limit is used up first.";
const STATUS_LABELS = { completed: 'Paid', blocked: 'Blocked', pending: 'Needs approval', authorized: 'Cleared', held: 'On hold', denied: 'Denied', canceled: 'Canceled', refunded: 'Refunded' };
const ACTOR_LABELS = { customer: 'You', agent: 'Agent', guard: 'Guard', payment: 'Test payment', refund: 'Refunds', reminder: 'Reminder', clock: 'Test clock', security: 'Security' };

const cents = (dollars) => Math.round(dollars * 100);
const money = (value) => `$${(value / 100).toFixed(2)}`;
const day = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const time = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let config = initialConfig();
let runtime = null;
let ui = freshUi();
const seenPending = new Set();

function freshUi() {
  return { tab: 'agents', flow: null, reportId: null, refundId: null, shopAgent: null };
}

function initialConfig() {
  const encoded = new URLSearchParams(window.location.search).get('c');
  return (encoded && decodeConfig(encoded)) || configForScenario(SCENARIO_IDS[0]);
}

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

function row(left, right) {
  const node = el('div', 'row');
  node.append(left, right);
  return node;
}

const state = () => runtime.guard.snapshot();
const features = () => config.features;
const activeConnections = (snapshot) => snapshot.connections.filter((c) => c.status === 'active');

function safely(action) {
  try {
    action();
  } catch (error) {
    $('#stage-hint').textContent = error.message;
  }
}

// One engine, assembled from whichever blocks are switched on.
function buildRuntime() {
  runtime?.agent.stop();
  runtime?.unsubscribe();
  seenPending.clear();
  ui = freshUi();
  const scenario = SCENARIOS[config.scenario];
  const catalog = buildCatalog(scenario, config.agents);
  const connections = new MemoryConnections(catalog.agents);
  const guard = new Guard({ connections, catalog, features: config.features });
  guard.credit = { creditLimitCents: cents(config.creditLimit), balanceCents: 0 };
  guard.setRules({
    budgetCents: cents(config.allocation),
    approvalCents: cents(config.approval),
    agentShares: Object.fromEntries(Object.entries(effectiveShares(config)).map(([id, value]) => [id, cents(value)])),
  });
  const agent = new MockAgent(guard, { stepMs: STEP_MS, list: shoppingList(scenario) });
  const unsubscribe = guard.subscribe(() => renderPhone());
  runtime = { guard, agent, connections, unsubscribe };
  renderPhone();
}

function applyConfig(next) {
  config = normalizeConfig(next);
  window.history.replaceState(null, '', `?c=${encodeConfig(config)}`);
  syncSetup();
  renderSpec();
  buildRuntime();
}

function buildSetup() {
  const scenario = $('#scenario');
  scenario.replaceChildren(...SCENARIO_IDS.map((id) => {
    const option = el('option', '', SCENARIOS[id].name);
    option.value = id;
    return option;
  }));
  scenario.addEventListener('change', () => applyConfig(configForScenario(scenario.value, { agents: config.agents, features: config.features })));

  $('#agents').replaceChildren(...AGENTS.map((agent) => {
    const label = el('label', 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.value = agent.id;
    input.dataset.agent = agent.id;
    input.addEventListener('change', () => {
      const agents = [...document.querySelectorAll('input[data-agent]:checked')].map((box) => box.value);
      applyConfig({ ...config, agents });
    });
    label.append(input, image('badge', agent.icon), el('span', '', agent.name));
    return label;
  }));

  $('#features').replaceChildren(...FEATURE_BLOCKS.map((block) => {
    const label = el('label', 'check block');
    const input = el('input');
    input.type = 'checkbox';
    input.dataset.feature = block.id;
    input.addEventListener('change', () => {
      applyConfig({ ...config, features: { ...config.features, [block.id]: input.checked } });
    });
    const text = el('span');
    text.append(el('strong', '', block.label), el('span', 'muted', block.hint));
    label.append(input, text);
    return label;
  }));

  [['#credit-limit', 'creditLimit'], ['#allocation', 'allocation'], ['#approval', 'approval']].forEach(([selector, key]) => {
    $(selector).addEventListener('change', (event) => applyConfig({ ...config, [key]: Number(event.target.value) }));
  });
}

function syncSetup() {
  $('#scenario').value = config.scenario;
  document.querySelectorAll('input[data-agent]').forEach((box) => { box.checked = config.agents.includes(box.value); });
  document.querySelectorAll('input[data-feature]').forEach((box) => {
    const block = FEATURE_BLOCKS.find((b) => b.id === box.dataset.feature);
    box.checked = config.features[block.id];
    box.disabled = Boolean(block.requires) && !config.features[block.requires];
  });
  $('#credit-limit').value = config.creditLimit;
  $('#allocation').value = config.allocation;
  $('#allocation').max = config.creditLimit;
  $('#approval').value = config.approval;
  $('#allocation-field').hidden = !features().creditHolds;
  $('#approval-field').hidden = !features().approvals;
  $('#shares-field').hidden = !features().splitByAgent;
  $('#shares').replaceChildren(...AGENTS.filter((agent) => config.agents.includes(agent.id)).map((agent) => {
    const label = el('label', 'share');
    const box = el('span', 'money');
    const input = el('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.dataset.share = agent.id;
    if (Object.hasOwn(config.shares, agent.id)) input.value = config.shares[agent.id];
    input.addEventListener('change', () => {
      const shares = { ...config.shares };
      if (input.value === '') delete shares[agent.id];
      else shares[agent.id] = Number(input.value);
      applyConfig({ ...config, shares });
    });
    box.append(el('span', '', '$'), input);
    label.append(el('span', '', agent.shortName), box);
    return label;
  }));
  $('#warnings').replaceChildren(...configWarnings(config).map((warning) => el('p', '', warning)));
}

function renderSpec() {
  const spec = buildSpec(config);
  $('#spec').replaceChildren(el('h3', 'spec-title', spec.title), ...spec.sections.flatMap(({ heading, paragraph, items, ordered }) => {
    const nodes = [el('h4', '', heading)];
    if (paragraph) nodes.push(el('p', '', paragraph));
    if (items) {
      const list = el(ordered ? 'ol' : 'ul');
      list.append(...items.map((item) => el('li', '', item)));
      nodes.push(list);
    }
    return nodes;
  }));
}

const shareLink = () => `${window.location.origin}${window.location.pathname}?c=${encodeConfig(config)}`;

async function copyShareLink() {
  try {
    await navigator.clipboard.writeText(shareLink());
    $('#copy-status').textContent = 'Share link copied.';
  } catch {
    $('#copy-status').textContent = shareLink();
  }
}

function exportSpec() {
  const blob = new Blob([specToMarkdown(buildSpec(config), shareLink())], { type: 'text/markdown' });
  const link = el('a');
  link.href = URL.createObjectURL(blob);
  link.download = `agent-checkout-guard-${config.scenario}-spec.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function tabsFor() {
  const tabs = [['agents', 'Agents'], ['shop', 'Shop']];
  if (features().approvals) tabs.push(['approvals', 'Approve']);
  tabs.push(['activity', 'Activity']);
  if (features().refunds) tabs.push(['refunds', 'Refunds']);
  return tabs;
}

function showTab(tab) {
  ui.tab = tab;
  ui.flow = null;
  ui.reportId = null;
  ui.refundId = null;
  renderPhone(true);
}

function purchaseCard(purchase) {
  const card = el('li', purchase.flagged ? 'card flagged' : 'card');
  const declined = purchase.reason.startsWith('Declined at checkout');
  const name = el('div', 'grow');
  name.append(el('strong', '', purchase.item), el('p', 'muted', purchase.description));
  const details = [purchase.color && `Color: ${purchase.color}`, purchase.size && `Size: ${purchase.size}`].filter(Boolean);
  if (details.length) name.append(el('p', 'muted small', details.join(' · ')));
  const top = el('div', 'row top');
  top.append(image('thumb', purchase.image), name, el('span', 'amount', money(purchase.amountCents)));
  const merchant = el('span', 'inline');
  merchant.append(image('logo', purchase.merchantLogo), el('span', 'muted small', purchase.merchantName));
  if (purchase.categoryIcon) merchant.append(image('logo', purchase.categoryIcon), el('span', 'muted small', purchase.category));
  let label = declined ? 'Declined' : STATUS_LABELS[purchase.status];
  if (purchase.flagged) label = 'Flagged';
  card.append(top, row(merchant, el('span', `tag ${purchase.flagged ? 'flag' : purchase.status}`, label)));
  if (purchase.reason) card.append(el('p', 'muted small reason', purchase.reason));
  return card;
}

function creditCard(snapshot) {
  const { allocation } = snapshot;
  const card = el('div', 'card');
  const meter = el('div', 'meter');
  const percent = (value) => (allocation.totalCents ? Math.min(100, (value / allocation.totalCents) * 100) : 0);
  [['spent', allocation.spentCents], ['held', allocation.heldCents]].filter(([, value]) => value > 0).forEach(([kind, value]) => {
    const segment = el('span', kind);
    segment.style.width = `${percent(value)}%`;
    meter.append(segment);
  });
  const stats = el('dl', 'stats');
  [['Allocation', allocation.totalCents], ['Spent', allocation.spentCents], ['On hold', allocation.heldCents], ['Remaining', allocation.remainingCents]].forEach(([label, value]) => {
    const stat = el('div');
    stat.append(el('dt', '', label), el('dd', '', money(value)));
    stats.append(stat);
  });
  card.append(meter, stats);
  return card;
}

function holdsList(snapshot) {
  const list = el('ul', 'cards');
  list.append(...(snapshot.holds.length ? snapshot.holds.map((hold) => {
    const item = el('li', 'card');
    item.append(row(el('strong', '', hold.item), el('span', 'amount', money(hold.amountCents))), el('p', 'muted small', `${hold.agentName} · Hold expires ${day(hold.expiresAt)}`));
    return item;
  }) : [el('li', 'empty', 'No open holds.')]));
  return list;
}

function connectAgent(agent) {
  if (features().stepUpConsent) {
    ui.flow = { agent, stage: 'stepup', code: String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0') };
    renderPhone(true);
  } else {
    linkAgent(agent, { budgetCents: NO_LIMIT_CENTS, approvalCents: NO_LIMIT_CENTS });
  }
}

function linkAgent(agent, limits) {
  safely(() => {
    const nowMs = runtime.guard.nowMs();
    runtime.connections.link(agent.id, { ...limits, approvalExpiryDays: 3, connectionExpiresAt: new Date(nowMs + CONNECTION_DAYS * DAY_MS).toISOString() }, nowMs);
    runtime.guard.recordEvent('security', `Connected ${agent.shortName}. It has its own test card token.`);
  });
  ui.flow = null;
  renderPhone(true);
}

function consentLimits(agent) {
  const shares = effectiveShares(config);
  const budget = features().splitByAgent && Object.hasOwn(shares, agent.id) ? shares[agent.id] : config.allocation;
  return { budgetCents: cents(budget), approvalCents: cents(config.approval) };
}

function stepUpView() {
  const { agent, code } = ui.flow;
  const wrap = el('div');
  const form = el('form');
  const input = el('input', 'text');
  input.id = 'stepup-input';
  input.inputMode = 'numeric';
  input.maxLength = 6;
  input.required = true;
  input.setAttribute('aria-label', '6-digit code');
  const error = el('p', 'error');
  error.setAttribute('role', 'status');
  form.append(input, error, el('button', 'button primary wide', 'Confirm'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (input.value !== code) {
      error.textContent = 'That code is not correct.';
      return;
    }
    ui.flow.stage = 'consent';
    renderPhone(true);
  });
  const codeBox = el('p', 'code');
  codeBox.append(el('span', '', 'Your step-up code is'), el('strong', '', code));
  wrap.append(el('h2', '', 'Confirm it\'s you'), el('p', 'muted', `Before connecting ${agent.name}.`), codeBox, form, button('link', 'Cancel', () => showTab('agents')));
  return wrap;
}

function consentView() {
  const { agent } = ui.flow;
  const limits = consentLimits(agent);
  const wrap = el('div');
  const details = el('dl', 'details');
  const rows = [['Budget', money(limits.budgetCents)]];
  if (features().approvals) {
    rows.push(['Ask for approval above', money(limits.approvalCents)], ['Approval requests expire after', '3 days']);
  }
  rows.push(['Connection expires', day(new Date(runtime.guard.nowMs() + CONNECTION_DAYS * DAY_MS).toISOString())]);
  rows.forEach(([label, value]) => {
    const line = el('div');
    line.append(el('dt', '', label), el('dd', '', value));
    details.append(line);
  });
  const card = el('div', 'card');
  card.append(details);
  const actions = el('div', 'actions');
  actions.append(button('button', 'Cancel', () => showTab('agents')), button('button primary', 'Allow', () => linkAgent(agent, limits)));
  wrap.append(el('h2', '', 'Review consent'), el('p', 'muted', `What ${agent.name} may do:`), card, actions);
  return wrap;
}

function agentsView(snapshot) {
  if (ui.flow?.stage === 'stepup') return stepUpView();
  if (ui.flow?.stage === 'consent') return consentView();
  const wrap = el('div');
  if (features().creditHolds) {
    wrap.append(el('h2', '', 'Agent credit'), creditCard(snapshot), el('h3', '', 'Open holds'), holdsList(snapshot));
  }
  if (features().splitByAgent && snapshot.spendingByAgent.length) {
    const list = el('ul', 'cards');
    list.append(...snapshot.spendingByAgent.map((entry) => {
      const item = el('li', 'card');
      item.append(el('strong', '', entry.name), el('p', 'muted small', `${money(entry.spentCents)} spent · ${money(entry.heldCents)} on hold · ${money(entry.remainingCents)} left of ${money(entry.allocationCents)}${entry.shared ? ' shared' : ''}`));
      return item;
    }));
    wrap.append(el('h3', '', 'Spending by agent'), list);
  }

  wrap.append(el('h2', '', 'Connected agents'));
  const connected = el('ul', 'cards');
  connected.append(...(snapshot.connections.length ? snapshot.connections.map((connection) => {
    const item = el('li', 'card');
    const name = el('span', 'inline');
    name.append(image('badge', connection.icon), el('strong', '', connection.name));
    item.append(row(name, el('span', `tag ${connection.status}`, connection.status === 'active' ? 'Active' : 'Revoked')));
    item.append(el('p', 'muted small', `${money(connection.spentCents)} spent · token ${connection.token}`));
    if (connection.status === 'active') {
      item.append(button('button danger wide', 'Revoke', () => safely(() => runtime.guard.revokeConnection(connection.id))));
    }
    return item;
  }) : [el('li', 'empty', 'No agents connected yet.')]));
  wrap.append(connected);

  const available = snapshot.demoAgents.filter((agent) => !activeConnections(snapshot).some((c) => c.agentId === agent.id));
  if (available.length) {
    const list = el('ul', 'cards');
    list.append(...available.map((agent) => {
      const item = el('li', 'card');
      const name = el('span', 'inline');
      name.append(image('badge', agent.icon), el('strong', '', agent.name));
      item.append(row(name, button('button primary', 'Connect', () => connectAgent(agent))));
      return item;
    }));
    wrap.append(el('h3', '', 'Connect an agent'), list);
  }
  return wrap;
}

function selectedConnection(snapshot) {
  const active = activeConnections(snapshot);
  return active.find((c) => c.id === ui.shopAgent) ?? active[0] ?? null;
}

function shopView(snapshot) {
  const wrap = el('div');
  const active = activeConnections(snapshot);
  wrap.append(el('h2', '', 'Shop'), el('p', 'muted', active.length ? snapshot.agent.message : 'Connect an agent first.'));
  if (active.length > 1) {
    const select = el('select', 'text');
    select.setAttribute('aria-label', 'Agent');
    select.append(...active.map((connection) => {
      const option = el('option', '', connection.name);
      option.value = connection.id;
      return option;
    }));
    select.value = selectedConnection(snapshot).id;
    select.disabled = snapshot.agent.running;
    select.addEventListener('change', () => { ui.shopAgent = select.value; });
    wrap.append(select);
  }
  const list = el('ul', 'cards');
  const purchases = [...snapshot.purchases].reverse();
  list.append(...(purchases.length ? purchases.map(purchaseCard) : [el('li', 'empty', 'Use Run scenario to send the agent shopping.')]));
  wrap.append(list);
  return wrap;
}

function approvalsView(snapshot) {
  const wrap = el('div');
  const pending = snapshot.purchases.filter((p) => p.status === 'pending');
  wrap.append(el('h2', '', 'Approve or deny'));
  const list = el('ul', 'cards');
  list.append(...(pending.length ? pending.map((purchase) => {
    const card = purchaseCard(purchase);
    card.classList.add('approval');
    const left = Math.ceil((Date.parse(purchase.expiresAt) - Date.parse(snapshot.now)) / DAY_MS);
    card.append(
      el('p', 'muted small', `Requested by ${purchase.agentName}.`),
      el('p', 'countdown', purchase.reminder ?? `This request expires in ${left} ${left === 1 ? 'day' : 'days'}`),
    );
    if (features().creditHolds) card.append(el('p', 'warning', APPROVAL_WARNING));
    const actions = el('div', 'actions');
    actions.append(
      button('button danger', 'Deny', () => safely(() => runtime.guard.decide(purchase.id, false))),
      button('button primary', 'Approve', () => safely(() => runtime.guard.decide(purchase.id, true))),
    );
    card.append(actions);
    return card;
  }) : [el('li', 'empty', 'Nothing is waiting for you.')]));
  wrap.append(list);
  return wrap;
}

function activityView(snapshot) {
  const wrap = el('div');
  wrap.append(el('h2', '', 'Live activity'));
  const purchases = new Map(snapshot.purchases.map((p) => [p.id, p]));
  const withButton = new Set();
  const list = el('ol', 'log');
  list.append(...[...snapshot.log].reverse().map((entry) => {
    const item = el('li', `entry ${entry.actor}${entry.flagged ? ' flagged' : ''}`);
    item.append(row(el('strong', '', entry.flagged ? 'Flagged' : ACTOR_LABELS[entry.actor]), el('span', 'muted small', time(entry.at))), el('p', 'small', entry.message));
    const purchase = purchases.get(entry.purchaseId);
    if (purchase && features().refunds && !withButton.has(purchase.id)) {
      withButton.add(purchase.id);
      const refund = snapshot.refunds.find((r) => r.purchaseId === purchase.id);
      item.append(button('link report', refund ? 'View refund request' : 'Report a problem', () => {
        if (refund) { ui.tab = 'refunds'; ui.refundId = refund.id; } else ui.reportId = purchase.id;
        renderPhone(true);
      }));
    }
    return item;
  }));
  wrap.append(list);
  return wrap;
}

function reportView(snapshot) {
  const purchase = snapshot.purchases.find((p) => p.id === ui.reportId);
  const wrap = el('div');
  const form = el('form');
  const reasons = el('div');
  reasons.append(...Object.entries(snapshot.refundReasons).map(([value, label]) => {
    const option = el('label', 'check');
    const input = el('input');
    input.type = 'radio';
    input.name = 'reason';
    input.value = value;
    input.required = true;
    option.append(input, el('span', '', label));
    return option;
  }));
  const note = el('textarea', 'text');
  note.rows = 2;
  note.maxLength = 500;
  note.setAttribute('aria-label', 'Add a note (optional)');
  note.placeholder = 'Add a note (optional)';
  form.append(reasons, note, el('button', 'button primary wide', 'Submit refund request'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    safely(() => {
      const refund = runtime.guard.reportProblem(purchase.id, { reason: form.elements.reason.value, note: note.value });
      ui.reportId = null;
      ui.tab = 'refunds';
      ui.refundId = refund.id;
      renderPhone(true);
    });
  });
  wrap.append(button('link', '‹ Back', () => showTab('activity')), el('h2', '', 'Report a problem'), el('p', 'muted', `${purchase.item}, ${money(purchase.amountCents)} at ${purchase.merchantName}.`), form);
  return wrap;
}

function refundDetail(snapshot) {
  const refund = snapshot.refunds.find((r) => r.id === ui.refundId);
  const wrap = el('div');
  wrap.append(button('link', '‹ All refunds', () => showTab('refunds')), el('h2', '', `Refund ${refund.ref}`));
  const card = el('div', 'card');
  card.append(row(el('strong', '', refund.item), el('span', 'amount', money(refund.amountCents))), el('p', 'muted small', `${refund.merchantName} · ${refund.reasonLabel}`));
  if (refund.note) card.append(el('p', 'small note', `Your note: ${refund.note}`));
  const timeline = el('ol', 'timeline');
  refund.timeline.forEach((step) => {
    const item = el('li', step.at ? 'done' : '');
    item.append(el('strong', '', step.label), el('span', 'muted small', step.at ? day(step.at) : `Expected by ${day(step.expectedAt)}`));
    timeline.append(item);
  });
  wrap.append(card, el('p', 'small eta', refund.outcome ? (refund.declineReason ?? `Resolved on ${day(refund.resolvedAt)}.`) : `Expected to resolve in about ${refund.expectedDays} days. Mock estimate.`), timeline);
  if (!refund.outcome) {
    const advance = (outcome) => () => safely(() => runtime.guard.advanceRefund(refund.id, outcome));
    if (refund.stageIndex === refund.timeline.length - 2) {
      const actions = el('div', 'actions');
      actions.append(button('button', 'Next: Declined', advance('declined')), button('button primary', 'Next: Refunded', advance('refunded')));
      wrap.append(actions);
    } else {
      wrap.append(button('button primary wide', 'Simulate next step', advance()));
    }
  }
  return wrap;
}

function refundsView(snapshot) {
  if (ui.refundId) return refundDetail(snapshot);
  const wrap = el('div');
  wrap.append(el('h2', '', 'Refunds'));
  const list = el('ul', 'cards');
  list.append(...(snapshot.refunds.length ? [...snapshot.refunds].reverse().map((refund) => {
    const item = el('li', 'card');
    item.append(row(el('strong', '', refund.item), el('span', 'amount', money(refund.amountCents))), el('p', 'muted small', `${refund.ref} · ${refund.timeline[refund.stageIndex].label}`));
    item.append(button('link', 'Track request', () => { ui.refundId = refund.id; renderPhone(true); }));
    return item;
  }) : [el('li', 'empty', 'Report a problem from Activity.')]));
  wrap.append(list);
  return wrap;
}

function alertBox(snapshot) {
  const alert = snapshot.alerts.at(-1);
  if (!alert) return null;
  const box = el('div', 'alert');
  box.setAttribute('role', 'alert');
  box.append(el('strong', '', 'Charge flagged. Agents paused.'), el('p', 'small', alert.message), button('button', 'Resume agents', () => safely(() => runtime.guard.resumeAgent())));
  return box;
}

function reminderBoxes(snapshot) {
  return snapshot.purchases.filter((p) => p.status === 'pending' && p.reminder).map((purchase) => {
    const box = el('div', 'reminder');
    box.append(el('strong', 'small', purchase.reminder), el('p', 'small', `${purchase.item}, ${money(purchase.amountCents)}`));
    return box;
  });
}

function viewFor(snapshot) {
  if (ui.reportId) return reportView(snapshot);
  if (ui.tab === 'shop') return shopView(snapshot);
  if (ui.tab === 'approvals') return approvalsView(snapshot);
  if (ui.tab === 'activity') return activityView(snapshot);
  if (ui.tab === 'refunds') return refundsView(snapshot);
  return agentsView(snapshot);
}

function renderControls(snapshot) {
  const hasAgent = activeConnections(snapshot).length > 0;
  $('#run').disabled = snapshot.agent.running || !hasAgent;
  $('#overreach').hidden = !features().overreach;
  $('#overreach').disabled = snapshot.agent.running || !hasAgent;
  $('#next-day').hidden = !features().approvals && !features().creditHolds;
  $('#stage-hint').textContent = hasAgent ? '' : 'Connect an agent in the phone to run the scenario.';
}

// Forms in progress keep their text: background updates leave those screens alone.
function renderPhone(force = false) {
  const snapshot = state();
  renderControls(snapshot);
  const pending = snapshot.purchases.filter((p) => p.status === 'pending');
  const fresh = pending.find((p) => !seenPending.has(p.id));
  pending.forEach((p) => seenPending.add(p.id));
  if (fresh && !ui.flow && !ui.reportId) ui.tab = 'approvals';
  else if (!force && (ui.flow?.stage === 'stepup' || ui.reportId)) return;

  const screen = $('#phone-screen');
  const scrollTop = screen.scrollTop;
  screen.replaceChildren(...[alertBox(snapshot), ...reminderBoxes(snapshot), viewFor(snapshot)].filter(Boolean));
  screen.scrollTop = force ? 0 : scrollTop;
  $('#phone-tabs').replaceChildren(...tabsFor().map(([tab, label]) => {
    const node = button('', label, () => showTab(tab));
    if (tab === ui.tab) node.setAttribute('aria-current', 'page');
    if (tab === 'approvals' && pending.length) node.append(el('span', 'badge-count', pending.length));
    return node;
  }));
}

function runScenario() {
  const connection = selectedConnection(state());
  if (!connection) return;
  ui.tab = 'shop';
  ui.flow = null;
  ui.reportId = null;
  ui.refundId = null;
  if (!runtime.agent.run(runtime.connections.tokenFor(connection.id))) return;
  renderPhone(true);
}

function simulateOverreach() {
  const snapshot = state();
  const connection = selectedConnection(snapshot);
  if (!connection) return;
  ui.tab = 'activity';
  ui.flow = null;
  // Alternates a blocked attempt with a charge that gets past the guard, so both outcomes can be seen.
  if (snapshot.purchases.some((p) => p.overreach)) runtime.guard.recordUnclearedCharge(UNCLEARED_CHARGE);
  else runtime.agent.simulateOverreach(runtime.connections.tokenFor(connection.id));
  renderPhone(true);
}

$('#run').addEventListener('click', runScenario);
$('#next-day').addEventListener('click', () => runtime.guard.advanceDay());
$('#overreach').addEventListener('click', simulateOverreach);
$('#reset').addEventListener('click', buildRuntime);
$('#copy-link').addEventListener('click', copyShareLink);
$('#export-spec').addEventListener('click', exportSpec);

buildSetup();
applyConfig(config);
