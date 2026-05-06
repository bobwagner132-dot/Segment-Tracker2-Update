import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";

export default function EditableName({ value, onSave, testid = "editable-name", className = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  async function save() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2" data-testid={`${testid}-editing`}>
        <input
          ref={ref}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") cancel();
          }}
          data-testid={`${testid}-input`}
          className={`bg-transparent border-b border-accent text-main focus:outline-none min-w-0 flex-1 ${className}`}
        />
        <button
          onClick={save}
          disabled={busy}
          data-testid={`${testid}-save`}
          className="p-1 text-accent hover:bg-subtle"
          aria-label="Save"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          data-testid={`${testid}-cancel`}
          className="p-1 text-muted hover:text-danger"
          aria-label="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 group" data-testid={testid}>
      <span className={className}>{value}</span>
      <button
        onClick={() => setEditing(true)}
        data-testid={`${testid}-edit`}
        className="mt-2 p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-accent transition-opacity"
        aria-label="Rename"
      >
        <Pencil className="w-4 h-4" />
      </button>
    </div>
  );
}
