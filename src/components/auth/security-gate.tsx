'use client';

// ============================================================
// <SecurityGate> — একক-মালিকের স্টুডিওর প্রবেশদ্বার (P0 নিরাপত্তা)
//
// মাউন্ট হলে GET /api/auth/status দেখে চার-অবস্থার একটিতে যায়:
//   loading → setup (প্রথমবার: পাসকোড সেট) → locked (আনলক ফর্ম) → open
// open হলেই মূল অ্যাপ (ডেটা-ফেচিং কম্পোনেন্টসহ) মাউন্ট পায়।
//
// সাথে দুটি গ্লোবাল সুবিধা:
//  - installStudioFetchWrapper(): window.fetch-প্যাচ — প্রতিটি same-origin
//    /api/ অনুরোধে x-studio-token হেডার; 401 এলে 'studio-auth-required'
//    ইভেন্ট (গেট শুনে locked-এ ফেরে)। ডাবল-ইনস্টল গ্লোবাল ফ্ল্যাগে রুদ্ধ।
//  - withStudioToken(url): EventSource/<img>/<audio> URL-এ ?st=<token>।
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TOKEN_STORAGE_KEY = 'studio-session-token';
const TOKEN_HEADER = 'x-studio-token';
const AUTH_REQUIRED_EVENT = 'studio-auth-required';
const PASSCODE_MIN = 8;

type GateState = 'loading' | 'setup' | 'locked' | 'open';

interface StatusResponse {
  initialized: boolean;
  authenticated: boolean;
}

interface AuthOkResponse {
  ok: boolean;
  token?: string;
  expiresAt?: string;
}

interface AuthErrResponse {
  error?: string;
  retryAfterSec?: number;
}

// ------------------------------------------------------------
// টোকেন-সংগ্রহ + fetch-র‍্যাপার
// ------------------------------------------------------------

