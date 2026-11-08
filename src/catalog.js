export const AGENT_COMPANIES = [
  { id: 'quillhop', name: 'Quillhop Agents' },
  { id: 'pennowl', name: 'Pennowl Agents' },
  { id: 'zephwick', name: 'Zephwick Agents' },
];

// Demo agents only. The "-style" labels describe the kind of assistant being imitated.
export const DEMO_AGENTS = [
  { id: 'agent-a', name: 'Demo Agent A (ChatGPT-style assistant)', shortName: 'Demo Agent A', icon: '/agents/agent-a.svg', companyId: 'quillhop' },
  { id: 'agent-b', name: 'Demo Agent B (Gemini-style assistant)', shortName: 'Demo Agent B', icon: '/agents/agent-b.svg', companyId: 'pennowl' },
  { id: 'agent-c', name: 'Demo Agent C (shopping app)', shortName: 'Demo Agent C', icon: '/agents/agent-c.svg', companyId: 'zephwick' },
];

// All merchant details are invented for the prototype.
export const MERCHANTS = [
  {
    id: 'grocer',
    name: 'Thistlewick Pantry',
    category: 'Groceries',
    logo: '/merchants/grocer.svg',
    about: 'Everyday groceries and pantry staples.',
    location: '14 Fennel Row, Sampleville',
    support: 'help@thistlewick.example',
    returns: 'Refunds on damaged items within 7 days.',
    acceptedAgents: ['quillhop', 'pennowl', 'zephwick'],
  },
  {
    id: 'market',
    name: 'Hollowfern Market',
    category: 'Groceries',
    logo: '/merchants/market.svg',
    about: 'Seasonal food hampers and specialty goods.',
    location: '3 Orchard Steps, Sampleville',
    support: 'care@hollowfern.example',
    returns: 'Refunds on unopened items within 14 days.',
    acceptedAgents: ['quillhop', 'pennowl'],
  },
  {
    id: 'pharmacy',
    name: 'Mossbell Apothecary',
    category: 'Health',
    logo: '/merchants/pharmacy.svg',
    about: 'Everyday medicines and health supplies.',
    location: '27 Bellflower Lane, Sampleville',
    support: 'help@mossbell.example',
    returns: 'Unopened items only, within 30 days.',
    acceptedAgents: ['quillhop', 'pennowl'],
  },
  {
    id: 'wellness',
    name: 'Larkmoss Wellness',
    category: 'Health',
    logo: '/merchants/wellness.svg',
    about: 'Home health devices and wellness products.',
    location: '8 Skylark Court, Sampleville',
    support: 'support@larkmoss.example',
    returns: 'Returns within 30 days with receipt.',
    acceptedAgents: ['quillhop'],
  },
  {
    id: 'electronics',
    name: 'Voltwren Gadgets',
    category: 'Gadgets',
    logo: '/merchants/electronics.svg',
    about: 'Chargers, cables, and small electronics.',
    location: '51 Circuit Yard, Sampleville',
    support: 'help@voltwren.example',
    returns: 'Returns within 30 days in original packaging.',
    acceptedAgents: ['quillhop', 'zephwick'],
  },
  {
    id: 'audio',
    name: 'Tinkerquay Audio',
    category: 'Gadgets',
    logo: '/merchants/audio.svg',
    about: 'Headphones, speakers, and audio gear.',
    location: '6 Quayside Works, Sampleville',
    support: 'hello@tinkerquay.example',
    returns: 'Returns within 21 days in original packaging.',
    acceptedAgents: ['quillhop', 'zephwick'],
  },
];

export const DEFAULT_MERCHANT_AGENTS = Object.fromEntries(MERCHANTS.map((m) => [m.id, m.acceptedAgents]));

const UNKNOWN_MERCHANT = { name: 'Unknown merchant', logo: '/merchants/unknown.svg' };

const PLACEHOLDER_PRODUCT = {
  description: 'No product details were provided.',
  image: '/products/placeholder.svg',
};

export const PRODUCTS = {
  'Weekly groceries': { description: 'A week of fresh produce, dairy, and staples.', image: '/products/groceries.svg' },
  'Allergy medicine': { description: 'Non-drowsy daily allergy tablets.', size: '30 tablets', image: '/products/allergy-medicine.svg' },
  'USB charger': { description: 'Compact two-port wall charger.', color: 'White', size: '30 W', image: '/products/usb-charger.svg' },
  'Bulk pantry restock': { description: 'Rice, pasta, beans, and canned goods.', size: 'Large box', image: '/products/pantry-box.svg' },
  'Blood pressure monitor': { description: 'Automatic upper-arm monitor with memory.', color: 'Gray', size: 'Standard cuff', image: '/products/blood-pressure-monitor.svg' },
  'Holiday food hamper': { description: 'A festive basket of sweet and savory treats.', size: 'Large', image: '/products/food-hamper.svg' },
  'Phone case': { description: 'Slim shock-absorbing phone case.', color: 'Teal', size: '6.1 in', image: '/products/phone-case.svg' },
  'Gift cards': { description: 'Prepaid store gift cards.', image: '/products/gift-cards.svg' },
  'Designer watch': { description: 'Stainless steel analog wristwatch.', color: 'Silver', size: '40 mm', image: '/products/watch.svg' },
};

export const merchantFor = (id) => MERCHANTS.find((m) => m.id === id) ?? UNKNOWN_MERCHANT;
export const productFor = (item) => (Object.hasOwn(PRODUCTS, item) ? PRODUCTS[item] : PLACEHOLDER_PRODUCT);

export const ASSET_PATHS = [
  ...DEMO_AGENTS.map((a) => a.icon),
  ...MERCHANTS.map((m) => m.logo),
  UNKNOWN_MERCHANT.logo,
  ...Object.values(PRODUCTS).map((p) => p.image),
  PLACEHOLDER_PRODUCT.image,
];
