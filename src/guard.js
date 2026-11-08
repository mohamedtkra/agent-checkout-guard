import { randomBytes, randomUUID } from 'node:crypto';
import { AGENT_COMPANIES, DEFAULT_MERCHANT_AGENTS, MERCHANTS, merchantFor, productFor } from './catalog.js';

export const DEFAULT_RULES = {
  budgetCents: 20000,
  allowedMerchantIds: ['grocer', 'market', 'pharmacy', 'wellness'],
  approvalCents: 5000,
};

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
const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_STATUSES = ['pending', 'authorized'];
const COMMITTED_STATUSES = ['completed', ...HOLD_STATUSES];

export class GuardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isCents = (value) => Number.isSafeInteger(value) && value >= 0;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
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
export function evaluate(rules, committedCents, merchantId, amountCents) {
  if (rulesError(rules)) return { outcome: 'block', reason: 'Rules could not be checked.' };
  if (!isCents(committedCents) || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { outcome: 'block', reason: 'Purchase amount could not be checked.' };
  }
  if (!rules.allowedMerchantIds.includes(merchantId)) {
    return { outcome: 'block', reason: 'Merchant is not on your allowed list.' };
  }
  if (committedCents + amountCents > rules.budgetCents) {
    return { outcome: 'block', reason: 'Purchase would go over your budget.' };
  }
  if (amountCents > rules.approvalCents) {
    return { outcome: 'approval', reason: `Over your ${money(rules.approvalCents)} approval amount.` };
  }
  return { outcome: 'allow', reason: 'Within your rules.' };
}

export class Guard {
  #token = null;
  #waiters = new Map();
  #listeners = new Set();
  #clockOffsetMs = 0;

  constructor() {
    this.#clear();
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
    this.agentCompanyId = AGENT_COMPANIES[0].id;
    this.merchantAgents = structuredClone(DEFAULT_MERCHANT_AGENTS);
    this.purchases = [];
    this.log = [];
    this.refunds = [];
    this.alerts = [];
    this.paused = false;
    this.agentStatus = { running: false, message: 'Ready to shop.' };
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #notify() {
    const state = this.snapshot();
    for (const listener of this.#listeners) listener(state);
  }

  #record(actor, message, purchase = null, flagged = false) {
    this.log.push({
      id: randomUUID(),
      at: this.#nowIso(),
      actor,
      message,
      purchaseId: purchase?.id ?? null,
      flagged,
    });
  }

