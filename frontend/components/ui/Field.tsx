import { useId, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { cloneElement, isValidElement } from "react";

export interface FieldProps {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** Genau ein Input/Select/Checkbox-Element - erhält id/aria-* injiziert. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }>;
}

/**
 * Verbindet Label, Beschreibung und Fehlertext technisch korrekt mit dem
 * enthaltenen Formularelement (htmlFor/id, aria-describedby, aria-invalid).
 * Erwartet genau ein Kind (Input/Select/Checkbox/Textarea).
 */
export default function Field({ label, description, error, required, className = "", children }: FieldProps) {
  const inputId = useId();
  const descriptionId = useId();
  const errorId = useId();

  const describedBy = [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const child = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? inputId,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error),
        required,
      })
    : children;

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label htmlFor={children.props.id ?? inputId} className="ui-field-label">
        {label}
        {required && (
          <span className="ui-field-required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {child}
      {description && (
        <p id={descriptionId} className="ui-field-description">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="ui-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function FieldLabel({ className = "", children, ...rest }: { className?: string; children?: ReactNode } & HTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={["ui-field-label", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </label>
  );
}

export function FieldDescription({ className = "", children, ...rest }: { className?: string; children?: ReactNode } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={["ui-field-description", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </p>
  );
}

export function FieldError({ className = "", children, ...rest }: { className?: string; children?: ReactNode } & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={["ui-field-error", className].filter(Boolean).join(" ")} role="alert" {...rest}>
      {children}
    </p>
  );
}
