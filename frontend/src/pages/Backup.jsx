import { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  AlertTriangle,
  Folder,
  FolderOpen,
  X,
  FileJson,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { downloadBackup, restoreBackup } from "../lib/api";
import {
  BACKUP_SUBFOLDER_NAME,
  clearSavedDir,
  ensureBackupDir,
  exportToFolder,
  getSavedDirHandle,
  isFsAccessSupported,
  listBackupsInFolder,
  pickBackupDir,
  readBackupFile,
} from "../lib/fsbackup";

const FS_SUPPORTED = isFsAccessSupported();

export default function Backup() {
  const [busy, setBusy] = useState(false);
  const [dirName, setDirName] = useState(null);
  const [restorePicker, setRestorePicker] = useState(null); // array of backup files when choosing
  const inputRef = useRef(null);

  // On mount, load the saved dir name (don't request permission yet — wait for a user gesture)
  useEffect(() => {
    (async () => {
      if (!FS_SUPPORTED) return;
      const h = await getSavedDirHandle();
      if (h) setDirName(h.name);
    })();
  }, []);

  async function handleChooseFolder() {
    try {
      const h = await pickBackupDir();
      setDirName(h.name);
      toast.success(`Backup folder set: ${h.name}`);
    } catch (e) {
      if (e?.name !== "AbortError") toast.error(e.message || "Could not set folder");
    }
  }

  async function handleForgetFolder() {
    await clearSavedDir();
    setDirName(null);
    toast.success("Backup folder cleared");
  }

  async function handleExport() {
    setBusy(true);
    try {
      const data = await downloadBackup();

      if (FS_SUPPORTED) {
        // Ensure we have a folder (prompt if none)
        const dir = await ensureBackupDir({ prompt: true });
        if (!dir) {
          setBusy(false);
          return;
        }
        setDirName(dir.name);
        const { filename, subfolder } = await exportToFolder(dir, data);
        toast.success(`Saved to ${dir.name}/${subfolder}/${filename}`);
      } else {
        // Fallback: classic download
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
        a.href = url;
        a.download = `segment-tracker-backup-${stamp}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Backup downloaded");
      }
    } catch (e) {
      toast.error(e.message || "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreFromFolder() {
    if (!FS_SUPPORTED) {
      // Fallback to file picker
      inputRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const dir = await ensureBackupDir({ prompt: true });
      if (!dir) {
        setBusy(false);
        return;
      }
      setDirName(dir.name);
      const backups = await listBackupsInFolder(dir);
      if (backups.length === 0) {
        toast.error(`No .json backups found in ${dir.name}/${BACKUP_SUBFOLDER_NAME}/`);
        setBusy(false);
        return;
      }
      setRestorePicker(backups);
    } catch (e) {
      toast.error(e.message || "Could not list backups");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreChoice(backup) {
    if (!window.confirm(`Restore "${backup.name}"? This will REPLACE all current data.`)) return;
    setBusy(true);
    try {
      const json = await readBackupFile(backup.handle);
      const res = await restoreBackup(json);
      toast.success(
        `Restored ${res.segments} segments, ${res.rides} rides, ${res.efforts} efforts`
      );
      setRestorePicker(null);
    } catch (e) {
      toast.error("Restore failed: " + (e.message || "unknown error"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreFromFileInput(files) {
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
      toast.error("Restore failed: " + (e.message || "unknown error"));
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
          Save a JSON snapshot of every segment, ride, and detected effort into a folder of your
          choice. Restore from the same folder to return to exactly where you left off.
        </p>
      </div>

      {/* Folder card */}
      <div className="border border-line bg-surface p-6" data-testid="folder-card">
        <div className="flex items-start gap-4">
          {dirName ? (
            <FolderOpen className="w-6 h-6 text-accent flex-shrink-0" strokeWidth={1.5} />
          ) : (
            <Folder className="w-6 h-6 text-faint flex-shrink-0" strokeWidth={1.5} />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold uppercase tracking-tight text-lg mb-1">
              Backup folder
            </div>
            {FS_SUPPORTED ? (
              dirName ? (
                <>
                  <div className="text-sm text-main truncate" data-testid="backup-dir-name">
                    {dirName}
                    <span className="text-muted">/{BACKUP_SUBFOLDER_NAME}/</span>
                  </div>
                  <div className="text-[11px] text-secondary mt-1">
                    Exports go here automatically. On first use this session the browser may ask you
                    to re-confirm access.
                  </div>
                </>
              ) : (
                <div className="text-xs text-secondary">
                  No folder selected. Pick one and we'll create a{" "}
                  <code className="text-accent">{BACKUP_SUBFOLDER_NAME}/</code> subfolder inside it
                  for all exports.
                </div>
              )
            ) : (
              <div className="text-xs text-secondary">
                Your browser doesn't support the folder picker (File System Access API).{" "}
                <span className="text-main">Backups will download to your Downloads folder</span>{" "}
                and restore requires you to pick the JSON file manually. Chrome, Edge, Brave or Arc
                support the full flow.
              </div>
            )}
          </div>
          {FS_SUPPORTED && (
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button
                onClick={handleChooseFolder}
                disabled={busy}
                data-testid="pick-folder-btn"
                className="border border-line-strong hover:border-accent text-main font-bold uppercase tracking-[0.2em] text-[10px] px-4 py-2 disabled:opacity-50"
              >
                {dirName ? "Change" : "Pick folder"}
              </button>
              {dirName && (
                <button
                  onClick={handleForgetFolder}
                  disabled={busy}
                  data-testid="forget-folder-btn"
                  className="text-[10px] uppercase tracking-[0.2em] text-muted hover:text-danger"
                >
                  Forget
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Export / Restore */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-line bg-surface p-6" data-testid="export-card">
          <Download className="w-6 h-6 text-accent mb-4" strokeWidth={1.5} />
          <div className="font-display font-bold uppercase tracking-tight text-lg mb-2">Export</div>
          <p className="text-secondary text-xs tracking-wide mb-6">
            {FS_SUPPORTED
              ? dirName
                ? `Writes a timestamped JSON into ${dirName}/${BACKUP_SUBFOLDER_NAME}/.`
                : "Pick a folder on first export — we'll create a Backup/ subfolder there."
              : "Downloads a single JSON file containing your full database."}
          </p>
          <button
            onClick={handleExport}
            disabled={busy}
            data-testid="export-btn"
            className="w-full bg-accent text-black font-bold uppercase tracking-[0.2em] text-xs py-3 accent-fill disabled:opacity-50"
          >
            {busy ? "Working…" : FS_SUPPORTED ? "Save Backup" : "Download Backup"}
          </button>
        </div>

        <div className="border border-line bg-surface p-6" data-testid="import-card">
          <Upload className="w-6 h-6 text-danger mb-4" strokeWidth={1.5} />
          <div className="font-display font-bold uppercase tracking-tight text-lg mb-2">Restore</div>
          <p className="text-secondary text-xs tracking-wide mb-4">
            {FS_SUPPORTED
              ? `Looks inside ${BACKUP_SUBFOLDER_NAME}/ in your backup folder and lets you pick a snapshot.`
              : "Select any previously-exported JSON file."}
          </p>
          <div className="flex items-start gap-2 text-[11px] text-danger mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>This will overwrite all current data. Consider exporting first.</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            onChange={(e) => handleRestoreFromFileInput(e.target.files)}
            className="hidden"
            data-testid="restore-input"
          />
          <button
            onClick={handleRestoreFromFolder}
            disabled={busy}
            data-testid="restore-btn"
            className="w-full border border-line-strong text-main font-bold uppercase tracking-[0.2em] text-xs py-3 hover:border-danger disabled:opacity-50"
          >
            {busy
              ? "Working…"
              : FS_SUPPORTED
                ? "Browse Backup folder"
                : "Select JSON File"}
          </button>
          {FS_SUPPORTED && (
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              data-testid="restore-manual-btn"
              className="w-full text-[10px] uppercase tracking-[0.2em] text-muted hover:text-secondary mt-3"
            >
              or pick a single JSON file manually
            </button>
          )}
        </div>
      </div>

      {/* Restore picker */}
      {restorePicker && (
        <RestorePicker
          backups={restorePicker}
          onChoose={handleRestoreChoice}
          onClose={() => setRestorePicker(null)}
          busy={busy}
        />
      )}

      <div className="border border-line-subtle bg-black/30 p-6 text-xs text-muted space-y-2">
        <div className="text-[10px] tracking-[0.3em] uppercase text-secondary">About Local Storage</div>
        <p>
          All data is persisted in your browser's <code className="text-accent">IndexedDB</code>{" "}
          (database <code className="text-accent">cst2</code>) on this device. Nothing is sent to a
          server — everything works offline once the app has loaded.
        </p>
        <p>
          For disaster recovery (e.g. clearing browser data, switching Macs, Time Machine) pick a
          folder inside iCloud / Dropbox / Documents and run the export regularly.
        </p>
      </div>
    </div>
  );
}

function RestorePicker({ backups, onChoose, onClose, busy }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      data-testid="restore-picker"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-line max-w-xl w-full max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="font-display font-bold uppercase tracking-tight text-lg">
            Choose a backup to restore
          </div>
          <button
            onClick={onClose}
            data-testid="restore-picker-close"
            className="text-muted hover:text-main"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="divide-y divide-white/5">
          {backups.map((b) => (
            <button
              key={b.name}
              onClick={() => onChoose(b)}
              disabled={busy}
              data-testid={`restore-pick-${b.name}`}
              className="w-full flex items-center gap-4 px-6 py-4 hover:bg-subtle text-left disabled:opacity-50"
            >
              <FileJson className="w-5 h-5 text-accent flex-shrink-0" strokeWidth={1.5} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{b.name}</div>
                <div className="text-[11px] text-muted mt-0.5">
                  {new Date(b.lastModified).toLocaleString()} ·{" "}
                  {(b.size / 1024).toFixed(1)} KB
                </div>
              </div>
              <Check className="w-4 h-4 text-faint" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
