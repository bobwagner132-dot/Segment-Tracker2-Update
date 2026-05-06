import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/lib/theme";
import { Moon, Sun, Palette, Database, Info } from "lucide-react";

export default function Preferences() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="space-y-8 animate-fade-up max-w-3xl" data-testid="preferences-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-accent mb-3">
          / / Preferences
        </div>
        <h1 className="font-display font-black text-4xl md:text-6xl uppercase tracking-tighter leading-[0.9]">
          Tune the cockpit
        </h1>
        <p className="text-secondary text-sm mt-4">
          Personal settings for this device. Stored locally — no account required.
        </p>
      </div>

      {/* Appearance Section */}
      <section className="border border-line bg-surface" data-testid="prefs-appearance">
        <header className="px-6 py-4 border-b border-line-subtle flex items-center gap-3">
          <Palette className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div className="font-display font-bold uppercase tracking-tight">Appearance</div>
        </header>
        <div className="p-6">
          <div className="flex items-center justify-between gap-6 flex-wrap">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <div
                className={`w-10 h-10 border border-line flex items-center justify-center transition-colors ${
                  isDark ? "bg-page" : "bg-elevated"
                }`}
                aria-hidden
              >
                {isDark ? (
                  <Moon className="w-5 h-5 text-accent" strokeWidth={1.8} />
                ) : (
                  <Sun className="w-5 h-5 text-accent" strokeWidth={1.8} />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-main">Background mode</div>
                <div className="text-xs text-secondary mt-1">
                  {isDark
                    ? "Dark mode is on. Optimised for low-light analysis sessions."
                    : "Light mode is on. Better for outdoor screens and bright rooms."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-[10px] tracking-[0.3em] uppercase ${
                  !isDark ? "text-muted" : "text-accent"
                }`}
              >
                Dark
              </span>
              <Switch
                checked={!isDark}
                onCheckedChange={(v) => setTheme(v ? "light" : "dark")}
                data-testid="prefs-theme-switch"
                aria-label="Toggle light mode"
              />
              <span
                className={`text-[10px] tracking-[0.3em] uppercase ${
                  isDark ? "text-muted" : "text-accent"
                }`}
              >
                Light
              </span>
            </div>
          </div>

          {/* Theme preview */}
          <div className="grid grid-cols-2 gap-3 mt-8" data-testid="theme-preview">
            <ThemePreview
              label="Dark"
              active={isDark}
              onClick={() => setTheme("dark")}
              palette={["#050507", "#0A0A0C", "#FFFFFF", "#00E5FF"]}
              testid="prefs-pick-dark"
            />
            <ThemePreview
              label="Light"
              active={!isDark}
              onClick={() => setTheme("light")}
              palette={["#F5F6F8", "#FFFFFF", "#0A0A0C", "#008EA3"]}
              testid="prefs-pick-light"
            />
          </div>
        </div>
      </section>

      {/* Detection Section (read-only info) */}
      <section className="border border-line bg-surface" data-testid="prefs-detection">
        <header className="px-6 py-4 border-b border-line-subtle flex items-center gap-3">
          <Database className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div className="font-display font-bold uppercase tracking-tight">Detection</div>
        </header>
        <div className="p-6 grid grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted">Match radius</div>
            <div className="font-num text-3xl font-black mt-1">30 m</div>
            <div className="text-xs text-secondary mt-1">
              A ride is considered to have completed a segment when it passes within this distance
              of the segment start, then the end (in order).
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.3em] uppercase text-muted">Time zone</div>
            <div className="font-num text-3xl font-black mt-1">
              {Intl.DateTimeFormat().resolvedOptions().timeZone || "Local"}
            </div>
            <div className="text-xs text-secondary mt-1">
              All efforts are grouped by year using your device's local time zone.
            </div>
          </div>
        </div>
      </section>

      <section className="border border-line-subtle bg-subtle p-6 flex items-start gap-3" data-testid="prefs-about">
        <Info className="w-4 h-4 text-muted mt-0.5 flex-shrink-0" />
        <div className="text-xs text-secondary">
          Theme preference is saved to your browser's <code className="text-accent">localStorage</code>{" "}
          (key <code className="text-accent">cst-theme</code>) and applies only to this device. Visit{" "}
          <span className="text-accent">Backup</span> to export your full database to JSON.
        </div>
      </section>
    </div>
  );
}

function ThemePreview({ label, active, onClick, palette, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`group text-left border transition-colors ${
        active ? "border-accent" : "border-line hover:border-line-strong"
      }`}
    >
      <div className="grid grid-cols-4 h-16">
        {palette.map((c) => (
          <div key={c} style={{ background: c }} />
        ))}
      </div>
      <div className="px-4 py-3 flex items-center justify-between border-t border-line">
        <div className="text-sm font-semibold uppercase tracking-wide">{label}</div>
        {active ? (
          <span className="text-[10px] tracking-[0.3em] uppercase text-accent">Active</span>
        ) : (
          <span className="text-[10px] tracking-[0.3em] uppercase text-muted group-hover:text-secondary">
            Apply
          </span>
        )}
      </div>
    </button>
  );
}
