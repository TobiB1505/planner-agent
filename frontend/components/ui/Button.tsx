"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  children?: ReactNode;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children" | "href"> & {
    /** Rendert den Button als Next.js <Link>. Externe Ziele: normales <a> über AnchorHTMLAttributes. */
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const OWN_PROP_KEYS = ["variant", "size", "loading", "className", "children", "href"] as const;

function omitOwnProps<T extends Record<string, unknown>>(props: T): Omit<T, (typeof OWN_PROP_KEYS)[number]> {
  const rest = { ...props } as Record<string, unknown>;
  for (const key of OWN_PROP_KEYS) delete rest[key];
  return rest as Omit<T, (typeof OWN_PROP_KEYS)[number]>;
}

/**
 * Zentrale Button-Primitive ("Quiet Command"-Designsystem). Deckt Button und
 * Link-Button über eine gemeinsame, typisierte API ab - kein `as any`.
 * Icon-only-Buttons (size="icon") verlangen ein aria-label; ein fehlendes
 * Label wird zur Entwicklungszeit in der Konsole gemeldet statt still zu
 * einem unbeschrifteten Button zu werden.
 */
export default function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", loading = false, className = "", children } = props;

  const classes = [
    "ui-btn",
    `ui-btn--${variant}`,
    `ui-btn--${size}`,
    loading ? "ui-btn--loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (size === "icon" && process.env.NODE_ENV !== "production") {
    const hasLabel = Boolean(props["aria-label"] || props["aria-labelledby"]);
    if (!hasLabel) {
      console.error('Button: size="icon" benötigt aria-label oder aria-labelledby für Screenreader.');
    }
  }

  const content = (
    <>
      {loading && (
        <span className="ui-btn-spinner" aria-hidden="true" />
      )}
      <span className={loading ? "ui-btn-label ui-btn-label--loading" : "ui-btn-label"}>{children}</span>
      {loading && <span className="ui-sr-only">Wird ausgeführt…</span>}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    const anchorRest = omitOwnProps(props);
    return (
      <Link href={props.href} className={classes} aria-disabled={loading || undefined} {...anchorRest}>
        {content}
      </Link>
    );
  }

  const buttonProps = props as ButtonAsButton;
  const { type: _omittedType, ...buttonRest } = omitOwnProps(buttonProps);
  void _omittedType;

  return (
    <button
      type={buttonProps.type ?? "button"}
      className={classes}
      disabled={loading || buttonProps.disabled}
      aria-busy={loading || undefined}
      {...buttonRest}
    >
      {content}
    </button>
  );
}
