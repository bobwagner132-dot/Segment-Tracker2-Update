// Login + first-run "Set admin password" screens.
//
// Picks which form to render from useAuth().state — "needs_setup" shows the
// wizard, "logged_out" shows login. The user component never sees an
// authenticated screen until the auth state flips to "logged_in".

import { useState } from "react";
import { Lock, Mail, Sparkles, ArrowRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatApiError } from "../lib/api";

export default function LoginPage() {
  const { state } = useAuth();
  if (state === "loading") {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[10px] tracking-[0.4em] uppercase text-muted">
          Connecting…
        </div>
      </div>
    );
  }
  if (state === "needs_setup") return <SetupCard />;
  return <LoginCard />;
}

function Shell({ children, title, sub, badge }) {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 grid place-items-center bg-accent text-black font-display font-black text-lg">
            ST
          </div>
          <div>
            <div className="font-display font-bold uppercase tracking-tight text-xl">
              Segment<span className="text-accent">Tracker</span>
            </div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted">
              personal · cycling · analysis
            </div>
          </div>
        </div>
        <div className="border border-line bg-surface">
          <header className="px-6 py-5 border-b border-line-subtle flex items-center gap-3">
            {badge}
            <div>
              <div className="font-display font-bold uppercase tracking-tight">
                {title}
              </div>
              {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
            </div>
          </header>
          <div className="p-6">{children}</div>
        </div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-faint mt-6 text-center">
          self-hosted · local-first · single device
        </div>
      </div>
    </div>
  );
}

function LoginCard() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Sign in"
      sub="Welcome back."
      badge={<Lock className="w-4 h-4 text-accent" strokeWidth={1.8} />}
    >
      <form onSubmit={submit} className="space-y-5" data-testid="login-form">
        <Field label="Email" icon={Mail}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
            data-testid="login-email"
            className="flex-1 bg-transparent text-sm py-1 focus:outline-none"
          />
        </Field>
        <Field label="Password" icon={Lock}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            data-testid="login-password"
            className="flex-1 bg-transparent text-sm py-1 focus:outline-none"
          />
        </Field>
        {err && (
          <div
            className="text-xs uppercase tracking-[0.15em] text-danger border border-danger/40 bg-danger/10 px-3 py-2"
            data-testid="login-error"
          >
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !email || !password}
          data-testid="login-submit"
          className="w-full inline-flex items-center justify-center gap-2 bg-accent text-black font-bold uppercase tracking-[0.2em] text-xs py-3 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </Shell>
  );
}

function SetupCard() {
  const { completeSetup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await completeSetup(email.trim(), password);
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Create your admin account"
      sub="One-time setup. Your existing rides, segments and bikes will be linked to this account."
      badge={<Sparkles className="w-4 h-4 text-accent" strokeWidth={1.8} />}
    >
      <form onSubmit={submit} className="space-y-5" data-testid="setup-form">
        <Field label="Email" icon={Mail}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            data-testid="setup-email"
            className="flex-1 bg-transparent text-sm py-1 focus:outline-none"
          />
        </Field>
        <Field label="Password (≥ 8 chars)" icon={Lock}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            data-testid="setup-password"
            className="flex-1 bg-transparent text-sm py-1 focus:outline-none"
          />
        </Field>
        <Field label="Confirm password" icon={Lock}>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            data-testid="setup-confirm"
            className="flex-1 bg-transparent text-sm py-1 focus:outline-none"
          />
        </Field>
        {err && (
          <div
            className="text-xs uppercase tracking-[0.15em] text-danger border border-danger/40 bg-danger/10 px-3 py-2"
            data-testid="setup-error"
          >
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !email || !password || !confirm}
          data-testid="setup-submit"
          className="w-full inline-flex items-center justify-center gap-2 bg-accent text-black font-bold uppercase tracking-[0.2em] text-xs py-3 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create admin account"}
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </Shell>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-2">
        {label}
      </div>
      <div className="flex items-center gap-3 border-b border-line-strong focus-within:border-accent transition-colors">
        {Icon && <Icon className="w-4 h-4 text-faint" strokeWidth={1.6} />}
        {children}
      </div>
    </label>
  );
}
