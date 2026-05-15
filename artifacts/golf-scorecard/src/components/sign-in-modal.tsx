import { useEffect, useRef, useState } from "react";
import { useRequestOtp, useVerifyOtp } from "@workspace/api-client-react";
import { setSession, type AuthUser } from "@/lib/auth";

type Props = {
  open: boolean;
  onClose?: () => void;
  onSignedIn: (user: AuthUser) => void;
  title?: string;
};

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned;
  // For convenience, US 10-digit numbers get a +1.
  if (/^\d{10}$/.test(cleaned)) return `+1${cleaned}`;
  return `+${cleaned}`;
}

export function SignInModal({ open, onClose, onSignedIn, title }: Props) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [isNewUser, setIsNewUser] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number>(0);
  const [now, setNow] = useState<number>(Date.now());

  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();

  const codeInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state whenever modal closes.
  useEffect(() => {
    if (!open) {
      setStep("phone");
      setPhone("");
      setFullName("");
      setIsNewUser(false);
      setCode("");
      setError(null);
      setResendAt(0);
    }
  }, [open]);

  useEffect(() => {
    if (step !== "code") return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step === "code") {
      codeInputRef.current?.focus();
    }
  }, [step]);

  if (!open) return null;

  const secondsToResend = Math.max(0, Math.ceil((resendAt - now) / 1000));

  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized || !/^\+\d{8,15}$/.test(normalized)) {
      setError("Enter a valid phone number");
      return;
    }
    setError(null);
    requestOtp.mutate(
      { data: { phone: normalized } },
      {
        onSuccess: (resp) => {
          setIsNewUser(!!resp.isNewUser);
          setStep("code");
          setResendAt(Date.now() + 30_000);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to send code";
          setError(msg);
        },
      }
    );
  }

  function handleResend() {
    if (secondsToResend > 0) return;
    const normalized = normalizePhone(phone);
    requestOtp.mutate(
      { data: { phone: normalized } },
      {
        onSuccess: () => setResendAt(Date.now() + 30_000),
        onError: (err: unknown) => setError(err instanceof Error ? err.message : "Failed to resend"),
      }
    );
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizePhone(phone);
    if (code.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    if (isNewUser && !fullName.trim()) {
      setError("Enter your full name");
      return;
    }
    setError(null);
    verifyOtp.mutate(
      { data: { phone: normalized, code, fullName: fullName.trim() || undefined } },
      {
        onSuccess: (resp) => {
          setSession({ token: resp.token, expiresAt: resp.expiresAt, user: resp.user });
          onSignedIn(resp.user);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Wrong code";
          setError(msg);
        },
      }
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={() => onClose?.()}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: "hsl(42 45% 91%)" }}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-serif mb-1" style={{ color: "hsl(38 30% 14%)" }}>
          {title ?? (isNewUser ? "Create your account" : "Sign in")}
        </h2>
        <p className="text-xs font-sans mb-4" style={{ color: "hsl(38 20% 38%)" }}>
          {step === "phone"
            ? "We'll text you a 6-digit code."
            : `Enter the code we sent to ${phone}.`}
        </p>

        {step === "phone" && (
          <form onSubmit={handlePhoneSubmit}>
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Phone number
            </label>
            <input
              autoFocus
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            {error && (
              <div className="text-xs font-sans mb-3" style={{ color: "hsl(0 55% 40%)" }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={requestOtp.isPending}
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm disabled:opacity-60"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {requestOtp.isPending ? "Sending..." : "Send code"}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="w-full mt-2 py-2 rounded-lg font-sans text-xs"
                style={{ color: "hsl(38 20% 38%)" }}
              >
                Cancel
              </button>
            )}
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleCodeSubmit}>
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              6-digit code
            </label>
            <input
              ref={codeInputRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="w-full px-3 py-3 rounded-lg text-lg font-mono text-center tracking-[0.4em] outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            {isNewUser && (
              <>
                <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
                  Full name
                </label>
                <input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  autoComplete="name"
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </>
            )}
            {error && (
              <div className="text-xs font-sans mb-3" style={{ color: "hsl(0 55% 40%)" }}>{error}</div>
            )}
            <button
              type="submit"
              disabled={verifyOtp.isPending || code.length !== 6 || (isNewUser && !fullName.trim())}
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm disabled:opacity-60"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {verifyOtp.isPending ? "Verifying..." : "Verify"}
            </button>
            <div className="flex items-center justify-between mt-3">
              <button
                type="button"
                onClick={() => { setStep("phone"); setCode(""); setError(null); }}
                className="text-xs font-sans underline"
                style={{ color: "hsl(38 20% 38%)" }}
              >
                Use a different number
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={secondsToResend > 0}
                className="text-xs font-sans underline disabled:opacity-50 disabled:no-underline"
                style={{ color: "hsl(38 20% 38%)" }}
              >
                {secondsToResend > 0 ? `Resend in ${secondsToResend}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
