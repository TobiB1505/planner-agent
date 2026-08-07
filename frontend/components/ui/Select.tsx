import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & { className?: string };

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className = "", children, ...rest }, ref) {
  return (
    <select ref={ref} className={["ui-select", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </select>
  );
});

export default Select;
