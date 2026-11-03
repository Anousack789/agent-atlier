"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

function values(root: HTMLElement) {
  return JSON.stringify(Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>(
    'input, textarea, select, button[aria-pressed], [role="combobox"]',
  ), (control) => [
    control.value,
    control instanceof HTMLInputElement ? control.checked : undefined,
    control.getAttribute("aria-pressed"),
    control.getAttribute("role") === "combobox" ? control.textContent : undefined,
  ]));
}

export function FormPage({ title, close, children }: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const leave = useRef<() => void>(() => {});
  const historyKey = useRef<string>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const root = content.current!;
    const trigger = document.activeElement;
    const scroll = window.scrollY;
    const key = historyKey.current ??= crypto.randomUUID();
    const push = () => history.pushState({ ...history.state, officeForm: key }, "");
    if (history.state?.officeForm !== key) push();
    let baseline: string | undefined;
    let leaving = false;
    const dirty = () => baseline !== undefined && values(root) !== baseline;
    const capture = () => { baseline ??= values(root); };
    const confirm = () => !dirty() || window.confirm("ทิ้งการเปลี่ยนแปลงที่ยังไม่ได้บันทึกหรือไม่?");
    const back = () => {
      if (leaving) return;
      leaving = true;
      history.back();
    };
    const pop = () => {
      if (history.state?.officeForm === key) return;
      if (leaving || confirm()) closeRef.current();
      else push();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!leaving && dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    leave.current = () => { if (confirm()) back(); };
    heading.current?.focus();
    window.scrollTo(0, 0);
    root.addEventListener("focusin", capture);
    root.addEventListener("pointerdown", capture, true);
    root.addEventListener("keydown", capture, true);
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("office-form-saved", back);
    return () => {
      root.removeEventListener("focusin", capture);
      root.removeEventListener("pointerdown", capture, true);
      root.removeEventListener("keydown", capture, true);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("office-form-saved", back);
      requestAnimationFrame(() => {
        if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
        window.scrollTo(0, scroll);
      });
    };
  }, []);

  return (
    <main className="main-content mx-auto w-full max-w-[1440px] max-sm:[&_.form-row]:grid-cols-1">
      <button type="button" onClick={() => leave.current()}><ArrowLeft size={17} /> ย้อนกลับ</button>
      <h1 ref={heading} tabIndex={-1} className="my-5 break-words">{title}</h1>
      <div ref={content} className="panel min-w-0 p-4 sm:p-6">{children}</div>
    </main>
  );
}