function readStudioToken(): string | null {
  try {
    const v = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** same-origin এবং পথ /api/… হলেই হেডার-ইঞ্জেকশন চলে */
function isSameOriginApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    return parsed.pathname === '/api' || parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * গ্লোবাল fetch-র‍্যাপার — একবারই বসে (global flag)।
 *  ① same-origin /api/ কলে localStorage-টোকেন হেডারে যায়
 *  ② উত্তর 401 + URL-এ '/api/' → 'studio-auth-required' ইভেন্ট
 */
export function installStudioFetchWrapper(): void {
  if (typeof window === 'undefined') return;
  const w = window as typeof window & { __studioFetchWrapped?: boolean };
  if (w.__studioFetchWrapped) return;
  w.__studioFetchWrapped = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = readStudioToken();
    const url = requestUrlOf(input);
    let finalInit = init;

    // ① মালিক-টোকেন হেডার (same-origin API-তে, আগে থেকে না থাকলে)
    if (token && isSameOriginApiUrl(url)) {
      const headers = new Headers(init?.headers);
      if (!headers.has(TOKEN_HEADER)) {
        headers.set(TOKEN_HEADER, token);
        finalInit = { ...(init ?? {}), headers };
      }
    }

    const response = await originalFetch(input, finalInit);

    // ② 401 → গেটকে জানাও (বডি না পড়ে শুধু স্ট্যাটাস-যাচাই)
    if (response.status === 401 && url.includes('/api/')) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    return response;
  };
}

/** EventSource/মিডিয়া URL-এ ?st=<token> — টোকেন না থাকলে URL অপরিবর্তিত। */
export function withStudioToken(url: string): string {
  if (typeof window === 'undefined') return url;
  const token = readStudioToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}st=${encodeURIComponent(token)}`;
}

// ক্লায়েন্ট-বান্ডিল লোড হতেই র‍্যাপার বসে যাক — গেট-খোলার আগের প্রথম
// ফেচও (হাইড্রেশন-পরবর্তী) টোকেন-হেডার পায়
if (typeof window !== 'undefined') {
  installStudioFetchWrapper();
}

// ------------------------------------------------------------
// ফর্ম-কার্ডের খোলস
// ------------------------------------------------------------

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function CenteredLoader() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background"
      role="status"
      aria-label="নিরাপত্তা-অবস্থা যাচাই হচ্ছে"
    >
      <Loader2 className="size-7 animate-spin text-emerald-600" aria-hidden="true" />
      <span className="sr-only">নিরাপত্তা-অবস্থা যাচাই হচ্ছে…</span>
    </div>
  );
}

// ------------------------------------------------------------
// মূল গেট
// ------------------------------------------------------------

export function SecurityGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSec, setRetryAfterSec] = useState<number | null>(null);

  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');

  // --- মাউন্টে অবস্থা-যাচাই ---
  useEffect(() => {
    let cancelled = false;
    installStudioFetchWrapper();
    (async () => {
      try {
        const res = await fetch('/api/auth/status', { cache: 'no-store' });
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (data.authenticated) setState('open');
        else setState(data.initialized ? 'locked' : 'setup');
      } catch {
        if (!cancelled) setState('locked');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- অন্য কোথাও 401 এলে → লক ---
  useEffect(() => {
    const onAuthRequired = () => {
      setState((prev) => (prev === 'open' ? 'locked' : prev));
      setError(null);
      setRetryAfterSec(null);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  /** setup/unlock সফল — টোকেন রাখো, র‍্যাপার নিশ্চিত করো, খোলো */
  const openWithToken = useCallback((token: string) => {
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // localStorage ব্লকড হলে কুকি-পথই থাকবে
    }
    installStudioFetchWrapper();
    setPasscode('');
    setConfirmPasscode('');
    setError(null);
    setRetryAfterSec(null);
    setState('open');
  }, []);

  // --- সেটআপ ---
  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setRetryAfterSec(null);

    if (passcode.length < PASSCODE_MIN) {
      setError(`পাসকোড কমপক্ষে ${PASSCODE_MIN} অক্ষরের হতে হবে`);
      return;
    }
    if (passcode !== confirmPasscode) {
      setError('দুটি পাসকোড এক হয়নি — আবার দিন');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json()) as AuthOkResponse & AuthErrResponse;
      if (res.ok && data.ok && data.token) {
        openWithToken(data.token);
        return;
      }
      setError(data.error ?? 'সেটআপ ব্যর্থ হয়েছে — আবার চেষ্টা করুন');
    } catch {
      setError('সার্ভারে পৌঁছানো যায়নি — অ্যাপটি চালু আছে কি না দেখুন');
    } finally {
      setBusy(false);
    }
  };

  // --- আনলক ---
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setRetryAfterSec(null);

    if (passcode.length === 0) {
      setError('পাসকোড দিন');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/auth/unlock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json()) as AuthOkResponse & AuthErrResponse;
      if (res.ok && data.ok && data.token) {
        openWithToken(data.token);
        return;
      }
      if (res.status === 429) {
        setRetryAfterSec(typeof data.retryAfterSec === 'number' ? data.retryAfterSec : null);
      }
      setError(data.error ?? 'আনলক ব্যর্থ হয়েছে');
    } catch {
      setError('সার্ভারে পৌঁছানো যায়নি — অ্যাপটি চালু আছে কি না দেখুন');
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------
  // রেন্ডার
  // ------------------------------------------------------------

  if (state === 'loading') {
    return <CenteredLoader />;
  }

  if (state === 'open') {
    return <>{children}</>;
  }

  if (state === 'setup') {
    return (
      <GateShell>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="space-y-2 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
              <ShieldCheck className="size-6" aria-hidden="true" />
            </span>
            <CardTitle className="text-xl text-emerald-700 dark:text-emerald-400">
              স্টুডিও নিরাপদ করুন
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed text-muted-foreground">
              এটি একটি একক-মালিকের স্টুডিও। প্রথমবার এসে একটি মালিক-পাসকোড সেট
              করুন — এরপর প্রতিটি সংবেদনশীল API (কী, আর্টিফ্যাক্ট, প্রোডাকশন)
              শুধু আপনার সেশনে খুলবে।
            </CardDescription>
            <p className="text-[11px] text-muted-foreground/80">
              Set an owner passcode to secure this single-owner studio.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetup} className="space-y-4" noValidate>
              {error && (
                <Alert variant="destructive">
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="studio-passcode">নতুন পাসকোড (কমপক্ষে ৮ অক্ষর)</Label>
                <Input
                  id="studio-passcode"
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoComplete="new-password"
                  minLength={PASSCODE_MIN}
                  required
                  disabled={busy}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="studio-passcode-confirm">পাসকোড আবার দিন</Label>
                <Input
                  id="studio-passcode-confirm"
                  type="password"
                  value={confirmPasscode}
                  onChange={(e) => setConfirmPasscode(e.target.value)}
                  autoComplete="new-password"
                  minLength={PASSCODE_MIN}
                  required
                  disabled={busy}
                  placeholder="••••••••"
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="h-11 w-full rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                {busy ? 'সেট হচ্ছে…' : 'পাসকোড সেট করে খুলুন'}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                পাসকোড ভুলে গেলে পুনরুদ্ধারের কোনো উপায় নেই — নিরাপদ জায়গায় রাখুন।
              </p>
            </form>
          </CardContent>
        </Card>
      </GateShell>
    );
  }

  // state === 'locked'
  return (
    <GateShell>
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="space-y-2 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <KeyRound className="size-6" aria-hidden="true" />
          </span>
          <CardTitle className="text-xl text-emerald-700 dark:text-emerald-400">
            মালিক-পাসকোড দিন
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed text-muted-foreground">
            স্টুডিও এখন লক করা। আপনার পাসকোড দিলে কী, আর্টিফ্যাক্ট ও
            প্রোডাকশনসহ সব সংবেদনশীল API আবার খুলবে।
          </CardDescription>
          <p className="text-[11px] text-muted-foreground/80">
            Enter the owner passcode to unlock.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUnlock} className="space-y-4" noValidate>
            {(error || retryAfterSec !== null) && (
              <Alert variant="destructive">
                <KeyRound className="size-4" aria-hidden="true" />
                <AlertDescription>
                  {error}
                  {retryAfterSec !== null && !error?.includes('সেকেন্ড') && (
                    <span className="mt-0.5 block text-xs">
                      অনেক বেশি ভুল চেষ্টা — প্রায় {retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন।
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="studio-unlock-passcode">পাসকোড</Label>
              <Input
                id="studio-unlock-passcode"
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                autoComplete="current-password"
                required
                autoFocus
                disabled={busy}
                placeholder="••••••••"
              />
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="size-4" aria-hidden="true" />
              )}
              {busy ? 'খোলা হচ্ছে…' : 'আনলক করুন'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </GateShell>
  );
}
