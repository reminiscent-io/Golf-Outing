import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthSession } from "@/lib/auth";

export default function TripsPage() {
  const [, navigate] = useLocation();
  const session = useAuthSession();

  useEffect(() => {
    navigate(session ? "/me/trips" : "/", { replace: true });
  }, [session, navigate]);

  return null;
}
