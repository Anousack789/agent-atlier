"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export function Dialog({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      aria-label={title}
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="ปิดหน้าต่าง"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
