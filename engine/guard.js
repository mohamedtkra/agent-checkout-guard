import { checkoutPayload, createDemoAgentDirectory } from './agent-directory.js';
import { DEFAULT_CATALOG } from './catalog.js';
import { GuardError } from './errors.js';

export { GuardError };

// The guard's capabilities are composable blocks. The full app runs with every block on.
export const FEATURE_IDS = ['stepUpConsent', 'approvals', 'creditHolds', 'splitByAgent', 'refunds', 'overreach', 'agentVerification'];

export function normalizeFeatures(features = {}) {
  const enabled = Object.fromEntries(FEATURE_IDS.map((id) => [id, features[id] !== false]));
  if (!enabled.creditHolds) enabled.splitByAgent = false;
  return enabled;
}

const randomUUID = () => globalThis.crypto.randomUUID();

// budgetCents is the agent allocation: how much of the customer's available credit agents may use.
export const DEFAULT_RULES = {
  budgetCents: 50000,
  approvalCents: 5000,
};

// Mock account values. Agent charges and holds are counted against the available amount separately.
const DEFAULT_CREDIT = { creditLimitCents: 500000, balanceCents: 120000 };

export const REFUND_REASONS = {
  overcharged: 'Charged more than approved',
  unauthorized: "Didn't authorize",
  wrong_item: 'Wrong item',
  never_arrived: 'Never arrived',
  other: 'Other',
};

// Mock estimates: days after submission that each stage is expected to be reached.
const REFUND_STAGES = [
  { id: 'submitted', label: 'Submitted', days: 0 },
  { id: 'under_review', label: 'Under review', days: 2 },
  { id: 'merchant_contacted', label: 'Merchant contacted', days: 5 },
  { id: 'resolved', label: 'Refunded or Declined', days: 10 },
];

const APPROVAL_DAYS = 3;
const REMINDER_COUNT = 2;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_NOTE_LENGTH = 500;
const MAX_CONNECTION_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
// Intents reserve nothing. Only an executed purchase, on hold or charged, uses up a limit.
const INTENT_STATUSES = ['pending', 'authorized'];
const COMMITTED_STATUSES = ['completed', 'held'];
const OPEN_STATUSES = [...INTENT_STATUSES, 'held'];
const PERSISTED_FIELDS = ['rules', 'agentShares', 'credit', 'purchases', 'refunds', 'alerts', 'paused', 'pauseReason'];
const FLAGGED_PAUSE = 'The agent is paused after a flagged charge.';
const CUSTOMER_STOP = 'You stopped all agents.';
const OFF_PLAN_REASON = 'This is not on the plan you reviewed.';

// How much a new agent is trusted, as the approval amount each level produces.
const TRUST_APPROVALS = {
  every_time: () => 0,
  above: (approvalCents) => approvalCents,
  routine: (_, rules) => rules.approvalCents,
};

const isCents = (value) => Number.isSafeInteger(value) && value >= 0;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const shortMoney = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const dayWord = (days) => (days === 1 ? '1 day' : `${days} days`);

export function rulesError(rules) {
  if (!rules || typeof rules !== 'object') return 'Rules are missing.';
  if (!isCents(rules.budgetCents)) return 'Budget must be a valid amount.';
  if (!isCents(rules.approvalCents)) return 'Approval amount must be a valid amount.';
  return null;
}

// Decides what an intent needs. Whether the money is there is only checked at execution.
export function evaluate(limits, amountCents) {
  if (rulesError(limits)) return { outcome: 'block', reason: 'Rules could not be checked.' };
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { outcome: 'block', reason: 'Purchase amount could not be checked.' };
  }
  if (amountCents > limits.approvalCents) {
    return { outcome: 'approval', reason: `Over your ${money(limits.approvalCents)} approval amount.` };
  }
  return { outcome: 'allow', reason: 'Within your rules.' };
}

export class Guard {
  #waiters = new Map();
  #listeners = new Set();
  #clockOffsetMs = 0;
  #auditFloor = 0;
  #activePlan = null;
  #persist;
  #appendAudit;

  constructor({ connections, saved = null, log = [], persist = () => {}, appendAudit = () => 0, catalog = DEFAULT_CATALOG, features, agentDirectory = createDemoAgentDirectory() }) {
    this.connections = connections;
    this.agentDirectory = agentDirectory;
    this.catalog = catalog;
    this.features = normalizeFeatures(features);
    this.#persist = persist;
    this.#appendAudit = appendAudit;
    this.#clear();
    if (saved) {
      for (const field of PERSISTED_FIELDS) this[field] = saved[field] ?? this[field];
      this.#clockOffsetMs = saved.clockOffsetMs;
      this.#auditFloor = saved.auditFloor;
      this.log = log;
      this.#recoverAfterRestart();
    }
  }

