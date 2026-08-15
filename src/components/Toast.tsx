import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";

export type ToastState = { kind: "success" | "error"; message: string } | null;

export function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
      {toast.kind === "success" ? <CheckCircle size={20} weight="fill" /> : <WarningCircle size={20} weight="fill" />}
      <span>{toast.message}</span>
      <button className="icon-button compact" onClick={onClose} aria-label="关闭提示"><X size={16} /></button>
    </div>
  );
}

