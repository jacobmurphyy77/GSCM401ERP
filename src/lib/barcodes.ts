export type BarcodeItem = { id: string; sku: string; name: string; barcode?: string | null };

/** Preserve leading zeroes; USB scanners often append Enter or framing controls. */
export function normalizeBarcode(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
}

export function printableBarcode(value: unknown): boolean {
  const barcode = normalizeBarcode(value);
  return barcode.length > 0 && barcode.length <= 48 && /^[\x20-\x7e]+$/.test(barcode);
}

export function findBarcodeItem<T extends BarcodeItem>(items: T[], value: unknown): T | null {
  const scanned = normalizeBarcode(value);
  if (!scanned) return null;
  const exact = items.filter((item) => normalizeBarcode(item.barcode) === scanned);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const skuMatches = items.filter((item) => item.sku.toUpperCase() === scanned.toUpperCase());
  return skuMatches.length === 1 ? skuMatches[0] : null;
}

export function barcodeLabelData<T extends BarcodeItem>(items: T[]) {
  const count = new Map<string, number>();
  for (const item of items) {
    const value = normalizeBarcode(item.barcode);
    if (value) count.set(value, (count.get(value) ?? 0) + 1);
  }
  const labels: (T & { barcode: string })[] = [];
  const issues: string[] = [];
  for (const item of items) {
    const barcode = normalizeBarcode(item.barcode);
    if (!printableBarcode(barcode)) issues.push(`${item.sku}: a printable barcode is missing or invalid.`);
    else if ((count.get(barcode) ?? 0) > 1) issues.push(`${item.sku}: barcode ${barcode} is assigned to more than one item.`);
    else labels.push({ ...item, barcode });
  }
  return { labels, issues };
}

export function cameraErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "Camera permission was denied. Allow camera access in your browser, or use the barcode field / USB scanner below.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. You can still use a USB scanner or enter the printed barcode below.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is busy or unavailable. Close other camera apps and try again, or use the barcode field below.";
  if (name === "OverconstrainedError") return "This camera could not start with the requested settings. Try another device or use the barcode field below.";
  return "The camera could not start. Check browser camera permission, or use the barcode field / USB scanner below.";
}
