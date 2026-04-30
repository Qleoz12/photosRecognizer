import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import Gallery from "./pages/Gallery";
import PersonDetail from "./pages/PersonDetail";
import AllPhotos from "./pages/AllPhotos";
import Clusters from "./pages/Clusters";
import Search from "./pages/Search";
import Recuerdos from "./pages/Recuerdos";
import RecuerdoDetail from "./pages/RecuerdoDetail";
import Albums from "./pages/Albums";
import AlbumDetail from "./pages/AlbumDetail";
import Videos from "./pages/Videos";
import FileTypes from "./pages/FileTypes";
import Archive from "./pages/Archive";
import ShareCollectionView from "./pages/ShareCollectionView";
import ThemeSearch from "./pages/ThemeSearch";

/** Consola: cambios de ruta; ms = tiempo desde el cambio de ruta anterior (útil con VITE_LOG_UX=1 en prod). */
function RouteTimingLogger() {
  const loc = useLocation();
  const prevNavAt = useRef<number | null>(null);
  useEffect(() => {
    const ux = import.meta.env.VITE_LOG_UX === "1" || import.meta.env.VITE_LOG_UX === "true";
    if (!import.meta.env.DEV && !ux) return;
    const path = `${loc.pathname}${loc.search}`;
    performance.mark(`route:${path}`);
    const now = performance.now();
    const sincePrev =
      prevNavAt.current != null ? Math.round(now - prevNavAt.current) : null;
    prevNavAt.current = now;
    const timePart = sincePrev != null ? ` | ${sincePrev}ms` : " | —";
    console.debug(`[ROUTE] ${path}${timePart}`);
  }, [loc.pathname, loc.search]);
  return null;
}

function AppShell() {
  const loc = useLocation();
  const isPublicShare = loc.pathname.startsWith("/share/");

  return (
    <div className="min-h-screen bg-gray-950">
      {!isPublicShare && <Navbar />}
      <main>
        <Routes>
          <Route path="/" element={<Gallery />} />
          <Route path="/share/:token" element={<ShareCollectionView />} />
          <Route path="/gallery" element={<AllPhotos />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/videos" element={<Videos />} />
          <Route path="/person/:id" element={<PersonDetail />} />
          <Route path="/clusters" element={<Clusters />} />
          <Route path="/search" element={<Search />} />
          <Route path="/theme-search" element={<ThemeSearch />} />
          <Route path="/recuerdos" element={<Recuerdos />} />
          <Route path="/recuerdos/:id" element={<RecuerdoDetail />} />
          <Route path="/albums" element={<Albums />} />
          <Route path="/albums/:id" element={<AlbumDetail />} />
          <Route path="/file-types" element={<FileTypes />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteTimingLogger />
      <AppShell />
    </BrowserRouter>
  );
}