  #maskedToken() {
    return this.#token ? `tok_test_••••${this.#token.slice(-4)}` : null;
  }

  #sumCents(statuses, excludeId) {
    return this.purchases
      .filter((p) => statuses.includes(p.status) && p.id !== excludeId)
      .reduce((total, p) => total + p.amountCents, 0);
  }

  #open({ merchantId, item, amountCents, overreach = false }) {
    const merchant = merchantFor(merchantId);
    const product = productFor(item);
    const purchase = {
      id: randomUUID(),
      at: this.#nowIso(),
      merchantId,
      merchantName: merchant.name,
      merchantLogo: merchant.logo,
      agentCompanyName: this.#agentCompany().name,
      item,
      description: product.description,
      color: product.color ?? null,
      size: product.size ?? null,
      image: product.image,
      amountCents,
      originalCents: null,
      expiresAt: null,
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
    this.#waiters.get(purchase.id)?.();
    this.#waiters.delete(purchase.id);
  }

  #block(purchase, code, reason) {
    purchase.code = code;
    this.#settle(purchase, 'blocked', reason);
    this.#record('guard', `Blocked ${purchase.item}: ${reason}`, purchase);
  }

  #accessProblem(token) {
    if (!token || token !== this.#token) return { code: 'no_access', reason: 'The agent does not have access.' };
    if (this.paused) return { code: 'paused', reason: 'The agent is paused after a flagged charge.' };
    return null;
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

  #agentCompany() {
    return AGENT_COMPANIES.find((company) => company.id === this.agentCompanyId);
  }

  #merchantRefusesAgent(merchantId) {
    return Object.hasOwn(this.merchantAgents, merchantId)
      && !this.merchantAgents[merchantId].includes(this.agentCompanyId);
  }

  #partnerProblem(merchantId) {
    if (!this.#merchantRefusesAgent(merchantId)) return null;
    return { code: 'merchant_agent', reason: `${merchantName(merchantId)} does not accept agents from ${this.#agentCompany().name}.` };
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

  #rulesProblem(purchase, amountCents = purchase.amountCents) {
    const committed = this.#sumCents(COMMITTED_STATUSES, purchase.id);
    const { outcome, reason } = evaluate(this.rules, committed, purchase.merchantId, amountCents);
    if (outcome === 'block') return { code: 'rules', reason };
    const partner = this.#partnerProblem(purchase.merchantId);
    if (partner) return partner;
    if (outcome === 'approval' && !purchase.customerApproved) {
      return { code: 'approval_required', reason: `${reason} Your approval is required.` };
    }
    return null;
  }

  #charge(purchase, reason) {
    this.#settle(purchase, 'completed', reason);
    this.#record('payment', `Charged ${money(purchase.amountCents)} to test token ${this.#maskedToken()} at ${purchase.merchantName}. No real money moved.`, purchase);
    this.#auditCharge(purchase);
  }

  // Runs after money moves and shares no decision with the pre-charge checks.
  #auditCharge(purchase) {
    const problems = [];
    const committed = this.#sumCents(COMMITTED_STATUSES, purchase.id);
    if (!purchase.cleared) problems.push('the guard never cleared it');
    if (!this.rules.allowedMerchantIds.includes(purchase.merchantId)) problems.push('the merchant is not on your allowed list');
    if (this.#merchantRefusesAgent(purchase.merchantId)) problems.push('the merchant does not accept this agent company');
    if (committed + purchase.amountCents > this.rules.budgetCents) problems.push('it goes over your budget');
    if (purchase.amountCents > this.rules.approvalCents && !purchase.customerApproved) problems.push('it needed your approval');
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
    this.#record('guard', 'Paused the agent automatically after a flagged charge.', null, true);
    this.#cancelHeld('The agent was paused after a flagged charge.');
  }

  #applyLowerPrice(purchase, amountCents) {
    purchase.originalCents = purchase.amountCents;
    purchase.amountCents = amountCents;
    this.#record('guard', `Allowed lower final price for ${purchase.item}: ${money(amountCents)} instead of the ${money(purchase.originalCents)} ${this.#agreedBy(purchase)}.`, purchase);
  }

  // Sends any reminders that are due and auto-denies approvals that have run out of time.
  #sweepApprovals() {
    let changed = false;
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

  #cancelHeld(reason) {
    for (const purchase of this.purchases.filter((p) => HOLD_STATUSES.includes(p.status))) {
      this.#settle(purchase, 'canceled', reason);
      this.#record('guard', `Canceled ${purchase.item} at ${purchase.merchantName}: ${reason}`, purchase);
    }
  }

  snapshot() {
    const spentCents = this.#sumCents(['completed']);
    const heldCents = this.#sumCents(HOLD_STATUSES);
    return {
      rules: this.rules,
      merchants: MERCHANTS,
      agentCompanies: AGENT_COMPANIES,
      agentCompanyId: this.agentCompanyId,
      merchantAgents: this.merchantAgents,
      refundReasons: REFUND_REASONS,
      now: this.#nowIso(),
      simulatedDays: this.#clockOffsetMs / DAY_MS,
      access: { active: this.#token !== null, token: this.#maskedToken() },
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

  agentToken() {
    return this.#token;
  }

  getPurchase(id) {
    const purchase = this.purchases.find((p) => p.id === id);
    return purchase && { ...purchase };
  }

  setRules(rules) {
    const error = rulesError(rules);
    if (error) throw new GuardError(error);
    this.rules = {
      budgetCents: rules.budgetCents,
      allowedMerchantIds: [...new Set(rules.allowedMerchantIds)],
      approvalCents: rules.approvalCents,
    };
    const names = this.rules.allowedMerchantIds.map(merchantName).join(', ') || 'none';
    this.#record('customer', `Set rules: ${money(this.rules.budgetCents)} budget, approval above ${money(this.rules.approvalCents)}, allowed merchants: ${names}.`);
    this.#notify();
  }

  setAgentCompany(id) {
    if (!AGENT_COMPANIES.some((company) => company.id === id)) throw new GuardError('Agent company not found.', 404);
    if (this.agentStatus.running) throw new GuardError('Wait for the agent to finish before changing its company.', 409);
    if (id === this.agentCompanyId) return;
    this.agentCompanyId = id;
    this.#record('customer', `Chose ${this.#agentCompany().name} as the agent company.`);
    this.#notify();
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

  grantAccess() {
    if (this.#token) return;
    this.#token = `tok_test_${randomBytes(8).toString('hex')}`;
    this.#record('customer', `Gave the agent access with test token ${this.#maskedToken()}.`);
    this.#notify();
  }

  revokeAccess() {
    if (!this.#token) return;
    this.#token = null;
    this.#record('customer', 'Revoked the agent\'s access. The test token no longer works.');
    this.#cancelHeld('Access was revoked before the charge.');
    this.#notify();
  }

  resumeAgent() {
    if (!this.paused) return;
    this.paused = false;
    this.alerts = [];
    this.agentStatus = { running: this.agentStatus.running, message: 'Resumed. Ready to shop.' };
    this.#record('customer', 'Reviewed the flagged charge and resumed the agent.');
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
  attempt({ token, merchantId, item, amountCents, overreach = false }) {
    const purchase = this.#open({ merchantId, item, amountCents, overreach });
    this.#record('agent', `Tried to buy ${item} for ${money(amountCents)} at ${purchase.merchantName}.`, purchase);

    const problem = this.#accessProblem(token);
    if (problem) {
      this.#block(purchase, problem.code, problem.reason);
    } else {
      const committed = this.#sumCents(COMMITTED_STATUSES, purchase.id);
      const { outcome, reason } = evaluate(this.rules, committed, merchantId, amountCents);
      const partner = this.#partnerProblem(merchantId);
      if (outcome === 'block') {
        this.#block(purchase, 'rules', reason);
      } else if (partner) {
        this.#block(purchase, partner.code, partner.reason);
      } else if (this.#isDuplicate(purchase)) {
        this.#block(purchase, 'duplicate', 'Duplicate of a recent purchase with the same merchant, item, and amount.');
      } else if (outcome === 'approval') {
        purchase.reason = reason;
        purchase.expiresAt = new Date(Date.parse(purchase.at) + APPROVAL_DAYS * DAY_MS).toISOString();
        this.#record('guard', `Held ${item} for your approval: ${reason}`, purchase);
      } else {
        purchase.cleared = true;
        purchase.status = 'authorized';
        purchase.reason = reason;
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
    let result;

    if (purchase?.status === 'authorized') {
      this.#record('agent', `Submitted final checkout: ${item} for ${money(amountCents)} at ${merchantName(merchantId)}.`, purchase);
      const problem = this.#accessProblem(token)
        ?? this.#mismatchProblem(purchase, final)
        ?? this.#rulesProblem(purchase, amountCents);
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
      result = this.#open(final);
      this.#record('agent', `Tried to charge ${item} for ${money(amountCents)} at ${result.merchantName}.`, result);
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
      // The rules may have changed while this purchase waited, so check them again.
      const problem = this.#rulesProblem(purchase);
      if (problem) {
        this.#block(purchase, problem.code, problem.reason);
      } else {
        purchase.cleared = true;
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

  reset() {
    this.#token = null;
    for (const resolve of this.#waiters.values()) resolve();
    this.#waiters.clear();
    this.#clear();
    this.#notify();
  }
}
