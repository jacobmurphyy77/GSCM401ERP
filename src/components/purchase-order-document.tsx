"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { purchaseDocumentTotals, purchaseOrderEmail, purchaseOrderHtml, type PurchaseDocument } from "@/src/lib/purchase-order-document";
import { Modal } from "./modal";
type Dispatch={id:string;method:string;recipient:string;reference:string;recorded_at:string};
export function PurchaseOrderDocument({supabase,orderId,onClose,onRecorded}:{supabase:SupabaseClient;orderId:string|null;onClose:()=>void;onRecorded?:()=>void|Promise<void>}){
  const [order,setOrder]=useState<PurchaseDocument|null>(null),[history,setHistory]=useState<Dispatch[]>([]);
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[auditReady,setAuditReady]=useState(false);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[recipient,setRecipient]=useState(''),[reference,setReference]=useState(''),[method,setMethod]=useState('email'),[confirmed,setConfirmed]=useState(false),[emailText,setEmailText]=useState('');
  const request=useRef<{fingerprint:string;id:string}|null>(null),saving=useRef(false),generation=useRef(0);
  const invalidate=useCallback(()=>{generation.current++;},[]);
  const load=useCallback(async()=>{
    if(!orderId)return;
    const current=++generation.current;setLoading(true);setError('');
    try{
      const [po,dispatch]=await Promise.all([
        supabase.from('purchase_orders').select('id,po_number,status,ordered_at,expected_at,received_at,due_at,amount,suppliers(name,contact_name,email,phone,quoted_lead_days,payment_terms_days),locations(name,city,postal_code),purchase_order_lines(id,item_id,quantity_ordered,quantity_received,unit_cost,items(name,sku))').eq('id',orderId).single(),
        supabase.from('purchase_order_dispatches').select('id,method,recipient,reference,recorded_at').eq('purchase_order_id',orderId).order('recorded_at',{ascending:false}),
      ]);
      if(current!==generation.current)return;
      if(po.error||!po.data)throw new Error(po.error?.message??'Purchase order not found.');
      const value=po.data as unknown as PurchaseDocument;setOrder(value);setRecipient(current=>current||value.suppliers?.email||'');
      setAuditReady(!dispatch.error);setHistory((dispatch.data??[]) as Dispatch[]);
    }catch(failure){if(current===generation.current)setError(failure instanceof Error?failure.message:'Could not load this purchase order.');}
    finally{if(current===generation.current)setLoading(false);}
  },[orderId,supabase]);
  useEffect(()=>{setOrder(null);setHistory([]);setRecipient('');setMethod('email');setMessage('');setReference('');setConfirmed(false);setEmailText('');request.current=null;void load();return invalidate;},[load,invalidate]);
  const document=useMemo(()=>{if(!order)return {html:'',error:''};try{purchaseDocumentTotals(order);return {html:purchaseOrderHtml(order),error:''};}catch(failure){return {html:'',error:failure instanceof Error?failure.message:'Check the PO before sending.'};}},[order]);
  function download(){if(!order||!document.html)return;const url=URL.createObjectURL(new Blob([document.html],{type:'text/html;charset=utf-8'}));const anchor=window.document.createElement('a');anchor.href=url;anchor.download=`Wasatch-PO-${order.po_number}.html`;anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('PO document downloaded. Send the file to your supplier, then record the sending below.');}
  function print(){if(!document.html)return;const frame=window.document.createElement('iframe');frame.title='Print purchase order';frame.setAttribute('sandbox','allow-modals allow-same-origin');frame.style.cssText='position:fixed;width:0;height:0;border:0';frame.onload=()=>{frame.contentWindow?.focus();frame.contentWindow?.print();};frame.srcdoc=document.html;window.document.body.appendChild(frame);window.setTimeout(()=>frame.remove(),60000);}
  function email(){if(!order)return;setError('');try{const draft=purchaseOrderEmail(order,recipient);setEmailText(`${draft.subject}\n\n${draft.body}`);if(draft.href.length>1800){setMessage('This PO is too long for an email link. Copy the text below into your email app and attach the downloaded document.');return;}window.location.href=draft.href;setMessage('Email draft opened in your email app. Send it there, then record the sending below. No automatic delivery has been claimed.');}catch(failure){setError(failure instanceof Error?failure.message:'Check the recipient email.');}}
  async function record(event:FormEvent){
    event.preventDefault();if(!order||saving.current||!auditReady||!confirmed)return;
    saving.current=true;setBusy(true);setError('');
    try{
      if(document.error)throw new Error(document.error);
      const to=recipient.trim(),ref=reference.trim();
      if(method==='email')purchaseOrderEmail(order,to);
      if(ref.length<3||ref.length>500)throw new Error('Enter a sending reference of 3–500 characters.');
      const fingerprint=JSON.stringify([order.id,method,to,ref]);
      if(request.current?.fingerprint!==fingerprint)request.current={fingerprint,id:crypto.randomUUID()};
      const {data,error:failure}=await supabase.rpc('record_purchase_order_dispatch',{p_order_id:order.id,p_method:method,p_recipient:to,p_reference:ref,p_request_id:request.current.id});
      if(failure||!data?.id)throw new Error(failure?.message??'Sending could not be confirmed. Retry with the same details.');
      setMessage('Your confirmed sending is saved to this purchase order in Supabase.');setConfirmed(false);await load();if(onRecorded)await onRecorded();
    }catch(failure){setError(failure instanceof Error?failure.message:'Sending could not be recorded.');}
    finally{saving.current=false;setBusy(false);}
  }
  return <Modal title={order?`PO-${order.po_number} · document & sending`:'Purchase order document'} open={!!orderId} onClose={onClose} wide>
    {loading&&!order&&<p>Loading stored purchase order…</p>}{error&&<p className="notice" role="alert">{error}</p>}{document.error&&<p className="notice" role="alert">{document.error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    {order&&<><p className="muted">Review the document, send it with your email app or downloaded file, then confirm the sending. The legacy PO status “sent” alone is not proof of delivery.</p><div className="workspace-tools"><button className="primary" disabled={!document.html} onClick={print}>Print / save PDF</button><button className="secondary" disabled={!document.html} onClick={download}>Download PO document</button><button className="secondary" disabled={loading} onClick={()=>void load()}>Refresh sending history</button></div>
      {document.html&&<iframe className="purchase-document-preview" title={`PO-${order.po_number} preview`} sandbox="" srcDoc={document.html}/>}
      <section className="po-send-panel"><h3>Send to supplier</h3><label>Recipient email / contact<input value={recipient} onChange={event=>setRecipient(event.target.value)} maxLength={254}/></label><button className="secondary" disabled={!document.html||!recipient||order.status==='cancelled'} onClick={email}>Open supplier email draft</button>{emailText&&<label>Email text — copy if your email app did not open<textarea rows={9} readOnly value={emailText}/></label>}
        <form onSubmit={event=>void record(event)}><label>Sending method<select value={method} onChange={event=>setMethod(event.target.value)}><option value="email">Email sent by employee</option><option value="document">Document delivered by employee</option></select></label><label>Sending reference<input required minLength={3} maxLength={500} value={reference} onChange={event=>setReference(event.target.value)} placeholder="For example: sent from the team email account"/></label><label className="po-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>I sent this purchase order to the recipient above.</label><button className="primary" disabled={busy||!auditReady||!confirmed||!document.html||order.status==='cancelled'}>{busy?'Recording…':'Record confirmed sending'}</button></form>
        {!auditReady&&<p className="notice">Documents and email drafts are available. To save sending confirmations in Supabase, apply <a target="_blank" rel="noreferrer" href="https://github.com/jacobmurphyy77/GSCM401ERP/blob/setup/nextjs-supabase/supabase/migrations/202611170007_purchase_order_dispatch.sql">the purchase-order dispatch migration</a>.</p>}
      </section><section className="po-dispatch-history"><h3>Recorded sending history</h3>{history.length?history.map(entry=><article key={entry.id}><strong>{entry.method==='email'?'Email':'Document'} · {entry.recipient}</strong><p>{entry.reference}</p><small>Recorded {new Date(entry.recorded_at).toLocaleString()} · Employee-confirmed sending</small></article>):<p className="muted">No confirmed sending has been recorded. Printing, downloading and opening a draft do not add an entry.</p>}</section>
    </>}
  </Modal>;
}
