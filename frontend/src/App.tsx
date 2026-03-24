import { BrowserRouter, Routes, Route } from "react-router-dom";
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950">
        <Navbar />
        <main>
          <Routes>
            <Route path="/" element={<Gallery />} />
            <Route path="/gallery" element={<AllPhotos />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/person/:id" element={<PersonDetail />} />
            <Route path="/clusters" element={<Clusters />} />
            <Route path="/search" element={<Search />} />
            <Route path="/recuerdos" element={<Recuerdos />} />
            <Route path="/recuerdos/:id" element={<RecuerdoDetail />} />
            <Route path="/albums" element={<Albums />} />
            <Route path="/albums/:id" element={<AlbumDetail />} />
            <Route path="/file-types" element={<FileTypes />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
