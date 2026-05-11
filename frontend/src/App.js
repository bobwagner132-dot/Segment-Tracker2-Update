import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Segments from "@/pages/Segments";
import Rides from "@/pages/Rides";
import Leaderboards from "@/pages/Leaderboards";
import Backup from "@/pages/Backup";
import Preferences from "@/pages/Preferences";
import Equipment from "@/pages/Equipment";
import { ThemeProvider, useTheme } from "@/lib/theme";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      position="top-right"
      theme={theme}
      toastOptions={{
        style: {
          borderRadius: 0,
          fontFamily: "Manrope, sans-serif",
        },
      }}
    />
  );
}

function App() {
  return (
    <div className="App">
      <ThemeProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/segments" element={<Segments />} />
              <Route path="/rides" element={<Rides />} />
              <Route path="/leaderboards" element={<Leaderboards />} />
              <Route path="/equipment" element={<Equipment />} />
              <Route path="/backup" element={<Backup />} />
              <Route path="/preferences" element={<Preferences />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <ThemedToaster />
      </ThemeProvider>
    </div>
  );
}

export default App;