  // No agent survives a restart to finish an intent, but an executed purchase still settles.
  #recoverAfterRestart() {
    const canceled = this.#cancelOpen('The server restarted before this purchase finished.', { statuses: INTENT_STATUSES });
    const executed = this.purchases.filter((p) => p.status === 'held');
    for (const purchase of executed) this.#charge(purchase, purchase.reason);
    if (canceled.length || executed.length) this.#persist(this.#serialize());
  }

  #nowMs() {
    return Date.now() + this.#clockOffsetMs;
  }

  #nowIso() {
    return new Date(this.#nowMs()).toISOString();
  }

  #clear() {
    this.#clockOffsetMs = 0;
    this.#activePlan = null;
    this.rules = structuredClone(DEFAULT_RULES);
    this.agentShares = {};
    this.credit = { ...DEFAULT_CREDIT };
    this.purchases = [];
    this.log = [];
    this.refunds = [];
    this.alerts = [];
    this.paused = false;
    this.pauseReason = null;
    this.agentStatus = { running: false, message: 'Ready to shop.' };
  }

  #serialize() {
    const state = { clockOffsetMs: this.#clockOffsetMs, auditFloor: this.#auditFloor };
    for (const field of PERSISTED_FIELDS) state[field] = this[field];
    return state;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    this.#persist(this.#serialize());
    const state = this.snapshot();
    for (const listener of this.#listeners) listener(state);
  }

  #record(actor, message, purchase = null, flagged = false) {
    const entry = {
      id: randomUUID(),
      at: this.#nowIso(),
      actor,
      message,
      purchaseId: purchase?.id ?? null,
      flagged,
    };
    this.log.push(entry);
    return this.#appendAudit(entry);
  }

  recordEvent(actor, message) {
    this.#record(actor, message);
    this.#notify();
  }

  #sumCents(statuses, excludeId) {
    return this.purchases
      .filter((p) => statuses.includes(p.status) && p.id !== excludeId)
      .reduce((total, p) => total + p.amountCents, 0);
  }

  #sumBy(field, value, statuses, excludeId) {
    return this.purchases
      .filter((p) => statuses.includes(p.status) && p.id !== excludeId && p[field] === value)
      .reduce((total, p) => total + p.amountCents, 0);
  }

  #open({ merchantId, item, amountCents, overreach = false, why = null, ask = null }, connection = null) {
    const merchant = this.catalog.merchantFor(merchantId);
    const product = this.catalog.productFor(item);
    const purchase = {
      id: randomUUID(),
      at: this.#nowIso(),
      merchantId,
      merchantName: merchant.name,
      merchantLogo: merchant.logo,
      category: merchant.category,
      categoryIcon: this.catalog.categoryIcons[merchant.category],
      connectionId: connection?.id ?? null,
      agentId: connection?.agentId ?? null,
      agentName: connection?.shortName ?? 'Unknown agent',
      item,
      description: product.description,
      color: product.color ?? null,
      size: product.size ?? null,
      image: product.image,
      amountCents,
      originalCents: null,
      expiresAt: null,
      holdOpen: false,
      remindersSent: 0,
      reminder: null,
      status: 'pending',
      reason: '',
      code: null,
      cleared: false,
      customerApproved: false,
      flagged: false,
      overreach,
      offPlan: false,
      why,
      ask,
      consentVersion: null,
      signal: null,
      trail: [],
    };
    this.purchases.push(purchase);
    return purchase;
  }

  #settle(purchase, status, reason) {
    purchase.status = status;
    purchase.reason = reason;
    purchase.settledAt = this.#nowIso();
    if (purchase.holdOpen && status !== 'held') {
      purchase.holdOpen = false;
      if (status !== 'completed') this.#record('guard', `Released the ${money(purchase.amountCents)} hold on ${purchase.item}.`, purchase);
    }
    this.#waiters.get(purchase.id)?.();
    this.#waiters.delete(purchase.id);
  }

  #addTrail(purchase, label, detail) {
    purchase.trail.push({ label, detail, at: this.#nowIso() });
  }

  #block(purchase, code, reason) {
    purchase.code = code;
    this.#addTrail(purchase, reason.startsWith('Declined') ? 'Declined' : 'Blocked', reason.replace(/^Declined at checkout: /, ''));
    const declined = reason.match(/^Declined at checkout: (.*)$/);
    this.#record('guard', declined ? `Declined ${purchase.item} at checkout: ${declined[1]}` : `Blocked ${purchase.item}: ${reason}`, purchase);
    this.#settle(purchase, 'blocked', reason);
  }

  #setExpiry(purchase, fromMs = this.#nowMs()) {
    purchase.expiresAt = new Date(fromMs + APPROVAL_DAYS * DAY_MS).toISOString();
  }

  #placeHold(purchase, reason) {
    purchase.status = 'held';
    purchase.reason = reason;
    purchase.holdOpen = true;
    this.#setExpiry(purchase);
    this.#addTrail(purchase, 'Hold placed', `${money(purchase.amountCents)} reserved at checkout.`);
    this.#record('guard', `Placed a ${money(purchase.amountCents)} hold for ${purchase.item}.`, purchase);
  }

  #availableCredit() {
    return this.credit.creditLimitCents - this.credit.balanceCents;
  }

  // Checks the token and its signed consent, then whether the customer's agents are paused.
  #authorize(token) {
    const auth = this.connections.authorize(token, this.#nowMs());
    if (auth.problem) return auth;
    if (this.paused) return { ...auth, problem: { code: 'paused', reason: this.pauseReason ?? FLAGGED_PAUSE } };
    return auth;
  }

  #isDuplicate(purchase) {
    const now = Date.parse(purchase.at);
    return this.purchases.some((p) => p.id !== purchase.id
      && [...COMMITTED_STATUSES, ...INTENT_STATUSES].includes(p.status)
      && p.merchantId === purchase.merchantId
      && p.item === purchase.item
      && p.amountCents === purchase.amountCents
      && now - Date.parse(p.at) < DUPLICATE_WINDOW_MS);
  }

  #agreedBy(purchase) {
    return purchase.customerApproved ? 'you approved' : 'the guard cleared';
  }

  #mismatchProblem(purchase, final) {
    const agreed = this.#agreedBy(purchase);
    if (!Number.isSafeInteger(final.amountCents) || final.amountCents <= 0) {
      return { code: 'mismatch', reason: 'Final price could not be checked.' };
    }
    if (final.amountCents > purchase.amountCents) {
      return { code: 'mismatch', reason: `Final price ${money(final.amountCents)} is higher than the ${money(purchase.amountCents)} ${agreed}.` };
    }
    if (final.merchantId !== purchase.merchantId) {
      return { code: 'mismatch', reason: `Final merchant ${this.catalog.merchantFor(final.merchantId).name} is not the ${purchase.merchantName} ${agreed}.` };
    }
    if (final.item !== purchase.item) {
      return { code: 'mismatch', reason: `Final item ${final.item} is not the ${purchase.item} ${agreed}.` };
    }
    return null;
  }

  // What an intent needs: a valid amount, and approval if either the rules or the consent ask for it.
  #assess(amountCents, limits) {
    const results = [evaluate(this.rules, amountCents), evaluate(limits, amountCents)];
    const blocked = results.find((result) => result.outcome === 'block');
    if (blocked) return { problem: { code: 'rules', reason: blocked.reason } };
    const held = this.features.approvals ? results.find((result) => result.outcome === 'approval') : undefined;
    return { needsApproval: Boolean(held), reason: held?.reason ?? 'Within your rules.' };
  }

  // Whether the money is there, counting everything already charged or on hold.
  #capacityProblem(purchase, amountCents, limits) {
    const declined = (code, label, limit, used) => ({
      code,
      reason: `Declined at checkout: ${label} ${shortMoney(limit)} ${code === 'consent' ? 'consent budget' : code === 'agent_share' ? 'share' : code === 'credit' ? 'available credit' : 'agent limit'} has ${shortMoney(Math.max(0, limit - used))} left.`,
    });
    if (this.features.creditHolds) {
      const used = this.#sumCents(COMMITTED_STATUSES, purchase.id);
      if (used + amountCents > this.rules.budgetCents) return declined('allocation', 'your', this.rules.budgetCents, used);
      if (used + amountCents > this.#availableCredit()) return declined('credit', 'your', this.#availableCredit(), used);

      if (this.features.splitByAgent && Object.keys(this.agentShares).length > 0) {
        if (!Object.hasOwn(this.agentShares, purchase.agentId)) {
          return { code: 'agent_share', reason: `Declined at checkout: ${purchase.agentName} has no share of your ${shortMoney(this.rules.budgetCents)} agent limit.` };
        }
        const share = this.agentShares[purchase.agentId];
        const agentUsed = this.#sumBy('agentId', purchase.agentId, COMMITTED_STATUSES, purchase.id);
        if (agentUsed + amountCents > share) return declined('agent_share', `${purchase.agentName}'s`, share, agentUsed);
      }
    }

    const connectionUsed = this.#sumBy('connectionId', purchase.connectionId, COMMITTED_STATUSES, purchase.id);
    if (connectionUsed + amountCents > limits.budgetCents) return declined('consent', `${purchase.agentName}'s`, limits.budgetCents, connectionUsed);
    return null;
  }

  #executionProblem(purchase, final, limits) {
    const { amountCents } = final;
    const { needsApproval, reason } = this.#assess(amountCents, limits);
    if (needsApproval && !purchase.customerApproved) {
      return { code: 'approval_required', reason: `${reason} Your approval is required.` };
    }
    return this.#capacityProblem(purchase, amountCents, limits);
  }

  #charge(purchase, reason) {
    this.#settle(purchase, 'completed', reason);
    this.#addTrail(purchase, 'Charged', `${money(purchase.amountCents)} at ${purchase.merchantName}.`);
    this.#record('payment', `Charged ${money(purchase.amountCents)} to ${purchase.agentName}'s test token at ${purchase.merchantName}. No real money moved.`, purchase);
    this.#auditCharge(purchase);
  }

  // Runs after money moves and shares no decision with the pre-charge checks.
  #auditCharge(purchase) {
    if (!this.features.overreach) return;
    const problems = [];
    const committed = this.#sumCents(COMMITTED_STATUSES, purchase.id);
    if (!purchase.cleared) problems.push('the guard never cleared it');
    if (this.features.creditHolds && committed + purchase.amountCents > this.rules.budgetCents) problems.push('it goes over your agent limit');
    if (this.features.creditHolds && committed + purchase.amountCents > this.#availableCredit()) problems.push('it goes over your available credit');
    if (this.features.approvals && purchase.amountCents > this.rules.approvalCents && !purchase.customerApproved) problems.push('it needed your approval');
    const limits = purchase.connectionId && this.connections.limits(purchase.connectionId, this.#nowMs());
    if (limits && this.#sumBy('connectionId', purchase.connectionId, COMMITTED_STATUSES, purchase.id) + purchase.amountCents > limits.budgetCents) {
      problems.push('it goes over this agent\'s budget');
    }
    if (problems.length === 0) return;

    const summary = `${money(purchase.amountCents)} at ${purchase.merchantName} went through outside your rules: ${problems.join(', ')}.`;
    purchase.flagged = true;
    purchase.reason = summary;
    this.#record('guard', `Flagged charge: ${summary}`, purchase, true);
    this.alerts.push({ id: randomUUID(), at: this.#nowIso(), purchaseId: purchase.id, message: summary });
    this.#pause();
  }

  #pause() {
    if (this.paused) return;
    this.paused = true;
    this.pauseReason = FLAGGED_PAUSE;
    this.agentStatus = { running: this.agentStatus.running, message: 'Paused after a flagged charge.' };
    this.#record('guard', 'Paused all agents automatically after a flagged charge.', null, true);
    this.#cancelOpen('The agent was paused after a flagged charge.');
  }

  #applyLowerPrice(purchase, amountCents) {
    purchase.originalCents = purchase.amountCents;
    purchase.amountCents = amountCents;
    this.#record('guard', `Allowed lower final price for ${purchase.item}: ${money(amountCents)} instead of the ${money(purchase.originalCents)} ${this.#agreedBy(purchase)}.`, purchase);
  }

  // Sends any reminders that are due, and ends approvals and holds that have run out of time.
  #sweepApprovals() {
    let changed = false;
    const lapsed = this.purchases.filter((p) => ['authorized', 'held'].includes(p.status) && this.#nowMs() >= Date.parse(p.expiresAt));
    for (const purchase of lapsed) {
      const reason = purchase.status === 'held' ? 'the hold expired before the charge settled' : 'it expired before checkout';
      purchase.code = 'expired';
      this.#settle(purchase, 'canceled', `Canceled because ${reason}.`);
      this.#record('guard', `Canceled ${purchase.item} at ${purchase.merchantName}: ${reason}.`, purchase);
      changed = true;
    }
    for (const purchase of this.purchases.filter((p) => p.status === 'pending')) {
      const elapsedDays = (this.#nowMs() - Date.parse(purchase.at)) / DAY_MS;
      const reminderDue = Math.min(Math.floor(elapsedDays), REMINDER_COUNT);
      if (elapsedDays >= APPROVAL_DAYS) {
        const reason = `Auto-denied: no decision within ${dayWord(APPROVAL_DAYS)}.`;
        purchase.code = 'expired';
        this.#settle(purchase, 'denied', reason);
        this.#record('guard', `Auto-denied ${purchase.item} at ${purchase.merchantName}: no decision within ${dayWord(APPROVAL_DAYS)}.`, purchase);
        changed = true;
      } else if (reminderDue > purchase.remindersSent) {
        purchase.remindersSent = reminderDue;
        purchase.reminder = `Reminder ${reminderDue} of ${REMINDER_COUNT} - this request expires in ${dayWord(APPROVAL_DAYS - reminderDue)}`;
        this.#record('reminder', `${purchase.reminder}: ${purchase.item} at ${purchase.merchantName}.`, purchase);
        changed = true;
      }
    }
    return changed;
  }

  #cancelOpen(reason, { connectionId = null, statuses = OPEN_STATUSES, code = null } = {}) {
    const open = this.purchases.filter((p) => statuses.includes(p.status) && (connectionId === null || p.connectionId === connectionId));
    for (const purchase of open) {
      if (code) purchase.code = code;
      this.#settle(purchase, 'canceled', reason);
      this.#record('guard', `Canceled ${purchase.item} at ${purchase.merchantName}: ${reason}`, purchase);
    }
    return open;
  }

  // Only the plan the customer reviewed counts. The agent's own account of what it is buying does not.
  #isOffPlan(purchase) {
    const plan = this.#activePlan;
    if (!plan || plan.connectionId !== purchase.connectionId) return false;
    return !plan.items.some((step) => step.merchantId === purchase.merchantId && step.item === purchase.item && purchase.amountCents <= step.amountCents);
  }

  #spendingByCategory() {
    const rows = Object.entries(this.catalog.categoryIcons).map(([category, icon]) => ({
      category,
      icon,
      spentCents: this.#sumBy('category', category, ['completed']),
      heldCents: this.#sumBy('category', category, ['held']),
    }));
    return rows.filter((row) => row.spentCents + row.heldCents > 0);
  }

  #spendingByAgent(connections, remainingCents) {
    const split = this.features.splitByAgent && Object.keys(this.agentShares).length > 0;
    return this.catalog.agents.map((agent) => {
      const spentCents = this.#sumBy('agentId', agent.id, ['completed']);
      const heldCents = this.#sumBy('agentId', agent.id, ['held']);
      const allocationCents = split ? (this.agentShares[agent.id] ?? 0) : this.rules.budgetCents;
      return {
        agentId: agent.id,
        name: agent.name,
        icon: agent.icon,
        connected: connections.some((c) => c.agentId === agent.id && c.status === 'active'),
        shared: !split,
        allocationCents,
        spentCents,
        heldCents,
        remainingCents: split ? Math.max(0, allocationCents - spentCents - heldCents) : remainingCents,
      };
    }).filter((row) => row.connected || row.spentCents + row.heldCents > 0 || Object.hasOwn(this.agentShares, row.agentId));
  }

  snapshot() {
    const spentCents = this.#sumCents(['completed']);
    const heldCents = this.#sumCents(['held']);
    const remainingCents = Math.max(0, this.rules.budgetCents - spentCents - heldCents);
    const holds = this.purchases.filter((p) => p.status === 'held').map((p) => ({
      purchaseId: p.id,
      item: p.item,
      merchantName: p.merchantName,
      merchantLogo: p.merchantLogo,
      agentName: p.agentName,
      amountCents: p.amountCents,
      expiresAt: p.expiresAt,
    }));
    const spend = {};
    for (const purchase of this.purchases) {
      if (COMMITTED_STATUSES.includes(purchase.status) && purchase.connectionId) {
        spend[purchase.connectionId] = (spend[purchase.connectionId] ?? 0) + purchase.amountCents;
      }
    }
    const connections = this.connections.list(this.#nowMs(), spend);
    return {
      rules: this.rules,
      agentShares: this.agentShares,
      credit: { ...this.credit, availableCents: this.#availableCredit() },
      allocation: { totalCents: this.rules.budgetCents, spentCents, heldCents, remainingCents },
      holds,
      spendingByAgent: this.#spendingByAgent(connections, remainingCents),
      spendingByCategory: this.#spendingByCategory(),
      merchants: this.catalog.merchants,
      demoAgents: this.catalog.agents,
      features: this.features,
      connections,
      refundReasons: REFUND_REASONS,
      now: this.#nowIso(),
      simulatedDays: this.#clockOffsetMs / DAY_MS,
      paused: this.paused,
      pauseReason: this.pauseReason,
      alerts: this.alerts,
      spentCents,
      heldCents,
      remainingCents,
      purchases: this.purchases,
      refunds: this.refunds,
      log: this.log,
      agent: this.agentStatus,
    };
  }

  getPurchase(id) {
    const purchase = this.purchases.find((p) => p.id === id);
    return purchase && { ...purchase };
  }

  // A consent can only narrow what the customer's own rules already allow.
  validatePermissions(input) {
    if (!input || typeof input !== 'object') throw new GuardError('Permissions are missing.');
    const { budgetCents, approvalCents, connectionExpiresOn } = input;
    const error = rulesError({ budgetCents, approvalCents });
    if (error) throw new GuardError(error);
    if (budgetCents > this.rules.budgetCents) throw new GuardError(`Budget cannot be more than your ${money(this.rules.budgetCents)} agent allocation.`);
    if (approvalCents > this.rules.approvalCents) throw new GuardError(`Approval amount cannot be more than your ${money(this.rules.approvalCents)} limit.`);
    if (typeof connectionExpiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(connectionExpiresOn)) {
      throw new GuardError('Choose a connection expiry date.');
    }
    const expiresAtMs = Date.parse(`${connectionExpiresOn}T23:59:59.999Z`);
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= this.#nowMs() || expiresAtMs > this.#nowMs() + MAX_CONNECTION_DAYS * DAY_MS) {
      throw new GuardError(`Connection expiry must be within the next ${MAX_CONNECTION_DAYS} days.`);
    }
    const trustLevel = Object.hasOwn(TRUST_APPROVALS, input.trustLevel) ? input.trustLevel : 'above';
    return {
      budgetCents,
      approvalCents: TRUST_APPROVALS[trustLevel](approvalCents, this.rules),
      trustLevel,
      connectionExpiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  nowMs() {
    return this.#nowMs();
  }

  setRules(rules) {
    const error = rulesError(rules);
    if (error) throw new GuardError(error);
    if (rules.budgetCents > this.#availableCredit()) {
      throw new GuardError(`Agent allocation cannot be more than your ${money(this.#availableCredit())} available credit.`);
    }
    const shares = rules.agentShares ?? this.agentShares;
    this.#validateShares(shares, rules.budgetCents);
    this.agentShares = { ...shares };
    this.rules = { budgetCents: rules.budgetCents, approvalCents: rules.approvalCents };
    const split = Object.entries(this.agentShares).map(([id, cents]) => `${this.#agent(id).shortName} ${money(cents)}`).join(', ');
    this.#record('customer', `Set rules: ${money(this.rules.budgetCents)} agent allocation${split ? ` (split: ${split})` : ''}, approval above ${money(this.rules.approvalCents)}.`);
    this.#notify();
  }

  #agent(id) {
    return this.catalog.agents.find((a) => a.id === id);
  }

  #validateShares(shares, allocationCents) {
    if (!shares || typeof shares !== 'object' || Array.isArray(shares)) throw new GuardError('Agent shares are not valid.');
    const entries = Object.entries(shares);
    if (!entries.every(([id, cents]) => this.#agent(id) && isCents(cents))) {
      throw new GuardError('Agent shares must be valid amounts for known agents.');
    }
    const total = entries.reduce((sum, [, cents]) => sum + cents, 0);
    if (total > allocationCents) {
      throw new GuardError(`Agent shares add up to ${money(total)}, which is more than your ${money(allocationCents)} agent allocation.`);
    }
  }

  // Only this agent's token stops working and only its open purchases are canceled.
  // Returns what was stopped, so the customer can be told exactly that.
  revokeConnection(connectionId) {
    if (!this.connections.revoke(connectionId, this.#nowMs())) throw new GuardError('Connection not found.', 404);
    const name = this.connections.list(this.#nowMs()).find((c) => c.id === connectionId).shortName;
    const releasedCents = this.#sumBy('connectionId', connectionId, ['held']);
    this.#record('customer', `Revoked ${name}'s access. Its test token no longer works.`);
    if (this.#activePlan?.connectionId === connectionId) this.#activePlan = null;
    const canceled = this.#cancelOpen('Access was revoked before the charge.', { connectionId, code: 'no_access' });
    for (const purchase of canceled) this.#addTrail(purchase, 'Access revoked', `You removed ${name} before this was charged.`);
    this.#notify();
    return {
      connectionId,
      agentName: name,
      releasedCents,
      canceled: canceled.map(({ id, item, merchantName, amountCents }) => ({ id, item, merchantName, amountCents })),
    };
  }

  // Whether this token has lost its connection for good. An expired or paused agent has not.
  tokenRevoked(token) {
    return !this.connections.authorize(token, this.#nowMs()).connection;
  }

  // Fixes what the customer agreed to before the agent starts. Anything else needs their approval.
  startPlan(token, items) {
    const { connection } = this.connections.authorize(token, this.#nowMs());
    this.#activePlan = connection ? { connectionId: connection.id, items } : null;
  }

  endPlan() {
    this.#activePlan = null;
  }

  // Tells the customer, before the agent starts, which items will come back to them. Null if it can't be known.
  willAskFirst(connectionId, amountCents) {
    const limits = connectionId && this.connections.limits(connectionId, this.#nowMs());
    return limits ? this.#assess(amountCents, limits).needsApproval ?? null : null;
  }

  // The customer's panic button. Reversible, so it pauses agents rather than disconnecting them.
  stopAllAgents() {
    if (this.paused) return;
    this.paused = true;
    this.pauseReason = CUSTOMER_STOP;
    this.agentStatus = { running: this.agentStatus.running, message: 'Stopped. You stopped all agents.' };
    this.#record('customer', 'Stopped all agents.', null);
    this.#cancelOpen('You stopped all agents.');
    this.#notify();
  }

  resumeAgent() {
    if (!this.paused) return;
    this.paused = false;
    this.pauseReason = null;
    this.alerts = [];
    this.agentStatus = { running: this.agentStatus.running, message: 'Resumed. Ready to shop.' };
    this.#record('customer', 'Reviewed the flagged charge and resumed agents.');
    this.#notify();
  }

  checkApprovals() {
    if (this.#sweepApprovals()) this.#notify();
  }

  // Test control: moves the clock forward so reminders and expiry can be seen without waiting.
  advanceDay() {
    this.#clockOffsetMs += DAY_MS;
    this.#record('clock', `Simulated time moved forward. Now ${dayWord(this.#clockOffsetMs / DAY_MS)} ahead.`);
    this.#sweepApprovals();
    this.#notify();
  }

  // First gate: records the intent and decides whether it needs approval. It reserves nothing.
  attempt({ token, merchantId, item, amountCents, overreach = false, why = null, ask = null }) {
    const auth = this.#authorize(token);
    const purchase = this.#open({ merchantId, item, amountCents, overreach, why, ask }, auth.connection);
    this.#record('agent', `${purchase.agentName} tried to buy ${item} for ${money(amountCents)} at ${purchase.merchantName}.`, purchase);

    if (auth.problem) {
      this.#block(purchase, auth.problem.code, auth.problem.reason);
    } else {
      purchase.consentVersion = auth.consent?.version ?? 1;
      this.#addTrail(purchase, 'Your rules', `Agent limit ${shortMoney(this.rules.budgetCents)}, approval above ${shortMoney(Math.min(this.rules.approvalCents, auth.limits.approvalCents))}.`);
      this.#addTrail(purchase, 'Your consent', `${purchase.agentName}, consent version ${purchase.consentVersion}.`);
      const { problem, needsApproval, reason } = this.#assess(amountCents, auth.limits);
      purchase.offPlan = this.#isOffPlan(purchase);
      if (purchase.offPlan) this.#addTrail(purchase, 'Not on your plan', OFF_PLAN_REASON);
      if (problem) {
        this.#block(purchase, problem.code, problem.reason);
      } else if (this.#isDuplicate(purchase)) {
        this.#block(purchase, 'duplicate', 'Duplicate of a recent purchase with the same merchant, item, and amount.');
      } else if (purchase.offPlan && !this.features.approvals) {
        this.#block(purchase, 'off_plan', OFF_PLAN_REASON);
      } else if (needsApproval || purchase.offPlan) {
        purchase.reason = purchase.offPlan ? OFF_PLAN_REASON : reason;
        this.#setExpiry(purchase, Date.parse(purchase.at));
        this.#record('guard', `Waiting for your approval on ${item}: ${purchase.reason}`, purchase);
      } else {
        purchase.cleared = true;
        purchase.status = 'authorized';
        purchase.reason = reason;
        this.#addTrail(purchase, 'No approval needed', reason);
        this.#setExpiry(purchase);
        this.#record('guard', `Cleared ${item}: ${reason}`, purchase);
      }
    }
    this.#notify();
    return { ...purchase };
  }

  // Final gate: executes a cleared purchase and places its hold.
  // Keep this method synchronous: checking the limits and placing the hold must be one step,
  // so that simultaneous purchases are handled one after another and each sees the last one's hold.
  checkout({ token, purchaseId, merchantId, item, amountCents, overreach = false, signature }) {
    const final = { merchantId, item, amountCents, overreach };
    const purchase = this.purchases.find((p) => p.id === purchaseId);
    const auth = this.#authorize(token);
    let result;

    if (purchase?.status === 'authorized') {
      this.#record('agent', `${purchase.agentName} submitted final checkout: ${item} for ${money(amountCents)} at ${this.catalog.merchantFor(merchantId).name}.`, purchase);
      let problem = auth.problem;
      if (!problem && auth.connection.id !== purchase.connectionId) {
        problem = { code: 'wrong_token', reason: 'This purchase was cleared for a different agent.' };
      }
      const verified = !this.features.agentVerification
        || this.agentDirectory.verify(purchase.agentId, checkoutPayload({ purchaseId, merchantId, item, amountCents }), signature);
      if (!problem && !verified) problem = { code: 'unverified_agent', reason: 'The merchant could not verify this agent.' };
      problem ??= this.#mismatchProblem(purchase, final) ?? this.#executionProblem(purchase, final, auth.limits);
      if (problem) {
        this.#block(purchase, problem.code, problem.reason);
      } else {
        let reason = purchase.customerApproved ? 'You approved this purchase.' : 'Within your rules.';
        if (amountCents < purchase.amountCents) {
          reason = `${reason} Final price was lower than the ${money(purchase.amountCents)} quoted.`;
          this.#applyLowerPrice(purchase, amountCents);
        }
        if (this.features.agentVerification) {
          this.#addTrail(purchase, 'Agent verified', `${purchase.merchantName} confirmed the request came from ${purchase.agentName}.`);
          this.#record('guard', `${purchase.merchantName} verified ${purchase.agentName}'s signature.`, purchase);
        }
        purchase.signal = {
          agent: purchase.agentName,
          agentVerified: this.features.agentVerification,
          customerPresent: purchase.customerApproved,
          consentVersion: purchase.consentVersion,
        };
        if (this.features.creditHolds) this.#placeHold(purchase, reason);
        else this.#charge(purchase, reason);
      }
      result = purchase;
    } else {
      // Nothing is cleared for this charge, so it is recorded separately and the original stays as it was.
      result = this.#open(final, auth.connection);
      this.#record('agent', `${result.agentName} tried to charge ${item} for ${money(amountCents)} at ${result.merchantName}.`, result);
      if (purchase && COMMITTED_STATUSES.includes(purchase.status)) this.#block(result, 'duplicate', 'This purchase has already been charged.');
      else this.#block(result, 'not_cleared', 'This charge was not cleared by the guard.');
    }
    this.#notify();
    return { ...result };
  }

  // The merchant's mock settlement: turns an active hold into a charge.
  settleCharge(purchaseId) {
    const purchase = this.purchases.find((p) => p.id === purchaseId);
    if (purchase?.status !== 'held') return null;
    this.#charge(purchase, purchase.reason);
    this.#notify();
    return { ...purchase };
  }

  // A settled charge from the mock processor that never passed through checkout.
  recordUnclearedCharge({ merchantId, item, amountCents }) {
    const purchase = this.#open({ merchantId, item, amountCents });
    this.#settle(purchase, 'completed', 'This charge did not pass through the guard.');
    this.#record('payment', `Mock processor reported a ${money(amountCents)} charge at ${purchase.merchantName} that the guard never cleared. No real money moved.`, purchase);
    this.#auditCharge(purchase);
    this.#notify();
    return { ...purchase };
  }

  waitForDecision(id) {
    const purchase = this.purchases.find((p) => p.id === id);
    if (purchase?.status !== 'pending') return Promise.resolve();
    return new Promise((resolve) => this.#waiters.set(id, resolve));
  }

  decide(id, approve) {
    this.checkApprovals();
    const purchase = this.purchases.find((p) => p.id === id);
    if (!purchase) throw new GuardError('Purchase not found.', 404);
    if (purchase.status !== 'pending') throw new GuardError('This purchase has already been decided.', 409);

    if (!approve) {
      this.#settle(purchase, 'denied', 'You denied this purchase.');
      this.#record('customer', `Denied ${purchase.item} at ${purchase.merchantName}.`, purchase);
    } else {
      this.#record('customer', `Approved ${purchase.item} at ${purchase.merchantName}.`, purchase);
      purchase.customerApproved = true;
      if (this.connections.limits(purchase.connectionId, this.#nowMs())) {
        purchase.cleared = true;
        this.#setExpiry(purchase);
        this.#addTrail(purchase, 'You approved', `Approved ${money(purchase.amountCents)}.`);
        this.#settle(purchase, 'authorized', 'You approved this purchase.');
      } else {
        this.#block(purchase, 'no_access', 'The agent does not have access.');
      }
    }
    this.#notify();
    return { ...purchase };
  }

  // The customer takes over: the agent stops pursuing this purchase.
  takeOver(id) {
    this.checkApprovals();
    const purchase = this.purchases.find((p) => p.id === id);
    if (!purchase) throw new GuardError('Purchase not found.', 404);
    if (purchase.status !== 'pending') throw new GuardError('This purchase has already been decided.', 409);
    purchase.code = 'handed_off';
    this.#addTrail(purchase, 'You took over', 'You chose to buy this yourself.');
    this.#settle(purchase, 'denied', 'You chose to buy this yourself.');
    this.#record('customer', `Chose to buy ${purchase.item} themselves instead of the agent.`, purchase);
    this.#notify();
    return { ...purchase };
  }

  reportProblem(purchaseId, { reason, note = '' }) {
    if (!this.features.refunds) throw new GuardError('Report and refund tracking is not enabled.', 403);
    const purchase = this.purchases.find((p) => p.id === purchaseId);
    if (!purchase) throw new GuardError('Purchase not found.', 404);
    if (!Object.hasOwn(REFUND_REASONS, reason)) throw new GuardError('Choose a reason.');
    if (typeof note !== 'string' || note.length > MAX_NOTE_LENGTH) {
      throw new GuardError(`Notes can be up to ${MAX_NOTE_LENGTH} characters.`);
    }
    if (this.refunds.some((r) => r.purchaseId === purchaseId)) {
      throw new GuardError('This purchase already has a refund request.', 409);
    }

    const now = new Date(this.#nowMs());
    const charged = purchase.status === 'completed';
    const refund = {
      id: randomUUID(),
      ref: `RF-${1001 + this.refunds.length}`,
      purchaseId,
      item: purchase.item,
      merchantName: purchase.merchantName,
      amountCents: charged ? purchase.amountCents : 0,
      charged,
      reason,
      reasonLabel: REFUND_REASONS[reason],
      note: note.trim(),
      evidence: purchase.trail.map((step) => ({ ...step })),
      outcome: null,
      stageIndex: 0,
      createdAt: now.toISOString(),
      resolvedAt: null,
      expectedResolveAt: new Date(now.getTime() + REFUND_STAGES.at(-1).days * DAY_MS).toISOString(),
      expectedDays: REFUND_STAGES.at(-1).days,
      timeline: REFUND_STAGES.map((stage, index) => ({
        id: stage.id,
        label: stage.label,
        at: index === 0 ? now.toISOString() : null,
        expectedAt: new Date(now.getTime() + stage.days * DAY_MS).toISOString(),
      })),
    };
    this.refunds.push(refund);
    this.#record('refund', `Refund request ${refund.ref} submitted for ${purchase.item}: ${refund.reasonLabel}.`, purchase);
    this.#notify();
    return { ...refund };
  }

  advanceRefund(id, outcome) {
    const refund = this.refunds.find((r) => r.id === id);
    if (!refund) throw new GuardError('Refund request not found.', 404);
    if (refund.outcome) throw new GuardError('This refund request is already resolved.', 409);

    const nextIndex = refund.stageIndex + 1;
    const next = refund.timeline[nextIndex];
    const now = this.#nowIso();
    const purchase = this.purchases.find((p) => p.id === refund.purchaseId);

    if (next.id === 'resolved') {
      if (!['refunded', 'declined'].includes(outcome)) throw new GuardError('Choose Refunded or Declined.');
      refund.outcome = refund.charged ? outcome : 'declined';
      refund.resolvedAt = now;
      next.label = refund.outcome === 'refunded' ? 'Refunded' : 'Declined';
      if (refund.outcome === 'refunded') {
        purchase.status = 'refunded';
        purchase.reason = `Refunded through ${refund.ref}.`;
      } else if (!refund.charged) {
        refund.declineReason = 'Nothing was charged for this purchase, so there is nothing to refund.';
      }
    }
    refund.stageIndex = nextIndex;
    next.at = now;
    this.#record('refund', `Refund request ${refund.ref}: ${next.label}.`, purchase);
    this.#notify();
    return { ...refund };
  }

  setAgentStatus(running, message, logMessage) {
    this.agentStatus = { running, message };
    if (logMessage) this.#record('agent', logMessage);
    this.#notify();
  }

  // Clears the demo data. The audit log itself is append-only and keeps every entry.
  reset() {
    for (const resolve of this.#waiters.values()) resolve();
    this.#waiters.clear();
    const lastEntry = this.#record('customer', 'Reset the demo.');
    this.#clear();
    this.#auditFloor = lastEntry;
    this.#notify();
  }
}
