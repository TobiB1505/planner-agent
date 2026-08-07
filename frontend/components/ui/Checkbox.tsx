import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> {
  className?: string;
  label: ReactNode;
}

/** Checkbox mit eingebautem, korrekt verknüpftem Label - min. 40x40px Touch-Ziel. */
const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className = "", label, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label htmlFor={inputId} className={["ui-checkbox", className].filter(Boolean).join(" ")}>
      <input ref={ref} id={inputId} type="checkbox" className="ui-checkbox-input" {...rest} />
      <span className="ui-checkbox-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      </span>
      <span className="ui-checkbox-label">{label}</span>
    </label>
  );
});

export default Checkbox;
