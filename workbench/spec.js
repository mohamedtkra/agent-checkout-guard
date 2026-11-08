import { effectiveShares, FEATURE_BLOCKS } from './config.js';
import { AGENTS, SCENARIOS } from './scenarios.js';

const dollars = (value) => `$${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function buildSpec(config) {
  const scenario = SCENARIOS[config.scenario];
  const { features } = config;
  const agents = AGENTS.filter((agent) => config.agents.includes(agent.id));
  const shares = effectiveShares(config);
  const enabled = FEATURE_BLOCKS.filter((block) => features[block.id]);

  const rules = [
    `Agents: ${agents.map((agent) => agent.name).join(', ') || 'none selected'}.`,
    'At checkout, a higher price, a different merchant or item, or a duplicate purchase is blocked. A lower price is allowed and logged.',
  ];
  if (features.creditHolds) {
    rules.push(`Mock credit limit: ${dollars(config.creditLimit)}.`);
    rules.push(`Agent allocation: ${dollars(config.allocation)}. Charges, active holds, and the new purchase must fit within it at checkout.`);
    rules.push('Holds are placed only when a purchase executes. Intents reserve nothing.');
  }
  if (features.splitByAgent) {
    const split = agents.filter((agent) => Object.hasOwn(shares, agent.id)).map((agent) => `${agent.shortName} ${dollars(shares[agent.id])}`);
    rules.push(split.length ? `Split by agent: ${split.join(', ')}. An agent without a share can't spend.` : 'Split by agent is available, and no shares are set, so agents share the allocation.');
  }
  if (features.approvals) {
    rules.push(`Purchases above ${dollars(config.approval)} need the customer's approval. Requests send reminders on day 1 and day 2, and auto-deny on day 3.`);
  }
  if (features.stepUpConsent) rules.push('Connecting an agent needs a step-up code and an explicit consent screen, including a trust level that starts at "Ask me every time".');
  if (features.agentVerification) rules.push('The merchant verifies a signature from the agent before any charge. Unverified agents are refused.');
  if (features.overreach) rules.push('A charge outside the rules is flagged, all agents pause, and the customer is alerted.');

  const flow = [
    features.stepUpConsent ? 'The customer connects an agent, confirms a step-up code, and allows the consent screen.' : 'The customer connects an agent.',
    'The customer reviews the agent\'s plan, removes anything unwanted, and tells it to proceed.',
    `The agent shops at ${scenario.merchants.map(([, name]) => name).join(', ')}.`,
  ];
  if (features.approvals) flow.push('The customer approves or denies larger purchases on their phone.');
  flow.push(features.creditHolds ? 'At checkout, the guard checks the limits and places a hold, which becomes a charge when the purchase settles.' : 'At checkout, the guard re-checks the purchase and charges it.');
  flow.push('The customer follows everything in the activity log, sees why each purchase happened, and can stop all agents at any time.');
  if (features.refunds) flow.push('The customer reports a problem and tracks the refund through Submitted, Under review, Merchant contacted, and Refunded or Declined.');

  const metrics = ['False blocks: share of purchases within the rules that are wrongly stopped.'];
  if (features.creditHolds) {
    metrics.push('Limit breaches: charges past the allocation or available credit. Target: 0.');
    if (features.approvals) metrics.push('Approved purchases declined at checkout: approved purchases later declined because a limit was used up.');
  }
  if (features.approvals) metrics.push('Approval response time: time from request to the customer\'s decision.');
  if (features.overreach) metrics.push('Overreach attempts blocked: share of out-of-bounds attempts stopped before any charge.');
  if (features.refunds) {
    metrics.push('Time to refund: time from a request being submitted to Refunded.');
    metrics.push('Refund rate: share of charged purchases that end in a refund.');
  }
  if (features.agentVerification) metrics.push('Unverified agents refused: checkouts stopped because the merchant could not verify the agent.');
  if (features.stepUpConsent) metrics.push('Connection completion: share of started connections that reach Allow.');

  return {
    title: `Agent Checkout Guard: ${scenario.name}`,
    sections: [
      { heading: 'Problem', paragraph: scenario.problem },
      { heading: 'Enabled features', items: enabled.map((block) => block.label) },
      { heading: 'Rules', items: rules },
      { heading: 'User flow', items: flow, ordered: true },
      { heading: 'Key metrics', items: metrics },
    ],
  };
}

export function specToMarkdown(spec, shareLink) {
  const lines = [`# ${spec.title}`, '', '> Demo - no real accounts or payments', ''];
  for (const { heading, paragraph, items, ordered } of spec.sections) {
    lines.push(`## ${heading}`, '');
    if (paragraph) lines.push(paragraph);
    if (items) items.forEach((item, index) => lines.push(`${ordered ? `${index + 1}.` : '-'} ${item}`));
    lines.push('');
  }
  if (shareLink) lines.push('## Prototype', '', `[Open this setup in the Prototype Workbench](${shareLink})`, '');
  return lines.join('\n');
}
