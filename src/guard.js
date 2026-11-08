import { randomUUID } from 'node:crypto';
import { AGENT_COMPANIES, DEFAULT_MERCHANT_AGENTS, DEMO_AGENTS, MERCHANTS, merchantFor, productFor } from './catalog.js';
import { GuardError } from './errors.js';

export { GuardError };

// budgetCents is the agent allocation: how much of the customer's available credit agents may use.
export const DEFAULT_RULES = {
  budgetCents: 50000,
  allowedMerchantIds: ['grocer', 'market', 'pharmacy', 'wellness'],
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
const HOLD_STATUSES = ['pending', 'authorized'];
const COMMITTED_STATUSES = ['completed', ...HOLD_STATUSES];
const PERSISTED_FIELDS = ['rules', 'agentShares', 'credit', 'merchantAgents', 'purchases', 'refunds', 'alerts', 'paused'];

const isCents = (value) => Number.isSafeInteger(value) && value >= 0;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const shortMoney = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const merchantName = (id) => merchantFor(id).name;
const dayWord = (days) => (days === 1 ? '1 day' : `${days} days`);

export function rulesError(rules) {
  if (!rules || typeof rules !== 'object') return 'Rules are missing.';
  if (!isCents(rules.budgetCents)) return 'Budget must be a valid amount.';
  if (!isCents(rules.approvalCents)) return 'Approval amount must be a valid amount.';
  const ids = rules.allowedMerchantIds;
  if (!Array.isArray(ids) || !ids.every((id) => MERCHANTS.some((m) => m.id === id))) {
    return 'Allowed merchants must be known merchants.';
  }
  return null;
}

// Anything that cannot be checked is blocked, so a purchase only proceeds on a positive result.
export function evaluate(rules, committedCents, merchantId, amountCents, overLimitReason = 'Purchase would go over your budget.') {
  if (rulesError(rules)) return { outcome: 'block', reason: 'Rules could not be checked.' };
  if (!isCents(committedCents) || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { outcome: 'block', reason: 'Purchase amount could not be checked.' };
  }
  if (!rules.allowedMerchantIds.includes(merchantId)) {
    return { outcome: 'block', reason: 'Merchant is not on your allowed list.' };
  }
  if (committedCents + amountCents > rules.budgetCents) {
    return { outcome: 'block', reason: overLimitReason, overLimit: true };
  }
  if (amountCents > rules.approvalCents) {
    return { outcome: 'approval', reason: `Over your ${money(rules.approvalCents)} approval amount.` };
  }
  return { outcome: 'allow', reason: 'Within your rules.' };
}

export class Guard {
  #waiters = new Map();
  #listeners = new Set();
  #clockOffsetMs = 0;
  #auditFloor = 0;
  #persist;
  #appendAudit;

  constructor({ connections, saved = null, log = [], persist = () => {}, appendAudit = () => 0 }) {
    this.connections = connections;
    this.#persist = persist;
    this.#appendAudit = appendAudit;
    this.#clear();
    if (saved) {
      for (const field of PERSISTED_FIELDS) this[field] = saved[field] ?? this[field];
      this.#clockOffsetMs = saved.clockOffsetMs;
      this.#auditFloor = saved.auditFloor;
      this.log = log;
      // No agent survives a restart to finish these, so they cannot be left holding budget.
      if (this.#cancelHeld('The server restarted before this purchase finished.')) this.#persist(this.#serialize());
    }
  }

  #nowMs() {
    return Date.now() + this.#clockOffsetMs;
  }

  #nowIso() {
    return new Date(this.#nowMs()).toISOString();
  }

  #clear() {
    this.#clockOffsetMs = 0;
    this.rules = structuredClone(DEFAULT_RULES);
    this.agentShares = {};
    this.credit = { ...DEFAULT_CREDIT };
    this.merchantAgents = structuredClone(DEFAULT_MERCHANT_AGENTS);
    this.purchases = [];
    this.log = [];
    this.refunds = [];
    this.alerts = [];
    this.paused = false;
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

  #sumAgentCents(purchase) {
    return this.purchases
      .filter((p) => COMMITTED_STATUSES.includes(p.status) && p.id !== purchase.id && p.connectionId === purchase.connectionId)
      .reduce((total, p) => total + p.amountCents, 0);
  }

  #open({ merchantId, item, amountCents, overreach = false }, connection = null) {
    const merchant = merchantFor(merchantId);
    const product = productFor(item);
    const purchase = {
      id: randomUUID(),
      at: this.#nowIso(),
      merchantId,
      merchantName: merchant.name,
      merchantLogo: merchant.logo,
      connectionId: connection?.id ?? null,
      agentId: connection?.agentId ?? null,
      agentCompanyId: connection?.companyId ?? null,
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
    };
    this.purchases.push(purchase);
    return purchase;
  }

  #settle(purchase, status, reason) {
    purchase.status = status;
    purchase.reason = reason;
    purchase.settledAt = this.#nowIso();
    if (purchase.holdOpen && !HOLD_STATUSES.includes(status)) {
      purchase.holdOpen = false;
      if (status !== 'completed') this.#record('guard', `Released the ${money(purchase.amountCents)} hold on ${purchase.item}.`, purchase);
    }
    this.#waiters.get(purchase.id)?.();
    this.#waiters.delete(purchase.id);
  }

  #block(purchase, code, reason) {
    purchase.code = code;
    this.#record('guard', `Blocked ${purchase.item}: ${reason.replace(/^Blocked: /, '')}`, purchase);
    this.#settle(purchase, 'blocked', reason);
  }

  #placeHold(purchase) {
    purchase.holdOpen = true;
    purchase.expiresAt = new Date(Date.parse(purchase.at) + APPROVAL_DAYS * DAY_MS).toISOString();
    this.#record('guard', `Placed a ${money(purchase.amountCents)} hold for ${purchase.item}.`, purchase);
  }

  #availableCredit() {
    return this.credit.creditLimitCents - this.credit.balanceCents;
  }

  #agentCommittedCents(agentId, excludeId) {
    return this.purchases
      .filter((p) => COMMITTED_STATUSES.includes(p.status) && p.id !== excludeId && p.agentId === agentId)
      .reduce((total, p) => total + p.amountCents, 0);
  }

  // Limits beyond the allocation itself: available credit, then this agent's share if split.
  #creditProblem(purchase, amountCents, committed) {
    const available = this.#availableCredit();
    if (committed + amountCents > available) {
      return { code: 'credit', reason: `Blocked: would exceed your ${shortMoney(available)} available credit (${shortMoney(committed)} already used or on hold)` };
    }
    if (Object.keys(this.agentShares).length === 0 || !purchase.agentId) return null;
    if (!Object.hasOwn(this.agentShares, purchase.agentId)) {
      return { code: 'agent_share', reason: `Blocked: ${purchase.agentName} has no share of your ${shortMoney(this.rules.budgetCents)} agent limit` };
    }
    const share = this.agentShares[purchase.agentId];
    const agentCommitted = this.#agentCommittedCents(purchase.agentId, purchase.id);
    if (agentCommitted + amountCents > share) {
      return { code: 'agent_share', reason: `Blocked: would exceed ${purchase.agentName}'s ${shortMoney(share)} share (${shortMoney(agentCommitted)} already used or on hold)` };
    }
    return null;
  }

  // Checks the token and its signed consent, then whether the customer's agents are paused.
  #authorize(token) {
    const auth = this.connections.authorize(token, this.#nowMs());
    if (auth.problem) return auth;
    if (this.paused) return { ...auth, problem: { code: 'paused', reason: 'The agent is paused after a flagged charge.' } };
    return auth;
  }

  #isDuplicate(purchase) {
    const now = Date.parse(purchase.at);
    return this.purchases.some((p) => p.id !== purchase.id
      && COMMITTED_STATUSES.includes(p.status)
      && p.merchantId === purchase.merchantId
      && p.item === purchase.item
      && p.amountCents === purchase.amountCents
      && now - Date.parse(p.at) < DUPLICATE_WINDOW_MS);
  }

  #merchantRefusesAgent(merchantId, companyId) {
    return companyId !== null
      && Object.hasOwn(this.merchantAgents, merchantId)
      && !this.merchantAgents[merchantId].includes(companyId);
  }

  #partnerProblem(purchase) {
    if (!this.#merchantRefusesAgent(purchase.merchantId, purchase.agentCompanyId)) return null;
    const company = AGENT_COMPANIES.find((c) => c.id === purchase.agentCompanyId);
    return { code: 'merchant_agent', reason: `${purchase.merchantName} does not accept agents from ${company.name}.` };
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
      return { code: 'mismatch', reason: `Final merchant ${merchantName(final.merchantId)} is not the ${purchase.merchantName} ${agreed}.` };
    }
    if (final.item !== purchase.item) {
      return { code: 'mismatch', reason: `Final item ${final.item} is not the ${purchase.item} ${agreed}.` };
    }
    return null;
  }

  // A purchase has to fit both the customer's rules and this agent's signed consent.
  #assess(purchase, amountCents, limits) {
    const committed = this.#sumCents(COMMITTED_STATUSES, purchase.id);
    const overLimit = `Blocked: would exceed your ${shortMoney(this.rules.budgetCents)} agent limit (${shortMoney(committed)} already used or on hold)`;
    const byRules = evaluate(this.rules, committed, purchase.merchantId, amountCents, overLimit);
    if (byRules.outcome === 'block') return { problem: { code: byRules.overLimit ? 'allocation' : 'rules', reason: byRules.reason } };
    const credit = this.#creditProblem(purchase, amountCents, committed);
    if (credit) return { problem: credit };
    const byConsent = evaluate(limits, this.#sumAgentCents(purchase), purchase.merchantId, amountCents);
    if (byConsent.outcome === 'block') {
      return { problem: { code: 'consent', reason: `Outside this agent's permissions. ${byConsent.reason}` } };
    }
    const partner = this.#partnerProblem(purchase);
    if (partner) return { problem: partner };
    const held = [byRules, byConsent].find((result) => result.outcome === 'approval');
    return { needsApproval: Boolean(held), reason: held?.reason ?? byRules.reason };
  }

  #limitsProblem(purchase, amountCents, limits) {
    const { problem, needsApproval, reason } = this.#assess(purchase, amountCents, limits);
    if (problem) return problem;
    if (needsApproval && !purchase.customerApproved) {
      return { code: 'approval_required', reason: `${reason} Your approval is required.` };
    }
    return null;
  }

  #charge(purchase, reason) {
    this.#settle(purchase, 'completed', reason);
    this.#record('payment', `Charged ${money(purchase.amountCents)} to ${purchase.agentName}'s test token at ${purchase.merchantName}. No real money moved.`, purchase);
    this.#auditCharge(purchase);
  }

  // Runs after money moves and shares no decision with the pre-charge checks.
  #auditCharge(purchase) {
    const problems = [];
    const committed = this.#sumCents(COMMITTED_STATUSES, purchase.id);
    if (!purchase.cleared) problems.push('the guard never cleared it');
    if (!this.rules.allowedMerchantIds.includes(purchase.merchantId)) problems.push('the merchant is not on your allowed list');
    if (this.#merchantRefusesAgent(purchase.merchantId, purchase.agentCompanyId)) problems.push('the merchant does not accept this agent company');
    if (committed + purchase.amountCents > this.rules.budgetCents) problems.push('it goes over your agent limit');
    if (committed + purchase.amountCents > this.#availableCredit()) problems.push('it goes over your available credit');
    if (purchase.amountCents > this.rules.approvalCents && !purchase.customerApproved) problems.push('it needed your approval');
    const limits = purchase.connectionId && this.connections.limits(purchase.connectionId, this.#nowMs());
    if (limits) {
      if (!limits.allowedMerchantIds.includes(purchase.merchantId)) problems.push('the merchant is outside this agent\'s permissions');
      if (this.#sumAgentCents(purchase) + purchase.amountCents > limits.budgetCents) problems.push('it goes over this agent\'s budget');
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
    this.agentStatus = { running: this.agentStatus.running, message: 'Paused after a flagged charge.' };
    this.#record('guard', 'Paused all agents automatically after a flagged charge.', null, true);
    this.#cancelHeld('The agent was paused after a flagged charge.');
  }

  #applyLowerPrice(purchase, amountCents) {
    purchase.originalCents = purchase.amountCents;
    purchase.amountCents = amountCents;
    this.#record('guard', `Allowed lower final price for ${purchase.item}: ${money(amountCents)} instead of the ${money(purchase.originalCents)} ${this.#agreedBy(purchase)}.`, purchase);
    this.#record('guard', `Released ${money(purchase.originalCents - amountCents)} of the hold on ${purchase.item}.`, purchase);
  }

  // Sends any reminders that are due and auto-denies approvals that have run out of time.
  #sweepApprovals() {
    let changed = false;
    for (const purchase of this.purchases.filter((p) => p.status === 'authorized' && this.#nowMs() >= Date.parse(p.expiresAt))) {
      purchase.code = 'expired';
      this.#settle(purchase, 'canceled', 'The hold expired before the charge.');
      this.#record('guard', `Canceled ${purchase.item} at ${purchase.merchantName}: the hold expired before the charge.`, purchase);
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

  #cancelHeld(reason, connectionId = null) {
    const held = this.purchases.filter((p) => HOLD_STATUSES.includes(p.status) && (connectionId === null || p.connectionId === connectionId));
    for (const purchase of held) {
      this.#settle(purchase, 'canceled', reason);
      this.#record('guard', `Canceled ${purchase.item} at ${purchase.merchantName}: ${reason}`, purchase);
    }
    return held.length > 0;
  }

  #spendByConnection() {
    const spend = {};
    for (const purchase of this.purchases) {
      if (purchase.status === 'completed' && purchase.connectionId) {
        spend[purchase.connectionId] = (spend[purchase.connectionId] ?? 0) + purchase.amountCents;
      }
    }
    return spend;
  }

  snapshot() {
    const spentCents = this.#sumCents(['completed']);
    const heldCents = this.#sumCents(HOLD_STATUSES);
    const holds = this.purchases.filter((p) => HOLD_STATUSES.includes(p.status)).map((p) => ({
      purchaseId: p.id,
      item: p.item,
      merchantName: p.merchantName,
      merchantLogo: p.merchantLogo,
      agentName: p.agentName,
      amountCents: p.amountCents,
      status: p.status,
      expiresAt: p.expiresAt,
    }));
    const shares = Object.entries(this.agentShares).map(([agentId, shareCents]) => {
      const used = this.#agentCommittedCents(agentId);
      return { agentId, shortName: DEMO_AGENTS.find((a) => a.id === agentId).shortName, shareCents, usedCents: used, remainingCents: Math.max(0, shareCents - used) };
    });
    return {
      rules: this.rules,
      agentShares: this.agentShares,
      credit: { ...this.credit, availableCents: this.#availableCredit() },
      allocation: { totalCents: this.rules.budgetCents, spentCents, heldCents, remainingCents: Math.max(0, this.rules.budgetCents - spentCents - heldCents), shares },
      holds,
      merchants: MERCHANTS,
      agentCompanies: AGENT_COMPANIES,
      demoAgents: DEMO_AGENTS,
      merchantAgents: this.merchantAgents,
      connections: this.connections.list(this.#nowMs(), this.#spendByConnection()),
      refundReasons: REFUND_REASONS,
      now: this.#nowIso(),
      simulatedDays: this.#clockOffsetMs / DAY_MS,
      paused: this.paused,
      alerts: this.alerts,
      spentCents,
      heldCents,
      remainingCents: Math.max(0, this.rules.budgetCents - spentCents - heldCents),
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

  agentLimits(token) {
    return this.connections.authorize(token, this.#nowMs()).limits ?? null;
  }

  // A consent can only narrow what the customer's own rules already allow.
  validatePermissions(input) {
    if (!input || typeof input !== 'object') throw new GuardError('Permissions are missing.');
    const { budgetCents, approvalCents, allowedMerchantIds, connectionExpiresOn } = input;
    const error = rulesError({ budgetCents, approvalCents, allowedMerchantIds });
    if (error) throw new GuardError(error);
    if (budgetCents > this.rules.budgetCents) throw new GuardError(`Budget cannot be more than your ${money(this.rules.budgetCents)} agent allocation.`);
    if (approvalCents > this.rules.approvalCents) throw new GuardError(`Approval amount cannot be more than your ${money(this.rules.approvalCents)} limit.`);
    if (!allowedMerchantIds.every((id) => this.rules.allowedMerchantIds.includes(id))) {
      throw new GuardError('Allowed merchants must be on your Rules screen first.');
    }
    if (typeof connectionExpiresOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(connectionExpiresOn)) {
      throw new GuardError('Choose a connection expiry date.');
    }
    const expiresAtMs = Date.parse(`${connectionExpiresOn}T23:59:59.999Z`);
    if (Number.isNaN(expiresAtMs) || expiresAtMs <= this.#nowMs() || expiresAtMs > this.#nowMs() + MAX_CONNECTION_DAYS * DAY_MS) {
      throw new GuardError(`Connection expiry must be within the next ${MAX_CONNECTION_DAYS} days.`);
    }
    return {
      budgetCents,
      approvalCents,
      allowedMerchantIds: [...new Set(allowedMerchantIds)],
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
    this.rules = {
      budgetCents: rules.budgetCents,
      allowedMerchantIds: [...new Set(rules.allowedMerchantIds)],
      approvalCents: rules.approvalCents,
    };
    const names = this.rules.allowedMerchantIds.map(merchantName).join(', ') || 'none';
    const split = Object.entries(this.agentShares).map(([id, cents]) => `${DEMO_AGENTS.find((a) => a.id === id).shortName} ${money(cents)}`).join(', ');
    this.#record('customer', `Set rules: ${money(this.rules.budgetCents)} agent allocation${split ? ` (split: ${split})` : ''}, approval above ${money(this.rules.approvalCents)}, allowed merchants: ${names}.`);
    this.#notify();
  }

  #validateShares(shares, allocationCents) {
    if (!shares || typeof shares !== 'object' || Array.isArray(shares)) throw new GuardError('Agent shares are not valid.');
    const entries = Object.entries(shares);
    if (!entries.every(([id, cents]) => DEMO_AGENTS.some((a) => a.id === id) && isCents(cents))) {
      throw new GuardError('Agent shares must be valid amounts for known agents.');
    }
    const total = entries.reduce((sum, [, cents]) => sum + cents, 0);
    if (total > allocationCents) {
      throw new GuardError(`Agent shares add up to ${money(total)}, which is more than your ${money(allocationCents)} agent allocation.`);
    }
  }

  setMerchantAgents(merchantId, agentCompanyIds) {
    if (!Object.hasOwn(this.merchantAgents, merchantId)) throw new GuardError('Merchant not found.', 404);
    if (!Array.isArray(agentCompanyIds) || !agentCompanyIds.every((id) => AGENT_COMPANIES.some((company) => company.id === id))) {
      throw new GuardError('Agent companies must be known companies.');
    }
    this.merchantAgents[merchantId] = [...new Set(agentCompanyIds)];
    const names = AGENT_COMPANIES.filter((c) => this.merchantAgents[merchantId].includes(c.id)).map((c) => c.name).join(', ') || 'none';
    this.#record('merchant', `${merchantName(merchantId)} now accepts agents from: ${names}.`);
    this.#notify();
  }

  // Only this agent's token stops working and only its purchases in progress are canceled.
  revokeConnection(connectionId) {
    if (!this.connections.revoke(connectionId, this.#nowMs())) throw new GuardError('Connection not found.', 404);
    const name = this.connections.list(this.#nowMs()).find((c) => c.id === connectionId).shortName;
    this.#record('customer', `Revoked ${name}'s access. Its test token no longer works.`);
    this.#cancelHeld('Access was revoked before the charge.', connectionId);
    this.#notify();
  }

  resumeAgent() {
    if (!this.paused) return;
    this.paused = false;
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

  // First gate: decides whether the agent may proceed to checkout. No money moves here.
  // Keep this method synchronous: checking the limits and placing the hold must be one step,
  // so that simultaneous intents are handled one after another and each sees the last one's hold.
  attempt({ token, merchantId, item, amountCents, overreach = false }) {
    const auth = this.#authorize(token);
    const purchase = this.#open({ merchantId, item, amountCents, overreach }, auth.connection);
    this.#record('agent', `${purchase.agentName} tried to buy ${item} for ${money(amountCents)} at ${purchase.merchantName}.`, purchase);

    if (auth.problem) {
      this.#block(purchase, auth.problem.code, auth.problem.reason);
    } else {
      const { problem, needsApproval, reason } = this.#assess(purchase, amountCents, auth.limits);
      if (problem) {
        this.#block(purchase, problem.code, problem.reason);
      } else if (this.#isDuplicate(purchase)) {
        this.#block(purchase, 'duplicate', 'Duplicate of a recent purchase with the same merchant, item, and amount.');
      } else if (needsApproval) {
        purchase.reason = reason;
        this.#placeHold(purchase);
        this.#record('guard', `Held ${item} for your approval: ${reason}`, purchase);
      } else {
        purchase.cleared = true;
        purchase.status = 'authorized';
        purchase.reason = reason;
        this.#placeHold(purchase);
        this.#record('guard', `Cleared ${item}: ${reason}`, purchase);
      }
    }
    this.#notify();
    return { ...purchase };
  }

  // Final gate: the only way a cleared purchase becomes a charge.
  checkout({ token, purchaseId, merchantId, item, amountCents, overreach = false }) {
    const final = { merchantId, item, amountCents, overreach };
    const purchase = this.purchases.find((p) => p.id === purchaseId);
    const auth = this.#authorize(token);
    let result;

    if (purchase?.status === 'authorized') {
      this.#record('agent', `${purchase.agentName} submitted final checkout: ${item} for ${money(amountCents)} at ${merchantName(merchantId)}.`, purchase);
      let problem = auth.problem;
      if (!problem && auth.connection.id !== purchase.connectionId) {
        problem = { code: 'wrong_token', reason: 'This purchase was cleared for a different agent.' };
      }
      problem ??= this.#mismatchProblem(purchase, final) ?? this.#limitsProblem(purchase, amountCents, auth.limits);
      if (problem) {
        this.#block(purchase, problem.code, problem.reason);
      } else {
        let reason = purchase.customerApproved ? 'You approved this purchase.' : 'Within your rules.';
        if (amountCents < purchase.amountCents) {
          reason = `${reason} Final price was lower than the ${money(purchase.amountCents)} quoted.`;
          this.#applyLowerPrice(purchase, amountCents);
        }
        this.#charge(purchase, reason);
      }
      result = purchase;
    } else {
      // Nothing is cleared for this charge, so it is recorded separately and the original stays as it was.
      result = this.#open(final, auth.connection);
      this.#record('agent', `${result.agentName} tried to charge ${item} for ${money(amountCents)} at ${result.merchantName}.`, result);
      if (purchase?.status === 'completed') this.#block(result, 'duplicate', 'This purchase has already been charged.');
      else this.#block(result, 'not_cleared', 'This charge was not cleared by the guard.');
    }
    this.#notify();
    return { ...result };
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
      // The rules and consent may have changed while this purchase waited, so check them again.
      const limits = this.connections.limits(purchase.connectionId, this.#nowMs());
      const problem = limits
        ? this.#limitsProblem(purchase, purchase.amountCents, limits)
        : { code: 'no_access', reason: 'The agent does not have access.' };
      if (problem) {
        this.#block(purchase, problem.code, problem.reason);
      } else {
        purchase.cleared = true;
        purchase.expiresAt = new Date(this.#nowMs() + APPROVAL_DAYS * DAY_MS).toISOString();
        this.#settle(purchase, 'authorized', 'You approved this purchase.');
      }
    }
    this.#notify();
    return { ...purchase };
  }

  reportProblem(purchaseId, { reason, note = '' }) {
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
