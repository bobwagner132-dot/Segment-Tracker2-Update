import { Switch } from "@/components/ui/switch";
import { useTheme, MAP_STYLES } from "@/lib/theme";
import { Moon, Sun, Palette, Database, Info, Map as MapIcon, BookOpen } from "lucide-react";

export default function Preferences() {
  const { theme, setTheme, mapStyle, setMapStyle } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="space-y-8 animate-fade-up max-w-3xl" data-testid="preferences-page">
      <div>
        <div className="text-[10px] tracking-[0.4em] uppercase text-accent mb-3">
          / / Settings
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

      {/* Map Section */}
      <section className="border border-line bg-surface" data-testid="prefs-map">
        <header className="px-6 py-4 border-b border-line-subtle flex items-center gap-3">
          <MapIcon className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div className="font-display font-bold uppercase tracking-tight">Map style</div>
        </header>
        <div className="p-6 space-y-4">
          <div className="text-xs text-secondary">
            Choose how the map renders for segments and rides. <span className="text-accent">Auto</span>{" "}
            follows the background mode (CartoDB Dark / Light).
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {Object.entries(MAP_STYLES).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                data-testid={`prefs-map-${key}`}
                className={`text-left border p-3 transition-colors ${
                  mapStyle === key ? "border-accent bg-accent-5" : "border-line hover:border-line-strong"
                }`}
              >
                <MapTilePreview styleKey={key} theme={theme} />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide truncate">
                    {cfg.label}
                  </div>
                  {mapStyle === key && (
                    <span className="text-[9px] tracking-[0.3em] uppercase text-accent">●</span>
                  )}
                </div>
              </button>
            ))}
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

      {/* How-to Section */}
      <section className="border border-line bg-surface" data-testid="prefs-howto">
        <header className="px-6 py-4 border-b border-line-subtle flex items-center gap-3">
          <BookOpen className="w-4 h-4 text-accent" strokeWidth={1.8} />
          <div className="font-display font-bold uppercase tracking-tight">How to use</div>
        </header>
        <div className="p-6 space-y-4 text-sm text-secondary leading-relaxed">
          <p data-testid="howto-instruction">
            Create a route in your favourite software (
            <span className="text-main font-semibold">Strava</span>,{" "}
            <span className="text-main font-semibold">Ride with GPS</span>,{" "}
            <span className="text-main font-semibold">Garmin Connect</span>, etc.) then export it as
            a <span className="text-accent font-semibold">GPX</span> file and upload it as a{" "}
            <span className="text-main font-semibold">Segment</span>. You can then upload your ride
            as a <span className="text-main font-semibold">Ride</span> as either a{" "}
            <span className="text-accent font-semibold">.fit</span> or{" "}
            <span className="text-accent font-semibold">.gpx</span> file.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-xs text-secondary">
            <li>
              Build a target route (e.g. a climb you train on) in your usual app and export the GPX.
            </li>
            <li>
              Open <span className="text-accent">Segments</span> here and drop the GPX into the
              upload zone.
            </li>
            <li>
              After your real ride, export the file from your bike computer or app (.FIT preferred,
              .GPX also fine) and drop it in <span className="text-accent">Rides</span>.
            </li>
            <li>
              The app auto-detects whether your ride passed through the segment (within 30 m) and
              records the time, average power and heart rate as an effort.
            </li>
            <li>
              Compare runs across years on the <span className="text-accent">Leaderboards</span> tab.
            </li>
          </ol>
        </div>
      </section>

      <section className="border border-line-subtle bg-subtle p-6 flex items-start gap-3" data-testid="prefs-about">
        <Info className="w-4 h-4 text-muted mt-0.5 flex-shrink-0" />
        <div className="text-xs text-secondary">
          Preferences are saved to your browser's <code className="text-accent">localStorage</code>{" "}
          (keys <code className="text-accent">cst-theme</code> and{" "}
          <code className="text-accent">cst-map-style</code>) and apply only to this device. Visit{" "}
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

function MapTilePreview({ styleKey, theme }) {
  const effectiveKey = styleKey === "auto" ? theme : styleKey;
  const SWATCHES = {
    dark: ["#0F1117", "#1E2128", "#2C313A"],
    light: ["#E8EBEF", "#D4D9DF", "#BFC4CC"],
    standard: ["#F2EFE9", "#C8D8AF", "#A4C7D8"],
    terrain: ["#F1ECDA", "#C3BB94", "#7FA268"],
  };
  const swatch = SWATCHES[effectiveKey] || SWATCHES.dark;
  return (
    <div className="h-12 grid grid-cols-3 border border-line-subtle">
      {swatch.map((c) => (
        <div key={c} style={{ background: c }} />
      ))}
    </div>
  );
}
