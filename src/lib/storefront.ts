export type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  description: string;
  sale_price: number;
  lead_time_days: number;
  item_type: "bike" | "component";
  component_family?: string | null;
  compatible_bike_id?: string | null;
  legacy_component_id?: string | null;
};

export type PickupLocation = {
  id: string;
  name: string;
  city: string;
  postal_code: string;
  tax_rate: number;
  location_type?: "storefront" | "warehouse";
};

export type Stock = { item_id: string; location_id: string; on_hand: number; reserved: number };
export type BomLine = { parent_item_id: string; component_item_id: string; quantity_per: number };
export type Cart = Record<string, number>;

const employeeRoles = ["sales", "warehouse", "production", "finance", "manager"];

export function isEmployeeRole(role: unknown) {
  return typeof role === "string" && employeeRoles.includes(role);
}

export function availableStock(stock: Stock[], itemId: string, locationId: string) {
  const row = stock.find((entry) => entry.item_id === itemId && entry.location_id === locationId);
  return Math.max(0, Number(row?.on_hand ?? 0) - Number(row?.reserved ?? 0));
}

export function retailStockLocation(item: CatalogItem, pickup: PickupLocation | undefined, locations: PickupLocation[]) {
  if (!pickup) return null;
  if (item.item_type !== "component") return pickup.id;
  return locations.find((location) => location.city === pickup.city && location.location_type === "warehouse")?.id ?? null;
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
  const rows = items.filter((item) => Number(item.sale_price) > 0 && Number.isSafeInteger(cart[item.id]) && cart[item.id] > 0);
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
  "PART-FRAME": { image: "part-frame.webp", category: "Frames", caption: "The starting point of a great ride." },
  "PART-WHEEL": { image: "part-wheel.webp", category: "Wheels", caption: "Keep your next adventure rolling. Sold individually." },
  "PART-TIRE": { image: "part-tire.webp", category: "Tires", caption: "A fresh connection to the road. Sold individually." },
  "PART-BRAKE": { image: "part-brake.webp", category: "Brakes", caption: "The brake set used in our bike builds." },
  "PART-DRIVE": { image: "part-drivetrain.webp", category: "Drivetrain", caption: "Keep the power moving through your ride." },
  "PART-SEAT": { image: "part-seat.webp", category: "Saddles", caption: "Make yourself at home on the bike." },
  "PART-BAR": { image: "part-bar.webp", category: "Handlebars", caption: "Find your direction, one ride at a time." },
};

export const partFamilyLabels: Record<string, string> = { FRAME: "Frames", WHEEL: "Wheels", TIRE: "Tires", BRAKE: "Brakes", DRIVE: "Drivetrain", SEAT: "Saddles", BAR: "Handlebars" };
const partNames: Record<string, string> = { FRAME: "Bicycle Frame", WHEEL: "Bicycle Wheel", TIRE: "Bicycle Tire", BRAKE: "Brake Set", DRIVE: "Drivetrain", SEAT: "Saddle", BAR: "Handlebar" };

export function partProductName(item: CatalogItem) {
  return partNames[componentFamily(item) ?? ""] ?? item.name;
}

export function partPriceLabel(items: CatalogItem[]) {
  const prices = items.map((item) => Number(item.sale_price)).filter((price) => Number.isFinite(price) && price > 0);
  if (!prices.length) return "Not available yet";
  const low = Math.min(...prices), high = Math.max(...prices);
  return low === high ? money(low) : `${money(low)} – ${money(high)}`;
}

export function partCollections(items: CatalogItem[], family = "") {
  const groups = new Map<string, CatalogItem[]>();
  for (const part of retailParts(items)) {
    const partFamily = componentFamily(part);
    if (family && partFamily !== family) continue;
    const key = partFamily ?? part.id;
    groups.set(key, [...(groups.get(key) ?? []), part]);
  }
  return [...groups].map(([key, variants]) => ({ key, name: partProductName(variants[0]), variants }));
}

export function componentFamily(item: CatalogItem): string | null {
  if (item.item_type !== "component") return null;
  if (item.component_family && partFamilyLabels[item.component_family]) return item.component_family;
  return /^PART-(FRAME|WHEEL|TIRE|BRAKE|DRIVE|SEAT|BAR)(?:-|$)/.exec(item.sku)?.[1] ?? null;
}

export function retailParts(items: CatalogItem[]) {
  const components = items.filter((item) => item.item_type === "component");
  const specificFamilies = new Set(components.filter((item) => item.compatible_bike_id).map(componentFamily));
  return components.filter((item) => item.compatible_bike_id || !specificFamilies.has(componentFamily(item)));
}

export function compatibleBikeName(item: CatalogItem, items: CatalogItem[]) {
  return item.compatible_bike_id ? items.find((bike) => bike.id === item.compatible_bike_id && bike.item_type === "bike")?.name ?? null : null;
}

export const productPresentation = (item: CatalogItem) => presentation[item.sku] ??
  (componentFamily(item) ? presentation[`PART-${componentFamily(item)}`] : null) ??
  { image: item.item_type === "component" ? "part-frame.webp" : "gravel.webp", category: item.item_type === "component" ? "Parts" : "Bikes", caption: item.description };
