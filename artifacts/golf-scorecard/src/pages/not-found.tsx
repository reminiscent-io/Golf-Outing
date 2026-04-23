import { useLocation } from "wouter";

export default function NotFound() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-4 font-serif" style={{ color: "hsl(42 52% 59%)" }}>404</div>
        <p className="font-sans mb-6" style={{ color: "hsl(42 25% 60%)" }}>Page not found</p>
        <button
          onClick={() => navigate("/")}
          className="px-6 py-2.5 rounded-xl font-sans font-semibold text-sm"
          style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
        >
          Go Home
        </button>
      </div>
    </div>
  );
}
