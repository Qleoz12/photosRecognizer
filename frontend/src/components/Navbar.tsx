import { Link, useLocation } from "react-router-dom";

export default function Navbar() {
  const { pathname } = useLocation();

  const links = [
    { to: "/", label: "People" },
    { to: "/gallery", label: "All Photos" },
    { to: "/search", label: "Search by Face" },
    { to: "/clusters", label: "Manage Clusters" },
  ];

  return (
    <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center gap-6 sticky top-0 z-50">
      <span className="text-lg font-bold text-white mr-4">
        📷 PhotosRecognizer
      </span>
      {links.map(({ to, label }) => (
        <Link
          key={to}
          to={to}
          className={`text-sm font-medium transition-colors ${
            pathname === to
              ? "text-blue-400 border-b-2 border-blue-400 pb-1"
              : "text-gray-400 hover:text-white"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
