import { NavLink, Outlet } from "react-router-dom";
import { Activity, Map, Route, Trophy, DatabaseBackup, LayoutDashboard } from "lucide-react";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true, testid: "nav-dashboard" },
  { to: "/segments", label: "Segments", icon: Map, testid: "nav-segments" },
  { to: "/rides", label: "Rides", icon: Route, testid: "nav-rides" },
  { to: "/leaderboards", label: "Leaderboards", icon: Trophy, testid: "nav-leaderboards" },
  { to: "/backup", label: "Backup", icon: DatabaseBackup, testid: "nav-backup" },
];

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#050507] text-white relative">
      <div className="fixed inset-0 pointer-events-none topo-bg z-0" aria-hidden />
      <header
        className="sticky top-0 z-30 backdrop-blur-xl bg-black/70 border-b border-white/10"
        data-testid="app-header"
      >
        <div className="mx-auto max-w-[1600px] px-6 md:px-10 py-4 flex items-center gap-8">
          <div className="flex items-center gap-3" data-testid="app-logo">
            <div className="w-8 h-8 bg-[#00E5FF] flex items-center justify-center">
              <Activity className="w-5 h-5 text-black" strokeWidth={2.5} />
            </div>
            <div className="font-display font-black text-xl uppercase tracking-tight leading-none">
              Segment<span className="text-[#00E5FF]">Tracker</span>
              <div className="text-[10px] tracking-[0.3em] text-white/40 mt-0.5">
                PERSONAL · CYCLING · ANALYSIS
              </div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-1 ml-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                data-testid={n.testid}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-[0.15em] border transition-colors duration-150 ${
                    isActive
                      ? "bg-[#00E5FF] text-black border-[#00E5FF]"
                      : "bg-transparent text-white/70 border-transparent hover:text-white hover:border-white/20"
                  }`
                }
              >
                <n.icon className="w-4 h-4" strokeWidth={1.8} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="md:hidden ml-auto flex gap-1 overflow-x-auto" data-testid="mobile-nav">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                data-testid={`m-${n.testid}`}
                className={({ isActive }) =>
                  `flex items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider border ${
                    isActive ? "bg-[#00E5FF] text-black border-[#00E5FF]" : "border-white/10 text-white/70"
                  }`
                }
              >
                <n.icon className="w-3.5 h-3.5" />
              </NavLink>
            ))}
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-[1600px] px-6 md:px-10 py-8">
        <Outlet />
      </main>
      <footer className="relative z-10 mx-auto max-w-[1600px] px-6 md:px-10 py-8 border-t border-white/5 mt-12">
        <div className="flex items-center justify-between text-[10px] tracking-[0.25em] uppercase text-white/40">
          <span>v1.0 · Local Data</span>
          <span>All timings in local timezone</span>
        </div>
      </footer>
    </div>
  );
}
