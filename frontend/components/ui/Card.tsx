import type { HTMLAttributes, ReactNode } from "react";

export type CardVariant = "default" | "raised" | "interactive" | "glass";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  variant?: CardVariant;
  className?: string;
  children?: ReactNode;
}

/**
 * Zentrale Karten-Primitive. `interactive` macht die Karte per Tastatur/Maus
 * fokussierbar und hover-fähig (Klick-Handler via onClick weiterhin nötig) -
 * verschachtelt aber keine eigene interaktive Semantik, damit z.B. Buttons
 * innerhalb der Karte nicht mit dem Karten-Klickziel kollidieren. `glass`
 * gezielt einsetzen (siehe DESIGN_SYSTEM.md) - nicht für Tabellenzellen,
 * lange Listen oder große Inhaltsflächen.
 */
export function Card({ variant = "default", className = "", children, onClick, onKeyDown, ...rest }: CardProps) {
  const classes = ["ui-card", `ui-card--${variant}`, className].filter(Boolean).join(" ");
  const isInteractiveClick = variant === "interactive" && typeof onClick === "function";

  return (
    <div
      className={classes}
      onClick={onClick}
      role={isInteractiveClick && rest.role === undefined ? "button" : rest.role}
      tabIndex={isInteractiveClick && rest.tabIndex === undefined ? 0 : rest.tabIndex}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (isInteractiveClick && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          (event.currentTarget as HTMLDivElement).click();
        }
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = "", children, ...rest }: CardProps) {
  return (
    <div className={["ui-card-header", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ className = "", children, ...rest }: CardProps) {
  return (
    <h3 className={["ui-card-title", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </h3>
  );
}

export function CardDescription({ className = "", children, ...rest }: CardProps) {
  return (
    <p className={["ui-card-description", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </p>
  );
}

export function CardContent({ className = "", children, ...rest }: CardProps) {
  return (
    <div className={["ui-card-content", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className = "", children, ...rest }: CardProps) {
  return (
    <div className={["ui-card-footer", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export default Card;
