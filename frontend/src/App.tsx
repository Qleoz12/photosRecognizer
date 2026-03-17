import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Gallery from "./pages/Gallery";
import PersonDetail from "./pages/PersonDetail";
import AllPhotos from "./pages/AllPhotos";
import Clusters from "./pages/Clusters";
import Search from "./pages/Search";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Gallery />} />
            <Route path="/gallery" element={<AllPhotos />} />
            <Route path="/person/:id" element={<PersonDetail />} />
            <Route path="/clusters" element={<Clusters />} />
            <Route path="/search" element={<Search />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
