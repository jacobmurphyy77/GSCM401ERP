import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import JsBarcode from "jsbarcode";
import ZXing from "@zxing/library";

const { MultiFormatReader, RGBLuminanceSource, BinaryBitmap, HybridBinarizer, BarcodeFormat, DecodeHintType } = ZXing;

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/barcodes.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { barcodeLabelData, cameraErrorMessage, findBarcodeItem, normalizeBarcode, printableBarcode } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

function decodePrintedPattern(value, scale = 3) {
  const target = {};
  JsBarcode(target, value, { format: "CODE128", displayValue: false });
  const modules = "0".repeat(20) + target.encodings.map((encoding) => encoding.data).join("") + "0".repeat(20);
  const width = modules.length * scale;
  const height = 120;
  const pixels = new Uint8ClampedArray(width * height); pixels.fill(255);
  for (let y = 10; y < height - 10; y++) for (let x = 0; x < width; x++) if (modules[Math.floor(x / scale)] === "1") pixels[y * width + x] = 0;
  const reader = new MultiFormatReader();
  reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]]]));
  return reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height)))).getText();
}

test("printed Code128 bar patterns decode to every existing stored item barcode", () => {
  const migration = readFileSync(new URL("../supabase/migrations/202611160001_erp_foundation.sql", import.meta.url), "utf8");
  const barcodes = [...migration.matchAll(/\('(BIKE-[A-Z]+|PART-[A-Z]+)','([^']+)'/g)].map((match) => match[2]);
  assert.ok(barcodes.length >= 12);
  for (const barcode of barcodes) assert.equal(decodePrintedPattern(barcode), barcode);
});

test("Code128 printed barcodes preserve leading zeroes and accept typed SKU labels", () => {
  for (const value of ["001234567890", "PART-BAR-GRAVEL", "100000000001"]) {
    for (const scale of [2, 3]) assert.equal(decodePrintedPattern(value, scale), value);
  }
});

test("USB scanner framing is removed without coercing a barcode to a number", () => {
  assert.equal(normalizeBarcode("\u0002001234567890\r\n"), "001234567890");
  assert.equal(normalizeBarcode(1234), "");
  assert.equal(normalizeBarcode("  PART-BAR-GRAVEL  "), "PART-BAR-GRAVEL");
});

test("label preparation blocks missing, duplicate and non-printable barcode values", () => {
  const items = [
    { id: "1", sku: "A", name: "Frame", barcode: "001234567890" },
    { id: "2", sku: "B", name: "Wheel", barcode: "001234567890" },
    { id: "3", sku: "C", name: "Saddle", barcode: null },
    { id: "4", sku: "D", name: "Bar", barcode: "UNICODE-🚲" },
    { id: "5", sku: "E", name: "Tire", barcode: "100000000005" },
  ];
  const result = barcodeLabelData(items);
  assert.equal(result.issues.length, 4);
  assert.deepEqual(result.labels.map((label) => label.id), ["5"]);
  assert.equal(printableBarcode("x".repeat(49)), false);
});

test("scan lookup selects the exact item and refuses ambiguous barcodes", () => {
  const items = [{ id: "1", sku: "PART-BAR-GRAVEL", name: "Gravel handlebar", barcode: "001234567890" }, { id: "2", sku: "PART-BAR-MOUNTAIN", name: "Mountain handlebar", barcode: "100000000002" }];
  assert.equal(findBarcodeItem(items, "001234567890\r\n")?.id, "1");
  assert.equal(findBarcodeItem(items, "part-bar-mountain")?.id, "2");
  assert.equal(findBarcodeItem(items, "unknown"), null);
  assert.equal(findBarcodeItem([...items, { ...items[0], id: "3" }], "001234567890"), null);
});

test("camera denial, missing hardware and busy cameras all keep a manual fallback", () => {
  for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError"]) assert.match(cameraErrorMessage({ name }), /barcode field|USB scanner/);
});
