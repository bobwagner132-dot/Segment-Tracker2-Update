import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

// Lightweight in-app confirmation modal. Works inside cross-origin iframes
// where window.confirm() is suppressed by the browser.
//
// Usage:
//   <ConfirmDialog
//     open={showConfirm}
//     title="Delete this activity?"
//     description="This will also remove all detected efforts for this ride."
//     confirmLabel="Delete"
//     onConfirm={handleConfirmedDelete}
//     onCancel={() => setShowConfirm(false)}
//     destructive
//   />
export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
  testid = "confirm-dialog",
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") onCancel?.();
      else if (e.key === "Enter") onConfirm?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4"
      data-testid={testid}
      onClick={onCancel}
    >
      <div
        className="bg-surface border-2 border-line-strong shadow-2xl max-w-md w-full"
        style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.45)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 px-6 py-5 border-b border-line">
          {destructive && (
            <AlertTriangle className="w-6 h-6 text-danger flex-shrink-0 mt-0.5" strokeWidth={1.8} />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold uppercase tracking-tight text-lg leading-tight">
              {title}
            </div>
            {description && (
              <div className="text-sm text-secondary mt-2">{description}</div>
            )}
          </div>
          <button
            onClick={onCancel}
            data-testid={`${testid}-x`}
            aria-label="Close"
            className="text-muted hover:text-main"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4">
          <button
            onClick={onCancel}
            data-testid={`${testid}-cancel`}
            className="px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] border border-line-strong text-main hover:border-line"
          >
            {cancelLabel}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            data-testid={`${testid}-confirm`}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] border ${
              destructive
                ? "bg-danger text-white border-danger hover:bg-danger/90"
                : "bg-accent text-black border-accent hover:bg-accent/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
