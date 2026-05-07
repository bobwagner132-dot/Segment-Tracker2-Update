import { createContext, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export const MAP_STYLES = {
  auto: { label: "Auto (match theme)" },
  dark: { label: "Dark (CartoDB)" },
  light: { label: "Light (CartoDB)" },
  standard: { label: "OpenStreetMap" },
  terrain: { label: "Terrain (OpenTopo)" },
};

const ThemeContext = createContext({
  theme: "dark",
  toggle: () => {},
  setTheme: () => {},
  mapStyle: "auto",
  setMapStyle: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("cst-theme") || "light";
    } catch {
      return "light";
    }
  });
  const [mapStyle, setMapStyle] = useState(() => {
    try {
      return localStorage.getItem("cst-map-style") || "standard";
    } catch {
      return "standard";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("cst-theme", theme);
    } catch {
      /* empty */
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("cst-map-style", mapStyle);
    } catch {
      /* empty */
    }
  }, [mapStyle]);

  const value = {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    setTheme,
    mapStyle,
    setMapStyle,
  };
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label="Toggle theme"
      className="flex items-center gap-2 px-3 py-2 border border-line hover:border-accent transition-colors text-xs uppercase tracking-[0.2em] text-secondary hover:text-accent"
    >
      {isDark ? <Sun className="w-4 h-4" strokeWidth={1.8} /> : <Moon className="w-4 h-4" strokeWidth={1.8} />}
      <span className="hidden sm:inline">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
