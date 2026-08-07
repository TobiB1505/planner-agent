"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "fullscreen-mobile";

export interface GlassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Verknüpft aria-labelledby - siehe DialogTitle. */
  titleId: string;
  descriptionId?: string;
  size?: DialogSize;
  /** Escape schließt den Dialog. Für Flows, die einen expliziten Klick verlangen, auf false setzen. */
  closeOnEscape?: boolean;
  /** Klick auf den Backdrop schließt den Dialog. */
  closeOnBackdrop?: boolean;
  className?: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Zentrale, zugängliche Dialog-Basis ("Quiet Command"-Glass-Look, gezielt
 * eingesetzt - siehe DESIGN_SYSTEM.md). Rendert über ein Portal, verwaltet
 * Fokus-Trap, initialen Fokus, Fokus-Rückgabe an den Auslöser, Scroll-Lock
 * und Reduced-Motion. ConfirmDialog und weitere Dialoge setzen darauf auf.
 */
export default function GlassDialog({
  open,
  onOpenChange,
  titleId,
  descriptionId,
  size = "md",
  closeOnEscape = true,
  closeOnBackdrop = true,
  className = "",
  children,
}: GlassDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      panel;
    target?.focus({ preventScroll: true });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (!closeOnEscape) return;
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeOnEscape, onOpenChange],
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ui-dialog-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={["ui-dialog", `ui-dialog--${size}`, className].filter(Boolean).join(" ")}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

type SectionProps = Omit<HTMLAttributes<HTMLDivElement>, "className"> & { className?: string; children?: ReactNode };

export function DialogHeader({ className = "", children, ...rest }: SectionProps) {
  return (
    <div className={["ui-dialog-header", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function DialogTitle({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <h2 id={id} className={["ui-dialog-title", className].filter(Boolean).join(" ")}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <p id={id} className={["ui-dialog-description", className].filter(Boolean).join(" ")}>
      {children}
    </p>
  );
}

export function DialogBody({ className = "", children, ...rest }: SectionProps) {
  return (
    <div className={["ui-dialog-body", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function DialogFooter({ className = "", children, ...rest }: SectionProps) {
  return (
    <div className={["ui-dialog-footer", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
