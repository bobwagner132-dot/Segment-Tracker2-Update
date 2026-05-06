import { useRef, useState } from "react";
import { Download, Upload, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { downloadBackup, restoreBackup } from "../lib/api";

export default function Backup() {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  async function handleExport() {
    setBusy(true);
    try {
      const data = await downloadBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
      a.href = url;
      a.download = `segment-tracker-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error("Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(files) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!window.confirm("This will REPLACE all current data with the backup. Continue?")) return;
    setBusy(true);
    try {
      const text = await f.text();
      const json = JSON.parse(text);
      const res = await restoreBackup(json);
      toast.success(
        `Restored ${res.segments} segments, ${res.rides} rides, ${res.efforts} efforts`
      );
    } catch (e) {
      toast.error("Restore failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-8 animate-fade-up max-w-3xl" data-testid="backup-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-accent mb-3">/ / Backup</div>
        <h1 className="font-display font-black text-4xl md:text-6xl uppercase tracking-tighter leading-[0.9]">
          Data Control
        </h1>
        <p className="text-secondary text-sm mt-4">
          Download a JSON snapshot of every segment, ride, and detected effort. Restore it on any
          machine to resume exactly where you left off.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-line bg-surface p-6" data-testid="export-card">
          <Download className="w-6 h-6 text-accent mb-4" strokeWidth={1.5} />
          <div className="font-display font-bold uppercase tracking-tight text-lg mb-2">Export</div>
          <p className="text-secondary text-xs tracking-wide mb-6">
            Download a single JSON file containing your full database.
          </p>
          <button
            onClick={handleExport}
            disabled={busy}
            data-testid="export-btn"
            className="w-full bg-accent text-black font-bold uppercase tracking-[0.2em] text-xs py-3 accent-fill disabled:opacity-50"
          >
            {busy ? "Working…" : "Download Backup"}
          </button>
        </div>

        <div className="border border-line bg-surface p-6" data-testid="import-card">
          <Upload className="w-6 h-6 text-danger mb-4" strokeWidth={1.5} />
          <div className="font-display font-bold uppercase tracking-tight text-lg mb-2">Restore</div>
          <p className="text-secondary text-xs tracking-wide mb-4">
            Replace current data with a previously-exported JSON backup.
          </p>
          <div className="flex items-start gap-2 text-[11px] text-danger mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>This will overwrite all current data. Consider exporting first.</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => handleRestore(e.target.files)}
            className="hidden"
            data-testid="restore-input"
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            data-testid="restore-btn"
            className="w-full border border-line-strong text-main font-bold uppercase tracking-[0.2em] text-xs py-3 hover:border-danger disabled:opacity-50"
          >
            {busy ? "Working…" : "Select JSON File"}
          </button>
        </div>
      </div>

      <div className="border border-line-subtle bg-black/30 p-6 text-xs text-muted space-y-2">
        <div className="text-[10px] tracking-[0.3em] uppercase text-secondary">About Local Storage</div>
        <p>
          All data is persisted in your local MongoDB instance and served only by the backend running
          alongside the app. No third-party services are contacted.
        </p>
        <p>
          To back up for disaster recovery (e.g. Time Machine), run the export regularly and save the
          JSON file to a backed-up folder.
        </p>
      </div>
    </div>
  );
}
