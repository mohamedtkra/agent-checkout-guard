import { FEATURE_IDS, normalizeFeatures } from '../engine/guard.js';
import { AGENTS, SCENARIO_IDS, SCENARIOS } from './scenarios.js';

export const FEATURE_BLOCKS = [
  { id: 'stepUpConsent', label: 'Step-up verification and consent', hint: 'A second code and a consent screen before an agent connects.' },
  { id: 'approvals', label: 'Approval with 3-day expiry and reminders', hint: 'Larger purchases wait for the customer, then auto-deny on day 3.' },
  { id: 'creditHolds', label: 'Credit allocation and checkout holds', hint: 'Caps agent spending and places holds when purchases execute.' },
  { id: 'splitByAgent', label: 'Split by agent', hint: 'Gives each agent its own share of the allocation.', requires: 'creditHolds' },
  { id: 'refunds', label: 'Report and refund tracking', hint: 'Report a problem and follow a refund timeline.' },
  { id: 'overreach', label: 'Overreach detection and auto-pause', hint: 'Test out-of-bounds purchases and pause agents on a flagged charge.' },
  { id: 'agentVerification', label: 'Verified agent at checkout', hint: 'The merchant checks a signature from the agent before charging.' },
];

const MAX_DOLLARS = 1_000_000;
const AGENT_IDS = AGENTS.map((agent) => agent.id);

function amount(value, fallback, max = MAX_DOLLARS) {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0) return Math.min(fallback, max);
  return Math.min(Math.round(number * 100) / 100, max);
}

export function configForScenario(scenarioId, base = {}) {
  const scenario = SCENARIOS[scenarioId];
  return normalizeConfig({
    agents: AGENT_IDS,
    features: {},
    ...base,
    scenario: scenarioId,
    creditLimit: scenario.creditLimit,
    allocation: scenario.allocation,
    approval: scenario.approval,
    shares: {},
  });
}

// Everything from a share link passes through here, so a hand-edited link can't produce a bad config.
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const scenarioId = SCENARIO_IDS.includes(input.scenario) ? input.scenario : SCENARIO_IDS[0];
  const scenario = SCENARIOS[scenarioId];
  const agents = AGENT_IDS.filter((id) => Array.isArray(input.agents) ? input.agents.includes(id) : true);
  const creditLimit = amount(input.creditLimit, scenario.creditLimit);
  const allocation = amount(input.allocation, scenario.allocation, creditLimit);
  const approval = amount(input.approval, scenario.approval);
  const rawFeatures = input.features && typeof input.features === 'object' ? input.features : {};
  const features = normalizeFeatures(Object.fromEntries(FEATURE_IDS.map((id) => [id, rawFeatures[id] !== false])));
  const rawShares = input.shares && typeof input.shares === 'object' ? input.shares : {};
  const shares = {};
  for (const id of agents) {
    if (Object.hasOwn(rawShares, id) && typeof rawShares[id] === 'number') shares[id] = amount(rawShares[id], 0, allocation);
  }
  return { scenario: scenarioId, agents, creditLimit, allocation, approval, features, shares };
}

// Shares only apply when they are switched on and fit inside the allocation.
export function effectiveShares(config) {
  if (!config.features.splitByAgent) return {};
  const total = Object.values(config.shares).reduce((sum, value) => sum + value, 0);
  return total <= config.allocation ? config.shares : {};
}

export function configWarnings(config) {
  const warnings = [];
  if (config.agents.length === 0) warnings.push('Pick at least one agent to try the prototype.');
  const total = Object.values(config.shares).reduce((sum, value) => sum + value, 0);
  if (config.features.splitByAgent && total > config.allocation) {
    warnings.push('Agent shares add up to more than the allocation, so they are being ignored.');
  }
  return warnings;
}

export function encodeConfig(config) {
  return btoa(JSON.stringify(config)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeConfig(encoded) {
  try {
    return normalizeConfig(JSON.parse(atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))));
  } catch {
    return null;
  }
}
