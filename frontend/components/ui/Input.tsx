import { forwardRef, type InputHTMLAttributes } from "react";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & { className?: string };

const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className = "", ...rest }, ref) {
  return <input ref={ref} className={["ui-input", className].filter(Boolean).join(" ")} {...rest} />;
});

export default Input;
