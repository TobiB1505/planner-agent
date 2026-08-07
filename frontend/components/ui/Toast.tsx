"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Mount-Gate für den Portal: SSR hat kein document, der erste Client-Render
// muss deshalb ebenfalls "nicht gemountet" liefern, sonst weicht er vom
// SSR-Markup ab (Hydration-Fehler). useSyncExternalStore statt setState im
// Effekt (siehe pwa-install-button.tsx für das gleiche Muster im Projekt).
function subscribeNever() {
  return () => {};
}
function getIsMountedSnapshot() {
  return true;
}
function getIsMountedServerSnapshot() {
  return false;
}
function useIsMounted() {
  return useSyncExternalStore(subscribeNever, getIsMountedSnapshot, getIsMountedServerSnapshot);
}

export type ToastVariant = "success" | "info" | "warning" | "error" | "loading";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms bis Auto-Dismiss. error bleibt standardmäßig länger sichtbar. 0 = kein Auto-Dismiss. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "variant">> {
  id: string;
  description?: string;
  /** ms, die beim (Wieder-)Start der aktuellen Zähl-Phase noch übrig sind. */
  remaining: number;
  /** true während der Maus über dem Toast steht (Auto-Dismiss pausiert). */
  paused: boolean;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION: Record<ToastVariant, number> = {
  success: 3200,
  info: 3200,
  warning: 4200,
  error: 6000,
  loading: 0,
};

const MAX_VISIBLE_TOASTS = 4;
const DEDUPE_WINDOW_MS = 2500;

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `toast-${idCounter}`;
}

/**
 * Zentraler Toast-Provider. Ein einziger Provider für die gesamte App (siehe
 * app/layout.tsx) - keine parallelen Feedback-Systeme mehr für nicht-
 * blockierende globale Meldungen (siehe DESIGN_SYSTEM.md, Feedbackstrategie).
 * Dedupliziert identische Meldungen innerhalb eines kurzen Zeitfensters,
 * begrenzt die sichtbare Anzahl und pausiert Auto-Dismiss bei Hover.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const segmentStartRef = useRef<Map<string, number>>(new Map());
  const lastMessageRef = useRef<Map<string, number>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      clearTimer(id);
      segmentStartRef.current.delete(id);
    },
    [clearTimer],
  );

  const scheduleDismiss = useCallback(
    (id: string, delay: number) => {
      clearTimer(id);
      if (delay <= 0) return;
      segmentStartRef.current.set(id, Date.now());
      timersRef.current.set(
        id,
        setTimeout(() => dismiss(id), delay),
      );
    },
    [clearTimer, dismiss],
  );

  const toast = useCallback(
    (options: ToastOptions) => {
      const variant = options.variant ?? "info";
      const duration = options.duration ?? DEFAULT_DURATION[variant];
      const dedupeKey = `${variant}:${options.title}:${options.description ?? ""}`;
      const now = Date.now();
      const lastShown = lastMessageRef.current.get(dedupeKey);
      if (lastShown && now - lastShown < DEDUPE_WINDOW_MS) {
        return "";
      }
      lastMessageRef.current.set(dedupeKey, now);

      const id = nextId();
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        variant,
        remaining: duration,
        paused: false,
      };

      setToasts((current) => {
        const next = [...current, item];
        if (next.length <= MAX_VISIBLE_TOASTS) return next;
        const overflow = next.length - MAX_VISIBLE_TOASTS;
        for (let i = 0; i < overflow; i += 1) {
          clearTimer(next[i].id);
          segmentStartRef.current.delete(next[i].id);
        }
        return next.slice(overflow);
      });

      scheduleDismiss(id, duration);
      return id;
    },
    [clearTimer, scheduleDismiss],
  );

  const pause = useCallback(
    (id: string) => {
      const startedAt = segmentStartRef.current.get(id);
      if (startedAt === undefined) return;
      clearTimer(id);
      setToasts((current) =>
        current.map((t) =>
          t.id === id ? { ...t, paused: true, remaining: Math.max(t.remaining - (Date.now() - startedAt), 0) } : t,
        ),
      );
    },
    [clearTimer],
  );

  const resume = useCallback(
    (id: string) => {
      setToasts((current) => {
        const item = current.find((t) => t.id === id);
        if (!item || !item.paused) return current;
        scheduleDismiss(id, item.remaining);
        return current.map((t) => (t.id === id ? { ...t, paused: false } : t));
      });
    },
    [scheduleDismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast() muss innerhalb von <ToastProvider> aufgerufen werden.");
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const mounted = useIsMounted();
  if (!mounted) return null;

  return createPortal(
    <div className="ui-toast-viewport" aria-live="polite" aria-relevant="additions">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`ui-toast ui-toast--${item.variant}`}
          role={item.variant === "error" ? "alert" : "status"}
          onMouseEnter={() => onPause(item.id)}
          onMouseLeave={() => onResume(item.id)}
        >
          <span className="ui-toast-icon" aria-hidden="true">
            {item.variant === "loading" ? (
              <span className="ui-toast-spinner" />
            ) : (
              <ToastGlyph variant={item.variant} />
            )}
          </span>
          <div className="ui-toast-body">
            <p className="ui-toast-title">{item.title}</p>
            {item.description && <p className="ui-toast-description">{item.description}</p>}
          </div>
          <button
            type="button"
            className="ui-toast-close"
            aria-label="Meldung schließen"
            onClick={() => onDismiss(item.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

function ToastGlyph({ variant }: { variant: ToastVariant }) {
  if (variant === "success") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    );
  }
  if (variant === "error") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
    );
  }
  if (variant === "warning") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 4 21 19H3z" />
        <path d="M12 10v4M12 16.5h.01" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
