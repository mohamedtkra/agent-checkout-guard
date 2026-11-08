import { checkoutPayload } from './agent-directory.js';

export const SHOPPING_LIST = [
  { merchantId: 'grocer', item: 'Weekly groceries', why: 'It is your usual weekly order.', amountCents: 4250 },
  { merchantId: 'pharmacy', item: 'Allergy medicine', why: 'You are nearly out, based on your last order.', amountCents: 1825 },
  { merchantId: 'electronics', item: 'USB charger', why: 'Your saved list had a replacement charger.', amountCents: 2499 },
  { merchantId: 'grocer', item: 'Bulk pantry restock', why: 'Pantry staples are running low.', amountCents: 7800 },
  { merchantId: 'wellness', item: 'Blood pressure monitor', why: 'It matches the model you saved.', amountCents: 4500, final: { amountCents: 4200 } },
  { merchantId: 'market', item: 'Holiday food hamper', why: 'You asked for a gift for the holidays.', amountCents: 45000 },
];

export const SHOPPING_ASK = 'Keep the household stocked and pick up what is on my list.';

export const UNCLEARED_CHARGE = { merchantId: 'unlisted-store', item: 'Unrecognized charge', amountCents: 14999 };

const SETTLE_STEPS = 4;
const STOP_CODES = new Set(['no_access', 'paused']);
const OVERREACH_SCENARIOS = [
  { id: 'skip_clearance', label: 'charge without being cleared' },
  { id: 'price_raised', label: 'raise the price at checkout' },
  { id: 'wrong_item', label: 'swap the item at checkout' },
  { id: 'wrong_merchant', label: 'switch merchants at checkout' },
  { id: 'forged_signature', label: 'check out with a forged signature' },
  { id: 'duplicate', label: 'charge a finished purchase again' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockAgent {
  #runId = 0;
  #running = false;
  #overreachIndex = 0;

  constructor(guard, { stepMs = 1800, list = SHOPPING_LIST, ask = SHOPPING_ASK } = {}) {
    this.guard = guard;
    this.ask = ask;
    this.stepMs = stepMs;
    this.settleMs = stepMs * SETTLE_STEPS;
    this.list = list;
  }

  // What the agent intends to buy, for the customer to review before it starts.
  plan() {
    const { catalog } = this.guard;
    const items = this.list.map((step, index) => {
      const merchant = catalog.merchantFor(step.merchantId);
      return {
        index,
        item: step.item,
        why: step.why ?? null,
        amountCents: step.amountCents,
        merchantName: merchant.name,
        merchantLogo: merchant.logo,
        image: catalog.productFor(step.item).image,
      };
    });
    return { ask: this.ask, items, totalCents: items.reduce((sum, item) => sum + item.amountCents, 0) };
  }

  run(token, { items } = {}) {
    if (this.#running) return null;
    this.#running = true;
    const list = items ? this.list.filter((_, index) => items.includes(index)) : this.list;
    return this.#shop(++this.#runId, token, list);
  }

  simulateOverreach(token) {
    if (this.#running) return null;
    this.#running = true;
    return this.#overreach(++this.#runId, token);
  }

  stop() {
    this.#runId += 1;
    this.#running = false;
    this.#overreachIndex = 0;
  }

  #finish(message, logMessage) {
    this.#running = false;
    this.guard.setAgentStatus(false, message, logMessage);
  }

  // The merchant settles an executed purchase a little later, so its hold is visible until then.
  #settleLater(purchase) {
    if (purchase.status !== 'held') return;
    if (this.settleMs === 0) this.guard.settleCharge(purchase.id);
    else setTimeout(() => this.guard.settleCharge(purchase.id), this.settleMs).unref?.();
  }

  // Returns the purchase in its final state, or null if this run was stopped while waiting.
  async #buy(runId, token, { final, forge, ...quote }) {
    const { guard } = this;
    const purchase = guard.attempt({ token, ask: quote.overreach ? null : this.ask, ...quote });
    if (purchase.status === 'pending') {
      guard.setAgentStatus(true, `Waiting for your decision on ${quote.item}.`);
      await guard.waitForDecision(purchase.id);
      if (runId !== this.#runId) return null;
    }
    const current = guard.getPurchase(purchase.id);
    if (current.status !== 'authorized') return current;
    const details = { purchaseId: purchase.id, merchantId: quote.merchantId, item: quote.item, amountCents: quote.amountCents, ...final };
    const signature = forge ? 'forged-signature' : guard.agentDirectory.sign(current.agentId, checkoutPayload(details));
    const executed = guard.checkout({ token, overreach: Boolean(quote.overreach), signature, ...details });
    this.#settleLater(executed);
    return executed;
  }

  // The agent keeps its token for the whole run, as an agent holding a card would.
  async #shop(runId, token, list) {
    const { guard } = this;
    guard.setAgentStatus(true, 'Starting the shopping list.', 'Started the shopping list.');

    for (const step of list) {
      guard.setAgentStatus(true, `Shopping for ${step.item}.`);
      await sleep(this.stepMs);
      if (runId !== this.#runId) return;

      const result = await this.#buy(runId, token, step);
      if (!result) return;
      if (STOP_CODES.has(result.code)) {
        this.#finish(`Stopped. ${result.reason}`, `Stopped shopping: ${result.reason}`);
        return;
      }
    }
    this.#finish('Finished the shopping list.', 'Finished the shopping list.');
  }

  #overreachStep(id) {
    const merchantId = this.list[0].merchantId;
    const quote = { merchantId, item: 'Phone case', amountCents: 100, overreach: true };
    switch (id) {
      case 'skip_clearance':
        return { id: 'not-a-cleared-purchase', merchantId, item: 'Gift cards', amountCents: 999 };
      case 'price_raised':
        return { ...quote, final: { amountCents: 9900 } };
      case 'wrong_item':
        return { ...quote, final: { item: 'Gift cards' } };
      case 'forged_signature':
        return { ...quote, forge: true };
      case 'wrong_merchant':
        return { ...quote, final: { merchantId: this.guard.catalog.merchants.find((m) => m.id !== merchantId).id } };
      default:
        return this.guard.purchases.findLast((p) => ['completed', 'held'].includes(p.status) && p.cleared) ?? null;
    }
  }

  async #overreach(runId, token) {
    const { guard } = this;
    let scenario = OVERREACH_SCENARIOS[this.#overreachIndex];
    this.#overreachIndex = (this.#overreachIndex + 1) % OVERREACH_SCENARIOS.length;
    let step = this.#overreachStep(scenario.id);
    if (!step) {
      // There is nothing to charge twice yet, so use the first scenario instead.
      [scenario] = OVERREACH_SCENARIOS;
      step = this.#overreachStep(scenario.id);
    }

    guard.setAgentStatus(true, `Overreach test: trying to ${scenario.label}.`, `Overreach test: tried to ${scenario.label}.`);
    await sleep(this.stepMs);
    if (runId !== this.#runId) return;

    const result = ['duplicate', 'skip_clearance'].includes(scenario.id)
      ? guard.checkout({ token, purchaseId: step.id, merchantId: step.merchantId, item: step.item, amountCents: step.amountCents, overreach: true })
      : await this.#buy(runId, token, step);
    if (!result) return;
    this.#finish(`Overreach test finished. ${result.reason}`);
  }
}
