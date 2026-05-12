// Admin / housekeeping page — storage usage, backup scheduler controls,
// backup-now button, restore from server backup or uploaded ZIP, orphan
// uploads sweeper. All purely diagnostic — no destructive action runs
// without a ConfirmDialog round-trip first.

import { useEffect, useRef, useState } from "react";
import {
  Database,
  HardDrive,
  Clock,
  Download,
  Upload as UploadIcon,
  Trash2,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "../components/ConfirmDialog";
import {
  getAdminStorage,
  listAdminBackups,
  deleteOrphanUploads,
  backupZipUrl,
  adminListUsers,
  adminCreateUser,
  adminDeleteUser,
  adminResetPassword,
  adminSetAdmin,
  formatApiError,
} from "../lib/api";
import { useAuth } from "../lib/auth";

// Local helpers — admin endpoints not on the main client surface
const BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

async function _json(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export default function Admin() {
  const [storage, setStorage] = useState(null);
  const [sched, setSched] = useState(null);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [confirmOrphans, setConfirmOrphans] = useState(false);
  const uploadRef = useRef(null);

  async function refresh() {
    try {
      const [s, sc, b] = await Promise.all([
        getAdminStorage(),
        _json("GET", "/admin/scheduler"),
        listAdminBackups(),
      ]);
      setStorage(s);
      setSched(sc);
      setBackups(b);
    } catch (e) {
      toast.error(`Load failed: ${e.message || e}`);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function backupNow() {
    setBusy(true);
    try {
      const r = await _json("POST", "/admin/backup-now", {});
      toast.success(`Backup saved · ${fmtBytes(r.bytes)}`);
      await refresh();
    } catch (e) {
      toast.error(`Backup failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(patch) {
    try {
      const r = await _json("PATCH", "/admin/scheduler", patch);
      setSched(r);
      toast.success("Schedule updated");
    } catch (e) {
      toast.error(`Save failed: ${e.message || e}`);
    }
  }

  async function doRestore(name) {
    setBusy(true);
    try {
      await _json("POST", "/admin/restore-from-server-backup", { name });
      toast.success("Restored — reload the page to see new data");
      await refresh();
    } catch (e) {
      toast.error(`Restore failed: ${e.message || e}`);
    } finally {
      setBusy(false);
      setConfirmRestore(null);
    }
  }

  async function uploadAndRestore(file) {
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file, file.name);
    try {
      const res = await fetch(BASE + "/admin/restore-zip-upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      toast.success("Restored from upload — reload the page to see new data");
      await refresh();
    } catch (e) {
      toast.error(`Restore failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function sweepOrphans() {
    setConfirmOrphans(false);
    setBusy(true);
    try {
      const r = await deleteOrphanUploads();
      toast.success(`Removed ${r.removed} orphan file(s)`);
      await refresh();
    } catch (e) {
      toast.error(`Sweep failed: ${e.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="admin-page">
      <header>
        <div className="text-[10px] tracking-[0.4em] uppercase text-accent font-bold">
          // ADMIN
        </div>
        <div className="text-secondary text-sm mt-1">
          Storage, scheduled backups, restore, housekeeping.
        </div>
      </header>

      {/* Storage gauges */}
      <section
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
        data-testid="admin-storage"
      >
        <Tile icon={Database} label="Database" value={fmtBytes(storage?.database_bytes)} />
        <Tile icon={HardDrive} label="Uploads" value={fmtBytes(storage?.uploads_bytes)}
              sub={`${storage?.gpx_files || 0} GPX · ${storage?.fit_files || 0} FIT`} />
        <Tile icon={Download} label="Backups on disk" value={fmtBytes(storage?.backups_bytes)}
              sub={`${storage?.backup_files || 0} file(s)`} />
        <Tile icon={HardDrive} label="Total" value={fmtBytes(storage?.total_bytes)}
              sub={storage?.data_dir} highlight />
      </section>

      {/* Scheduler */}
      <section
        className="border border-line bg-surface"
        data-testid="admin-scheduler"
      >
        <header className="px-5 py-3 border-b border-line-subtle flex items-center gap-3">
          <Clock className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div className="font-display font-bold uppercase tracking-tight">
            Scheduled backups
          </div>
          {sched?.next_run && (
            <div className="text-[10px] tracking-[0.2em] uppercase text-muted ml-auto">
              Next run · {new Date(sched.next_run).toLocaleString()}
            </div>
          )}
        </header>
        <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-5">
          <Field label="Every (hours)">
            <input
              type="number"
              min={0}
              max={168}
              defaultValue={sched?.settings?.interval_hours ?? 24}
              onBlur={(e) =>
                saveSettings({ interval_hours: parseInt(e.target.value || "0") })
              }
              data-testid="admin-interval"
              className="bg-transparent border-b border-line-strong focus:border-accent font-num text-xl py-1 w-full focus:outline-none"
            />
            <Hint>{(sched?.settings?.interval_hours ?? 24) === 0 ? "Disabled" : "Auto every N hours"}</Hint>
          </Field>
          <Field label="Keep latest">
            <input
              type="number"
              min={1}
              max={999}
              defaultValue={sched?.settings?.retention_count ?? 14}
              onBlur={(e) =>
                saveSettings({ retention_count: parseInt(e.target.value || "1") })
              }
              data-testid="admin-retention"
              className="bg-transparent border-b border-line-strong focus:border-accent font-num text-xl py-1 w-full focus:outline-none"
            />
            <Hint>Older ones get pruned automatically</Hint>
          </Field>
          <Field label="Include uploads">
            <label className="flex items-center gap-3 mt-2">
              <input
                type="checkbox"
                defaultChecked={sched?.settings?.include_uploads}
                onChange={(e) =>
                  saveSettings({ include_uploads: e.target.checked })
                }
                data-testid="admin-include-uploads"
                className="accent-cyan-400 w-4 h-4"
              />
              <span className="text-sm">FIT &amp; GPX originals in ZIP</span>
            </label>
          </Field>
          <Field label="Target folder">
            <input
              type="text"
              defaultValue={sched?.settings?.target_dir || ""}
              onBlur={(e) =>
                saveSettings({ target_dir: e.target.value.trim() })
              }
              data-testid="admin-target-dir"
              className="bg-transparent border-b border-line-strong focus:border-accent text-sm py-1 w-full focus:outline-none"
              placeholder="default"
            />
            <Hint>e.g. /Users/you/Documents/CyclingTracker/backups</Hint>
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-line-subtle flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={backupNow}
            disabled={busy}
            data-testid="admin-backup-now"
            className="inline-flex items-center gap-2 bg-accent text-black font-bold uppercase tracking-[0.2em] text-[11px] px-4 py-2 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Backup now
          </button>
          <a
            href={backupZipUrl({ includeUploads: true })}
            className="inline-flex items-center gap-2 border border-line-strong hover:border-accent px-4 py-2 text-[11px] uppercase tracking-[0.25em]"
            data-testid="admin-download-zip"
          >
            <Download className="w-3.5 h-3.5" />
            Download as ZIP
          </a>
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={busy}
            data-testid="admin-restore-upload"
            className="inline-flex items-center gap-2 border border-line-strong hover:border-accent px-4 py-2 text-[11px] uppercase tracking-[0.25em] disabled:opacity-50"
          >
            <UploadIcon className="w-3.5 h-3.5" />
            Restore from upload…
          </button>
          <input
            ref={uploadRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (
                window.confirm(
                  `Restore from ${f.name}? This REPLACES the database with the contents of the ZIP.`,
                )
              )
                uploadAndRestore(f);
            }}
          />
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-muted hover:text-secondary ml-auto"
            data-testid="admin-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </section>

      {/* Backup list */}
      <section className="border border-line bg-surface" data-testid="admin-backups">
        <header className="px-5 py-3 border-b border-line-subtle">
          <div className="text-[10px] tracking-[0.3em] uppercase text-muted">
            Backups in <span className="text-accent">{sched?.settings?.target_dir}</span>
            <span className="ml-2 font-num text-faint">· {backups.length}</span>
          </div>
        </header>
        {backups.length === 0 ? (
          <div className="px-5 py-6 text-muted text-sm">No backups yet.</div>
        ) : (
          <div className="divide-y divide-line-subtle">
            {backups.map((b) => (
              <div
                key={b.name}
                className="px-5 py-3 flex items-center gap-4"
                data-testid={`backup-row-${b.name}`}
              >
                <div className="font-num text-sm flex-1 truncate">{b.name}</div>
                <div className="text-xs text-muted">{fmtBytes(b.bytes)}</div>
                <div className="text-xs text-muted hidden sm:block">
                  {new Date(b.modified).toLocaleString()}
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmRestore(b)}
                  disabled={busy}
                  data-testid={`admin-restore-${b.name}`}
                  className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-accent hover:opacity-80 disabled:opacity-40"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Users (multi-user account management) */}
      <UsersSection />

      {/* Orphans */}
      <section
        className="border border-dashed border-line-strong bg-subtle p-5 flex flex-wrap items-center gap-3"
        data-testid="admin-orphans"
      >
        <Trash2 className="w-4 h-4 text-danger flex-shrink-0" />
        <div className="text-sm flex-1">
          Remove uploaded FIT/GPX files no longer referenced by any activity.
        </div>
        <button
          type="button"
          onClick={() => setConfirmOrphans(true)}
          disabled={busy}
          data-testid="admin-sweep-orphans"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] font-bold text-danger hover:opacity-80 disabled:opacity-40"
        >
          Sweep orphans
        </button>
      </section>

      <ConfirmDialog
        open={!!confirmRestore}
        title={`Restore ${confirmRestore?.name}?`}
        description="The current database is overwritten with the contents of this backup. Activities and segments not in the backup will be lost."
        confirmLabel="Restore"
        cancelLabel="Cancel"
        destructive
        testid="admin-confirm-restore"
        onConfirm={() => doRestore(confirmRestore.name)}
        onCancel={() => setConfirmRestore(null)}
      />
      <ConfirmDialog
        open={confirmOrphans}
        title="Sweep orphan uploads?"
        description="Files in the uploads folder not referenced by any ride row will be permanently deleted."
        confirmLabel="Sweep"
        cancelLabel="Cancel"
        destructive
        testid="admin-confirm-orphans"
        onConfirm={sweepOrphans}
        onCancel={() => setConfirmOrphans(false)}
      />
    </div>
  );
}

function UsersSection() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    try {
      setUsers(await adminListUsers());
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createUser(e) {
    e.preventDefault();
    setErr("");
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await adminCreateUser(email.trim(), password, makeAdmin);
      toast.success(`Created ${email}`);
      setEmail("");
      setPassword("");
      setMakeAdmin(false);
      setShowForm(false);
      await refresh();
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function resetPw(u) {
    const next = window.prompt(`New password for ${u.email}:`);
    if (!next) return;
    if (next.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    try {
      await adminResetPassword(u.id, next);
      toast.success(`Password reset for ${u.email}`);
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function toggleAdmin(u) {
    try {
      await adminSetAdmin(u.id, !u.is_admin);
      await refresh();
      toast.success(u.is_admin ? "Demoted to user" : "Promoted to admin");
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  async function removeUser(u) {
    if (!window.confirm(`Delete ${u.email}? Their rides, segments and bikes will be removed too.`))
      return;
    try {
      await adminDeleteUser(u.id);
      toast.success(`Deleted ${u.email}`);
      await refresh();
    } catch (e) {
      toast.error(formatApiError(e));
    }
  }

  return (
    <section className="border border-line bg-surface" data-testid="admin-users">
      <header className="px-5 py-3 border-b border-line-subtle flex items-center gap-3">
        <ShieldCheckIcon />
        <div className="font-display font-bold uppercase tracking-tight">Users</div>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            data-testid="admin-add-user-toggle"
            className="text-[11px] uppercase tracking-[0.25em] text-accent hover:opacity-80"
          >
            {showForm ? "Cancel" : "+ Invite user"}
          </button>
        </div>
      </header>
      {showForm && (
        <form
          onSubmit={createUser}
          className="p-5 border-b border-line-subtle grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
          data-testid="admin-add-user-form"
        >
          <label className="block">
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-1">Email</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              data-testid="admin-new-user-email"
              className="w-full bg-transparent border-b border-line-strong focus:border-accent text-sm py-1 focus:outline-none"
            />
          </label>
          <label className="block">
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-1">Password (≥ 8)</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              data-testid="admin-new-user-password"
              className="w-full bg-transparent border-b border-line-strong focus:border-accent text-sm py-1 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={makeAdmin}
              onChange={(e) => setMakeAdmin(e.target.checked)}
              data-testid="admin-new-user-isadmin"
              className="accent-cyan-400"
            />
            Admin
          </label>
          <button
            type="submit"
            disabled={busy}
            data-testid="admin-create-user-submit"
            className="bg-accent text-black font-bold uppercase tracking-[0.2em] text-[11px] py-2 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create user"}
          </button>
          {err && (
            <div
              className="md:col-span-4 text-xs text-danger"
              data-testid="admin-create-user-error"
            >
              {err}
            </div>
          )}
        </form>
      )}
      <div className="divide-y divide-line-subtle">
        {users.map((u) => (
          <div
            key={u.id}
            className="px-5 py-3 flex items-center gap-4 flex-wrap"
            data-testid={`admin-user-row-${u.id}`}
          >
            <div className="font-num text-sm flex-1 truncate">{u.email}</div>
            {u.is_admin && (
              <span className="text-[9px] tracking-[0.3em] uppercase bg-accent text-black px-2 py-0.5 font-bold">
                Admin
              </span>
            )}
            {!u.has_password && (
              <span className="text-[9px] tracking-[0.3em] uppercase text-danger border border-danger/40 px-2 py-0.5">
                No password
              </span>
            )}
            {u.last_login_at && (
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted hidden md:block">
                last login · {new Date(u.last_login_at).toLocaleDateString()}
              </span>
            )}
            <button
              type="button"
              onClick={() => resetPw(u)}
              data-testid={`admin-reset-${u.id}`}
              className="text-[10px] uppercase tracking-[0.25em] text-secondary hover:text-accent"
            >
              Reset password
            </button>
            {me?.id !== u.id && (
              <button
                type="button"
                onClick={() => toggleAdmin(u)}
                data-testid={`admin-toggle-${u.id}`}
                className="text-[10px] uppercase tracking-[0.25em] text-secondary hover:text-accent"
              >
                {u.is_admin ? "Demote" : "Promote"}
              </button>
            )}
            {me?.id !== u.id && (
              <button
                type="button"
                onClick={() => removeUser(u)}
                data-testid={`admin-delete-${u.id}`}
                className="text-[10px] uppercase tracking-[0.25em] text-danger hover:opacity-80"
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function ShieldCheckIcon() {
  // Inline so we don't pull a second lucide import; the page already uses it.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="text-accent"
    >
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function Tile({ icon: Icon, label, value, sub, highlight }) {
  return (
    <div className={`border ${highlight ? "border-accent" : "border-line"} bg-surface p-4`}>
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted flex items-center gap-2">
        {Icon && <Icon className="w-3 h-3" strokeWidth={1.8} />}
        {label}
      </div>
      <div className="font-num text-2xl font-black mt-2 leading-none">{value}</div>
      {sub && <div className="text-[10px] uppercase tracking-[0.2em] text-faint mt-2 truncate">{sub}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted">{label}</div>
      {children}
    </div>
  );
}

function Hint({ children }) {
  return <div className="text-[10px] tracking-[0.2em] uppercase text-faint mt-1">{children}</div>;
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
