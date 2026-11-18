"use client";

import { ReactNode, useEffect, useRef } from "react";
import { Icon } from "./icon";

export function Modal({ title, open, onClose, children, wide = false, drawer = false }: {
  title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; drawer?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => { if (open && dialog.current) dialog.current.scrollTop = 0; }, [title, open]);
  return <dialog ref={dialog} className={`store-dialog${wide ? " store-dialog-wide" : ""}${drawer ? " store-drawer" : ""}`} aria-label={title} onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="store-dialog-inner"><div className="store-dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close" /></button></div>{children}</div>
  </dialog>;
}
