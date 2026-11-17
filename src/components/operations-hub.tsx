"use client";
import { useState } from "react";
import { Modal } from "./modal";
import type { OperationTask, TaskModule } from "@/src/lib/operations";

export function TaskBadge({ module, label, tasks, onNavigate }: { module: string; label: string; tasks: OperationTask[]; onNavigate: (module: TaskModule, recordId?: string) => void }) {
  const [open, setOpen] = useState(false);
  const queue = module === "overview" ? tasks : tasks.filter((task) => task.module === module);
  return <><button className={`task-badge${queue.some((task) => task.urgent) ? " urgent" : ""}`} aria-label={`${label}: ${queue.length} tasks`} title={`${queue.length} tasks · ${label}`} onClick={() => setOpen(true)}>{queue.length}</button>
    <Modal title={`${label} · work queue`} open={open} onClose={() => setOpen(false)} wide><p className="muted">Tasks update from your orders, inventory, purchasing, production, and tracking records.</p>{queue.length ? <div className="task-list">{queue.map((task) => <button key={task.id} className="task-card" onClick={() => { onNavigate(task.module, task.recordId); setOpen(false); }}><span className={task.urgent ? "task-dot urgent" : "task-dot"}/><span><strong>{task.title}</strong><small>{task.detail}</small></span><span aria-hidden="true">→</span></button>)}</div> : <div className="empty-state">No outstanding tasks in this queue.</div>}</Modal></>;
}

export function OperationsHub({ tasks, onNavigate }: { tasks: OperationTask[]; onNavigate: (module: TaskModule, recordId?: string) => void }) {
  const steps: { module: TaskModule; title: string; text: string }[] = [
    { module: "orders", title: "Sell & confirm", text: "Paid orders become demand and reserve available stock." },
    { module: "mrp", title: "Plan materials", text: "BOM quantities, stock, and incoming POs determine shortages." },
    { module: "purchasing", title: "Source & receive", text: "Purchase missing components and receive them into inventory." },
    { module: "production", title: "Build & inspect", text: "Issue components, record good output, and capture quality losses." },
    { module: "shipments", title: "Fulfill & collect", text: "Pick finished goods and keep customers informed through collection." },
  ];
  return <section className="panel workflow-hub"><div className="panel-heading"><div><p className="eyebrow">THE CONNECTED WORKDAY</p><h2>From customer demand to pickup</h2><p>Use the queues to find the next action. Stocked orders can move straight to fulfillment.</p></div><span className="workflow-total">{tasks.length} open tasks</span></div><div className="workflow-steps">{steps.map((step) => <button key={step.module} onClick={() => onNavigate(step.module)}><span>{tasks.filter((task) => task.module === step.module).length} tasks</span><strong>{step.title}</strong><small>{step.text}</small><b aria-hidden="true">↗</b></button>)}</div><div className="workflow-priorities">{tasks.slice(0,5).map((task) => <button key={task.id} onClick={() => onNavigate(task.module, task.recordId)}><span className={task.urgent ? "task-dot urgent" : "task-dot"}/><span>{task.title}<small>{task.detail}</small></span><b>Open →</b></button>)}{!tasks.length && <p className="muted">All operational queues are clear.</p>}</div></section>;
}
