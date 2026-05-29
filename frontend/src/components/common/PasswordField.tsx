import { useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { Eye, EyeOff } from "lucide-react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface PasswordFieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly leadingIcon?: IconComponent;
  readonly labelClassName?: string;
  readonly inputClassName?: string;
}

const DEFAULT_LABEL_CLS =
  "block text-sm font-medium text-text-main mb-1 transition-colors duration-1000";

const DEFAULT_INPUT_CLS =
  "block w-full py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-brand focus:border-brand bg-background text-text-main sm:text-sm transition-colors duration-200 outline-none";

export function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder = "••••••••",
  autoComplete = "current-password",
  required = false,
  minLength,
  leadingIcon: LeadingIcon,
  labelClassName = DEFAULT_LABEL_CLS,
  inputClassName = DEFAULT_INPUT_CLS,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  const paddingClasses = LeadingIcon ? "pl-10 pr-10" : "px-3 pr-10";

  return (
    <div>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <div className="relative">
        {LeadingIcon && (
          <div
            className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"
            aria-hidden="true"
          >
            <LeadingIcon className="h-5 w-5 text-text-muted transition-colors duration-1000" />
          </div>
        )}
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputClassName} ${paddingClasses}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted hover:text-text-main focus:outline-none focus:text-text-main transition-colors"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          tabIndex={-1}
        >
          {visible ? (
            <EyeOff className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Eye className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
