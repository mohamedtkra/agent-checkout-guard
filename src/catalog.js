export const MERCHANTS = [
  { id: 'grocer', name: 'Thistlewick Pantry', category: 'Groceries', logo: '/merchants/grocer.svg' },
  { id: 'pharmacy', name: 'Mossbell Apothecary', category: 'Health', logo: '/merchants/pharmacy.svg' },
  { id: 'electronics', name: 'Voltwren Gadgets', category: 'Gadgets', logo: '/merchants/electronics.svg' },
];

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
  ...MERCHANTS.map((m) => m.logo),
  UNKNOWN_MERCHANT.logo,
  ...Object.values(PRODUCTS).map((p) => p.image),
  PLACEHOLDER_PRODUCT.image,
];
