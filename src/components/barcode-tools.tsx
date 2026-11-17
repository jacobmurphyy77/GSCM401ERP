"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import JsBarcode from "jsbarcode";
import { BarcodeItem, barcodeLabelData, cameraErrorMessage, normalizeBarcode } from "@/src/lib/barcodes";
import { Modal } from "./modal";
import "./barcode-tools.css";

export type BarcodeScannerProps = {
  onScan: (barcode: string) => void | Promise<void>;
  title?: string;
  buttonLabel?: string;
  disabled?: boolean;
  continuous?: boolean;
};

/** A USB/manual scanner works without camera permission. Camera starts only after Start camera. */
export function BarcodeScanner({ onScan, title = "Scan a product barcode", buttonLabel = "Scan barcode", disabled = false, continuous = false }: BarcodeScannerProps) {
  const [open, setOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inputId = useId();
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const reading = useRef(false);
  const mounted = useRef(true);
  const lastScan = useRef({ value: "", at: 0 });
  const onScanCurrent = useRef(onScan);
  const continuousCurrent = useRef(continuous);
  useEffect(() => { onScanCurrent.current = onScan; continuousCurrent.current = continuous; }, [onScan, continuous]);

  function stopCamera() {
    generation.current += 1;
    controls.current?.stop(); controls.current = null;
    mediaStream.current?.getTracks().forEach((track) => track.stop()); mediaStream.current = null;
    const stream = video.current?.srcObject;
    if (typeof MediaStream !== "undefined" && stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (video.current) video.current.srcObject = null;
    setCameraActive(false); setStarting(false);
  }

  useEffect(() => {
    mounted.current = true;
    const element = video.current;
    return () => {
      mounted.current = false;
      generation.current += 1;
      controls.current?.stop(); controls.current = null;
      mediaStream.current?.getTracks().forEach((track) => track.stop()); mediaStream.current = null;
      const stream = element?.srcObject;
      if (typeof MediaStream !== "undefined" && stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function close() { stopCamera(); setOpen(false); setValue(""); setError(""); setStatus(""); lastScan.current = { value: "", at: 0 }; }

  async function acceptScan(rawValue: string) {
    const scanned = normalizeBarcode(rawValue);
    if (!scanned || reading.current) return;
    if (lastScan.current.value === scanned && Date.now() - lastScan.current.at < 1800) return;
    reading.current = true; setSubmitting(true); setError("");
    try {
      await onScanCurrent.current(scanned);
      lastScan.current = { value: scanned, at: Date.now() };
      if (!mounted.current) return;
      setValue(""); setStatus(`Scanned ${scanned}.`);
      if (!continuousCurrent.current) close();
      else input.current?.focus();
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "That barcode could not be added. Please try again.");
    } finally { reading.current = false; if (mounted.current) setSubmitting(false); }
  }

  async function startCamera() {
    if (starting || cameraActive) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera scanning needs HTTPS and a browser with camera support. Use the barcode field or a USB scanner below."); return;
    }
    const attempt = ++generation.current;
    setStarting(true); setCameraActive(true); setError(""); setStatus("Point the camera at a printed barcode. Keep the full barcode inside the frame.");
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      if (generation.current !== attempt || !mounted.current || !video.current) return;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 1800 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (generation.current !== attempt || !mounted.current || !video.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      mediaStream.current = stream;
      const next = await reader.decodeFromStream(stream, video.current, (result) => {
        if (result && generation.current === attempt && mounted.current) void acceptScan(result.getText());
      });
      if (generation.current !== attempt || !mounted.current) { next.stop(); stream.getTracks().forEach((track) => track.stop()); return; }
      controls.current = next;
      setStarting(false);
    } catch (reason) {
      if (generation.current !== attempt || !mounted.current) return;
      stopCamera(); setError(cameraErrorMessage(reason)); setStatus("");
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); void acceptScan(value); }

  return <>
    <button type="button" className="barcode-tool-button" disabled={disabled} onClick={() => { setOpen(true); setError(""); setStatus(""); }}>{buttonLabel}</button>
    <Modal title={title} open={open} onClose={close}>
      <div className="barcode-scanner">
        <p>Scan a printed label with your camera, use a USB scanner, or enter the barcode or SKU.</p>
        <div className={`barcode-camera${cameraActive ? " barcode-camera-active" : ""}`}>
          <video ref={video} muted playsInline aria-label="Barcode camera preview" />
          {cameraActive && <div className="barcode-camera-guide" aria-hidden="true" />}
          {!cameraActive && <span>Camera is off</span>}
        </div>
        <div className="barcode-tool-actions">
          {!cameraActive ? <button type="button" onClick={() => void startCamera()} disabled={starting || submitting}>Start camera</button> : <button type="button" onClick={stopCamera}>Stop camera</button>}
          <small>Use good light and leave a little space around the barcode.</small>
        </div>
        <form onSubmit={submit} className="barcode-manual-form">
          <label htmlFor={inputId}>Printed barcode or SKU</label>
          <div><input ref={input} id={inputId} value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Scan or type the label" required/><button type="submit" disabled={submitting || !normalizeBarcode(value)}>{submitting ? "Reading…" : "Use barcode"}</button></div>
        </form>
        {status && <p className="barcode-tool-status" role="status">{status}</p>}
        {error && <p className="barcode-tool-error" role="alert">{error}</p>}
      </div>
    </Modal>
  </>;
}

function BarcodeLabel({ item }: { item: BarcodeItem & { barcode: string } }) {
  const svg = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!svg.current) return;
    try { JsBarcode(svg.current, item.barcode, { format: "CODE128", width: 2, height: 55, margin: 12, fontSize: 13, displayValue: true, background: "#ffffff", lineColor: "#000000" }); setFailed(false); }
    catch { setFailed(true); }
  }, [item.barcode]);
  return <article className="barcode-label"><strong>{item.name}</strong><span>{item.sku}</span>{failed ? <p>Barcode could not be generated.</p> : <svg ref={svg} aria-label={`Barcode ${item.barcode}`} role="img"/>}</article>;
}

export function BarcodeLabels({ items, buttonLabel = "Print barcode labels" }: { items: BarcodeItem[]; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copies, setCopies] = useState(1);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [notice, setNotice] = useState("");
  const labelRoot = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => items.filter((item) => `${item.sku} ${item.name} ${item.barcode ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())), [items, search]);
  const chosen = visible.filter((item) => selected === null || selected.includes(item.id));
  const { labels, issues } = barcodeLabelData(chosen);
  const validCopies = Number.isInteger(copies) && copies >= 1 && copies <= 20;
  const repeat = validCopies ? copies : 1;

  function printLabels() {
    if (!labelRoot.current || !labels.length || issues.length || !validCopies) return;
    const iframe = document.createElement("iframe");
    iframe.title = "Printable product barcode labels";
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
    iframe.onload = () => {
      const target = iframe.contentWindow;
      if (!target) { iframe.remove(); setNotice("Printing could not start. Please try this page in another browser."); return; }
      target.addEventListener("afterprint", () => iframe.remove(), { once: true });
      target.focus(); target.print();
      window.setTimeout(() => iframe.remove(), 60000);
    };
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>Wasatch Cycle Works barcode labels</title><style>@page{size:auto;margin:12mm}body{margin:0;font-family:Arial,sans-serif;color:#000;background:#fff}.barcode-label-sheet{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5mm}.barcode-label{border:1px dashed #aaa;padding:4mm;text-align:center;break-inside:avoid;page-break-inside:avoid;min-height:31mm;display:flex;flex-direction:column;align-items:center;justify-content:center}.barcode-label strong{font-size:11px;line-height:1.3}.barcode-label>span{font-size:10px;margin:2mm 0}.barcode-label svg{max-width:100%;height:auto;width:auto;min-height:22mm}h1{font-size:16px}p{font-size:10px}</style></head><body><h1>Wasatch Cycle Works · Product labels</h1><p>Print at actual size (100%). Cut around each label. Barcode values match the item records.</p>${labelRoot.current.outerHTML}</body></html>`;
    document.body.appendChild(iframe);
    setNotice("Print dialog opened. Choose actual size / 100% scale for scanning.");
  }

  return <>
    <button type="button" className="barcode-tool-button" disabled={!items.length} onClick={() => { setOpen(true); setNotice(""); }}>{buttonLabel}</button>
    <Modal title="Product barcode labels" open={open} onClose={() => setOpen(false)} wide>
      <div className="barcode-label-controls"><label>Find items<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, SKU, or barcode"/></label><label>Copies per item<input type="number" min={1} max={20} value={copies} onChange={(event) => setCopies(Number(event.target.value))}/></label></div>
      <p>These Code 128 barcodes use the values stored on your products. Print on white paper, cut out the labels, and scan them in POS, inventory, or receiving.</p>
      <div className="barcode-tool-actions"><button type="button" onClick={() => setSelected(null)}>Select all matching items</button><button type="button" onClick={() => setSelected([])}>Clear selection</button><button type="button" disabled={!labels.length || Boolean(issues.length) || !validCopies} onClick={printLabels}>Print {labels.length * repeat} labels</button></div>
      {!validCopies && <p className="barcode-tool-error" role="alert">Choose a whole number of copies from 1 to 20.</p>}
      <div className="barcode-item-picker">{visible.map((item) => <label key={item.id}><input type="checkbox" checked={selected === null || selected.includes(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current ?? items.map((row) => row.id)); if (event.target.checked) next.add(item.id); else next.delete(item.id); return [...next]; })}/><span>{item.name}<small>{item.sku}</small></span></label>)}</div>
      {issues.length > 0 && <div className="barcode-tool-error" role="alert">{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}
      {notice && <p className="barcode-tool-status" role="status">{notice}</p>}
      {!labels.length && !issues.length && <p>No selected items match this search.</p>}
      <div className="barcode-label-sheet" ref={labelRoot}>{labels.flatMap((item) => Array.from({ length: repeat }, (_, copy) => <BarcodeLabel key={`${item.id}-${copy}`} item={item}/>))}</div>
    </Modal>
  </>;
}
