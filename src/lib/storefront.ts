export type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  description: string;
  sale_price: number;
  lead_time_days: number;
};

export type PickupLocation = {
  id: string;
  name: string;
  city: string;
  postal_code: string;
  tax_rate: number;
};

export type Stock = { item_id: string; location_id: string; on_hand: number; reserved: number };
export type Cart = Record<string, number>;

const employeeRoles = ["sales", "warehouse", "production", "finance", "manager"];

export function isEmployeeRole(role: unknown) {
  return typeof role === "string" && employeeRoles.includes(role);
}

export function availableStock(stock: Stock[], itemId: string, locationId: string) {
  const row = stock.find((entry) => entry.item_id === itemId && entry.location_id === locationId);
  return Math.max(0, Number(row?.on_hand ?? 0) - Number(row?.reserved ?? 0));
}

export function parseSavedCart(value: string | null): Cart {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, quantity]) =>
      /^[a-f0-9-]{36}$/i.test(id) && typeof quantity === "number" && Number.isSafeInteger(quantity) && quantity > 0,
    ));
  } catch { return {}; }
}

export function calculateCart(items: CatalogItem[], cart: Cart, discountPercent: number, taxRate: number) {
  const rows = items.filter((item) => Number.isSafeInteger(cart[item.id]) && cart[item.id] > 0);
  const subtotalCents = rows.reduce((sum, item) => sum + Math.round(Number(item.sale_price) * 100) * cart[item.id], 0);
  const rate = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  const discountCents = Math.round(subtotalCents * rate / 100);
  const taxCents = Math.round((subtotalCents - discountCents) * (Number(taxRate) || 0));
  return {
    rows,
    units: rows.reduce((sum, item) => sum + cart[item.id], 0),
    subtotal: subtotalCents / 100,
    discount: discountCents / 100,
    tax: taxCents / 100,
    total: (subtotalCents - discountCents + taxCents) / 100,
  };
}

export const money = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value ?? 0));
export const assetPath = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/media/${path}`;

const presentation: Record<string, { image: string; category: string; caption: string }> = {
  "BIKE-STREET": { image: "street.webp", category: "Street", caption: "Make the everyday route your favorite ride." },
  "BIKE-MOUNTAIN": { image: "mountain.webp", category: "Mountain", caption: "A little closer to the trail. A little farther from ordinary." },
  "BIKE-GRAVEL": { image: "gravel.webp", category: "Gravel", caption: "For the days that call for the long way home." },
  "BIKE-TRI": { image: "tri.webp", category: "Triathlon", caption: "Find your rhythm on the open road." },
  "BIKE-KIDS": { image: "kids.webp", category: "Kids", caption: "Small wheels. Big adventures." },
};

export const productPresentation = (item: CatalogItem) => presentation[item.sku] ?? { image: "gravel.webp", category: "Bikes", caption: item.description };
