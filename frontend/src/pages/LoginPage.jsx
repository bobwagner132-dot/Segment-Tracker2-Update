// Passwordless sign-in screen.
//
// One text field — your name. First time you type a name, that profile is
// auto-created. Designed for a local-first single-Mac install where macOS
// already gates physical access.

import { useState } from "react";
import { User, ArrowRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { formatApiError } from "../lib/api";

export default function LoginPage() {
  const { state, signIn } = useAuth();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[10px] tracking-[0.4em] uppercase text-muted">
          Connecting…
        </div>
      </div>
    );
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await signIn(name.trim());
    } catch (e) {
      setErr(formatApiError(e));
    } finally {
      setBusy(false);
    }
  }

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
            <User className="w-4 h-4 text-accent" strokeWidth={1.8} />
            <div>
              <div className="font-display font-bold uppercase tracking-tight">
                Who's riding?
              </div>
              <div className="text-xs text-muted mt-1">
                Type your name to continue. New names create a fresh profile.
              </div>
            </div>
          </header>
          <div className="p-6">
            <form onSubmit={submit} className="space-y-5" data-testid="signin-form">
              <label className="block">
                <div className="text-[10px] tracking-[0.3em] uppercase text-muted mb-2">
                  Your name
                </div>
                <div className="flex items-center gap-3 border-b border-line-strong focus-within:border-accent transition-colors">
                  <User className="w-4 h-4 text-faint" strokeWidth={1.6} />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={60}
                    data-testid="signin-name"
                    className="flex-1 bg-transparent text-sm py-1 focus:outline-none"
                    placeholder="e.g. Bob"
                  />
                </div>
              </label>
              {err && (
                <div
                  className="text-xs uppercase tracking-[0.15em] text-danger border border-danger/40 bg-danger/10 px-3 py-2"
                  data-testid="signin-error"
                >
                  {err}
                </div>
              )}
              <button
                type="submit"
                disabled={busy || !name.trim()}
                data-testid="signin-submit"
                className="w-full inline-flex items-center justify-center gap-2 bg-accent text-black font-bold uppercase tracking-[0.2em] text-xs py-3 disabled:opacity-50"
              >
                {busy ? "Signing in…" : "Sign in"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        <div className="text-[10px] tracking-[0.3em] uppercase text-faint mt-6 text-center">
          self-hosted · local-first · single device
        </div>
      </div>
    </div>
  );
}
