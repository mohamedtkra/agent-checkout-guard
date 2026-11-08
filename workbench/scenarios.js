import { createCatalog } from '../engine/catalog.js';

const svg = (body) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
const emojiTile = (emoji, color) => svg(`<rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="44" font-size="32" text-anchor="middle">${emoji}</text>`);
const letterTile = (letter, color) => svg(`<rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="44" font-family="Arial, sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text>`);
const letterBadge = (letter, color) => svg(`<circle cx="32" cy="32" r="32" fill="${color}"/><text x="32" y="44" font-family="Arial, sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text>`);

// Simulated agents, shown with a letter badge. Not connected to or affiliated with these companies.
export const AGENTS = [
  { id: 'agent-a', name: 'ChatGPT (OpenAI)', shortName: 'ChatGPT', icon: letterBadge('C', '#6b3fa0'), company: 'OpenAI' },
  { id: 'agent-b', name: 'Gemini (Google)', shortName: 'Gemini', icon: letterBadge('G', '#c2541b'), company: 'Google' },
];

// Every merchant is an invented "Sample" business. Each list ends with a purchase that goes past
// the default allocation, so a run shows approvals, a lower final price, and a checkout decline.
export const SCENARIOS = {
  travel: {
    name: 'Travel',
    ask: 'Book my trip and keep it within my limits.',
    problem: 'Frequent travelers want an agent to book routine trips without overspending or booking the wrong thing.',
    creditLimit: 8000,
    allocation: 2000,
    approval: 300,
    categories: { Flights: '✈️', Hotels: '🏨', Transport: '🚕' },
    merchants: [
      ['air', 'Sample Air', 'Flights', '#2f6f9f'],
      ['stay', 'Sample Stays', 'Hotels', '#8a5a2b'],
      ['ride', 'Sample Rides', 'Transport', '#4b6b3a'],
    ],
    purchases: [
      { merchantId: 'ride', item: 'Airport transfer', why: 'You land early and asked for a ride.', amount: 45, description: 'Shared ride to the terminal.', emoji: '🚕' },
      { merchantId: 'stay', item: 'Two-night hotel', why: 'Closest to your meeting, within budget.', amount: 280, final: 260, description: 'City center room, breakfast included.', size: 'Queen room', emoji: '🏨' },
      { merchantId: 'air', item: 'Round-trip flight', why: 'Cheapest direct option on your dates.', amount: 640, description: 'Economy fare with one checked bag.', size: 'Economy', emoji: '✈️' },
      { merchantId: 'stay', item: 'Extra night', why: 'Your return moved a day later.', amount: 150, description: 'Late checkout and one more night.', size: 'Queen room', emoji: '🛏️' },
      { merchantId: 'air', item: 'Business class upgrade', why: 'An upgrade offer came up on your flight.', amount: 1200, description: 'Upgrade on the outbound flight.', size: 'Business', emoji: '💺' },
    ],
  },
  restaurants: {
    name: 'Restaurants',
    ask: 'Sort out my food and reservations this week.',
    problem: 'Busy diners want an agent to order and reserve food without surprise bills.',
    creditLimit: 3000,
    allocation: 400,
    approval: 80,
    categories: { Dining: '🍽️', Delivery: '🛵', Coffee: '☕' },
    merchants: [
      ['bistro', 'Sample Bistro', 'Dining', '#8c3b3b'],
      ['delivery', 'Sample Delivery', 'Delivery', '#2f6b5a'],
      ['cafe', 'Sample Cafe', 'Coffee', '#6b4a2b'],
    ],
    purchases: [
      { merchantId: 'cafe', item: 'Morning coffee', why: 'Your usual weekday order.', amount: 12, description: 'Two lattes for pickup.', size: 'Large', emoji: '☕' },
      { merchantId: 'delivery', item: 'Lunch delivery', why: 'You have back-to-back meetings.', amount: 28, description: 'Grain bowl and a drink.', emoji: '🥗' },
      { merchantId: 'bistro', item: 'Dinner for two', why: 'You asked for a table on Friday.', amount: 95, final: 90, description: 'Set menu with a reservation at 7 pm.', size: 'Table for 2', emoji: '🍽️' },
      { merchantId: 'bistro', item: 'Team dinner', why: 'It is on your calendar this week.', amount: 180, description: 'Shared plates for a small team.', size: 'Table for 6', emoji: '🍝' },
      { merchantId: 'delivery', item: 'Catering deposit', why: 'The office lunch needs a deposit.', amount: 150, description: 'Deposit for an office lunch.', size: '20 people', emoji: '🥪' },
    ],
  },
  subscriptions: {
    name: 'Subscriptions',
    ask: 'Keep my subscriptions running.',
    problem: 'People lose track of renewals and want an agent to manage them without new charges creeping in.',
    creditLimit: 2500,
    allocation: 150,
    approval: 40,
    categories: { Streaming: '📺', Software: '💻', News: '📰' },
    merchants: [
      ['stream', 'Sample Stream', 'Streaming', '#5a3f8c'],
      ['apps', 'Sample Apps', 'Software', '#2f6f9f'],
      ['news', 'Sample News', 'News', '#55606a'],
    ],
    purchases: [
      { merchantId: 'stream', item: 'Music plan', why: 'Renews this week.', amount: 11, description: 'Monthly renewal.', size: 'Individual', emoji: '🎵' },
      { merchantId: 'stream', item: 'Video plan', why: 'Renews this week.', amount: 18, description: 'Monthly renewal.', size: 'Standard', emoji: '📺' },
      { merchantId: 'apps', item: 'Cloud storage', why: 'You are near your storage limit.', amount: 10, description: 'Monthly renewal.', size: '200 GB', emoji: '☁️' },
      { merchantId: 'apps', item: 'Design app', why: 'You asked for a design tool.', amount: 55, final: 49, description: 'New annual plan, with an offer at checkout.', size: 'Annual', emoji: '🎨' },
      { merchantId: 'news', item: 'Annual news bundle', why: 'Your monthly plan is ending.', amount: 120, description: 'A full year of digital access.', size: 'Annual', emoji: '📰' },
    ],
  },
  business: {
    name: 'Small business',
    ask: 'Reorder what the business needs this month.',
    problem: 'Small business owners want an agent to reorder supplies without blowing the monthly spend.',
    creditLimit: 20000,
    allocation: 3000,
    approval: 500,
    categories: { Office: '📎', Software: '💻', Shipping: '📦' },
    merchants: [
      ['office', 'Sample Office', 'Office', '#4b6b3a'],
      ['saas', 'Sample Software', 'Software', '#2f6f9f'],
      ['ship', 'Sample Shipping', 'Shipping', '#8a5a2b'],
    ],
    purchases: [
      { merchantId: 'office', item: 'Printer paper', why: 'Stock is low.', amount: 85, description: 'Case of letter paper.', size: '10 reams', emoji: '📄' },
      { merchantId: 'office', item: 'Ink cartridges', why: 'The printer reports low ink.', amount: 140, description: 'Replacement set.', color: 'Black and color', emoji: '🖨️' },
      { merchantId: 'ship', item: 'Weekly shipping', why: 'Orders are ready to go out.', amount: 220, final: 198, description: 'Outbound parcels for the week.', size: '12 parcels', emoji: '📦' },
      { merchantId: 'saas', item: 'Accounting software', why: 'Your plan renews this month.', amount: 900, description: 'Annual plan.', size: '5 seats', emoji: '💻' },
      { merchantId: 'office', item: 'New laptop', why: 'A new hire starts soon.', amount: 1900, description: 'Laptop for a new hire.', color: 'Silver', size: '14 in', emoji: '💼' },
    ],
  },
  family: {
    name: 'Family card',
    ask: 'Handle the household and school costs.',
    problem: 'Parents want an agent to handle household spending while staying in control of larger purchases.',
    creditLimit: 6000,
    allocation: 600,
    approval: 100,
    categories: { Groceries: '🛒', School: '🎒', Activities: '⚽' },
    merchants: [
      ['grocer', 'Sample Grocer', 'Groceries', '#2f6b3f'],
      ['school', 'Sample School Store', 'School', '#2f6f9f'],
      ['sports', 'Sample Sports', 'Activities', '#a2507a'],
    ],
    purchases: [
      { merchantId: 'grocer', item: 'Weekly groceries', why: 'Your usual weekly order.', amount: 95, description: 'Produce, dairy, and staples.', emoji: '🛒' },
      { merchantId: 'school', item: 'School lunch top-up', why: 'The lunch balance is low.', amount: 40, description: 'Lunch account for the month.', emoji: '🍎' },
      { merchantId: 'sports', item: 'Soccer shoes', why: 'The season starts soon.', amount: 65, final: 59, description: 'Youth cleats.', color: 'Blue', size: 'Youth 4', emoji: '👟' },
      { merchantId: 'school', item: 'Summer camp deposit', why: 'The deadline is this week.', amount: 180, description: 'Deposit for a one-week camp.', size: '1 week', emoji: '🏕️' },
      { merchantId: 'sports', item: 'New bike', why: 'A birthday is coming up.', amount: 320, description: 'Mountain bike for a birthday.', color: 'Red', size: '24 in', emoji: '🚲' },
    ],
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);

export function buildCatalog(scenario, agentIds) {
  const products = Object.fromEntries(scenario.purchases.map(({ item, description, color, size, emoji }) => [
    item,
    { description, color, size, image: emojiTile(emoji, '#efe9dc') },
  ]));
  return createCatalog({
    agents: AGENTS.filter((agent) => agentIds.includes(agent.id)),
    merchants: scenario.merchants.map(([id, name, category, color]) => ({ id, name, category, logo: letterTile(name.replace('Sample ', '')[0], color) })),
    categoryIcons: {
      ...Object.fromEntries(Object.entries(scenario.categories).map(([category, emoji]) => [category, emojiTile(emoji, '#e6e3da')])),
      Other: emojiTile('•', '#e6e3da'),
    },
    products,
    unknownMerchant: { name: 'Unknown merchant', category: 'Other', logo: letterTile('?', '#6b6f6c') },
    placeholderProduct: { description: 'No product details were provided.', image: emojiTile('📦', '#e6e3da') },
  });
}

export function shoppingList(scenario) {
  return scenario.purchases.map(({ merchantId, item, why, amount, final }) => ({
    merchantId,
    item,
    why,
    amountCents: Math.round(amount * 100),
    ...(final === undefined ? {} : { final: { amountCents: Math.round(final * 100) } }),
  }));
}
