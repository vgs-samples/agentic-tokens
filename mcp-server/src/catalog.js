export const products = [
  {
    id: "nike-pegasus-41-black",
    title: "Nike Pegasus 41 Road Running Shoes",
    brand: "Nike",
    category: "sneakers",
    color: "Black / White",
    price: 139.99,
    currency: "USD",
    merchantName: "Nike Store",
    merchantUrl: "https://mock.merchant.example/nike/pegasus-41",
    merchantCountry: "US",
    mcc: "5661",
    inStock: true,
    keywords: ["nike", "sneakers", "running", "road", "pegasus", "shoes"],
  },
  {
    id: "nike-dunk-low-retro",
    title: "Nike Dunk Low Retro",
    brand: "Nike",
    category: "sneakers",
    color: "White / Black",
    price: 115,
    currency: "USD",
    merchantName: "Nike Store",
    merchantUrl: "https://mock.merchant.example/nike/dunk-low-retro",
    merchantCountry: "US",
    mcc: "5661",
    inStock: true,
    keywords: ["nike", "sneakers", "lifestyle", "dunk", "shoes"],
  },
  {
    id: "nike-air-max-90",
    title: "Nike Air Max 90",
    brand: "Nike",
    category: "sneakers",
    color: "Wolf Grey / University Blue",
    price: 149.99,
    currency: "USD",
    merchantName: "Nike Store",
    merchantUrl: "https://mock.merchant.example/nike/air-max-90",
    merchantCountry: "US",
    mcc: "5661",
    inStock: true,
    keywords: ["nike", "sneakers", "air max", "lifestyle", "shoes"],
  },
  {
    id: "nike-air-force-1-07",
    title: "Nike Air Force 1 '07",
    brand: "Nike",
    category: "sneakers",
    color: "White",
    price: 109.99,
    currency: "USD",
    merchantName: "Nike Store",
    merchantUrl: "https://mock.merchant.example/nike/air-force-1-07",
    merchantCountry: "US",
    mcc: "5661",
    inStock: true,
    keywords: ["nike", "sneakers", "air force", "lifestyle", "shoes"],
  },
  {
    id: "adidas-samba-og",
    title: "adidas Samba OG Shoes",
    brand: "adidas",
    category: "sneakers",
    color: "Cloud White / Core Black",
    price: 100,
    currency: "USD",
    merchantName: "Mock Sneaker Shop",
    merchantUrl: "https://mock.merchant.example/adidas/samba-og",
    merchantCountry: "US",
    mcc: "5661",
    inStock: true,
    keywords: ["adidas", "sneakers", "samba", "shoes"],
  },
  {
    id: "new-balance-574-core",
    title: "New Balance 574 Core",
    brand: "New Balance",
    category: "sneakers",
    color: "Grey / White",
    price: 89.99,
    currency: "USD",
    merchantName: "Mock Sneaker Shop",
    merchantUrl: "https://mock.merchant.example/new-balance/574-core",
    merchantCountry: "US",
    mcc: "5661",
    inStock: true,
    keywords: ["new balance", "sneakers", "574", "shoes"],
  },
];

const QUERY_REPLACEMENTS = new Map([
  ["найк", "nike"],
  ["кроссовки", "sneakers"],
  ["кросовки", "sneakers"],
  ["кеды", "sneakers"],
  ["обувь", "shoes"],
]);

export function normalizeQuery(value = "") {
  let normalized = String(value).toLowerCase();
  for (const [source, target] of QUERY_REPLACEMENTS) {
    normalized = normalized.replaceAll(source, target);
  }
  return normalized;
}

export function parseMaxPrice(value = "") {
  const match = String(value).match(/(?:under|below|less than|up to|до)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i)
    ?? String(value).match(/\$\s*(\d+(?:\.\d{1,2})?)/)
    ?? String(value).match(/(\d+(?:\.\d{1,2})?)\s*\$/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

export function searchCatalog({ query = "", brand, maxPrice, limit = 5 } = {}) {
  const normalizedQuery = normalizeQuery(query);
  const tokens = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean);
  const requestedMaxPrice = Number.isFinite(Number(maxPrice)) ? Number(maxPrice) : parseMaxPrice(query);
  const requestedBrand = brand ? normalizeQuery(brand) : null;

  return products
    .filter((product) => product.inStock)
    .filter((product) => !requestedBrand || normalizeQuery(product.brand).includes(requestedBrand))
    .filter((product) => requestedMaxPrice === null || product.price <= requestedMaxPrice)
    .map((product) => {
      const haystack = normalizeQuery([
        product.title,
        product.brand,
        product.category,
        product.color,
        ...product.keywords,
      ].join(" "));
      const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
      return { product, score };
    })
    .filter(({ score }) => tokens.length === 0 || score > 0)
    .sort((a, b) => b.score - a.score || b.product.price - a.product.price)
    .slice(0, limit)
    .map(({ product }) => product);
}

export function findProduct(productId) {
  return products.find((product) => product.id === productId) ?? null;
}
