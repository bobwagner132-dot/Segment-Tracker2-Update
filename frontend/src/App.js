import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Segments from "@/pages/Segments";
import Rides from "@/pages/Rides";
import Leaderboards from "@/pages/Leaderboards";
import Backup from "@/pages/Backup";

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/segments" element={<Segments />} />
            <Route path="/rides" element={<Rides />} />
            <Route path="/leaderboards" element={<Leaderboards />} />
            <Route path="/backup" element={<Backup />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#0A0A0C",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#fff",
            borderRadius: 0,
            fontFamily: "Manrope, sans-serif",
          },
        }}
      />
    </div>
  );
}

export default App;
