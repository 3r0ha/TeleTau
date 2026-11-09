import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { WarningCircle } from "@phosphor-icons/react/ssr";

interface FieldShell {
  label: ReactNode;
  /** Подсказка под полем (связана с полем через aria-describedby). */
  hint?: ReactNode;
  /** Текст ошибки: поле получает aria-invalid, сообщение читается вместе с полем. */
  error?: ReactNode;
  /** Значок слева внутри поля (декоративный). */
  icon?: ReactNode;
}

function useFieldIds(id: string | undefined, hint: unknown, error: unknown) {
  const auto = useId();
  const fieldId = id ?? `f${auto}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return { fieldId, hintId, errorId, describedBy: [errorId, hintId].filter(Boolean).join(" ") || undefined };
}

function FieldMessages({ hint, error, hintId, errorId }: { hint?: ReactNode; error?: ReactNode; hintId?: string; errorId?: string }) {
  return (
    <>
      {error ? (
        <p className="tt-field__error" id={errorId}>
          <WarningCircle weight="fill" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p className="tt-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

export type TextFieldProps = FieldShell & InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> };

/** Поле ввода с подписью, подсказкой и ошибкой. Подпись — настоящий <label>, ошибка — aria-describedby. */
export function TextField({ label, hint, error, icon, id, className, ...rest }: TextFieldProps) {
  const { fieldId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  const input = (
    <input
      {...rest}
      id={fieldId}
      className={["tt-input", className].filter(Boolean).join(" ")}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
  );
  return (
    <div className="tt-field">
      <label className="tt-field__label" htmlFor={fieldId}>
        {label}
      </label>
      {icon ? (
        <div className="tt-input-wrap">
          {icon}
          {input}
        </div>
      ) : (
        input
      )}
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  );
}

export type TextAreaProps = Omit<FieldShell, "icon"> & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({ label, hint, error, id, className, ...rest }: TextAreaProps) {
  const { fieldId, hintId, errorId, describedBy } = useFieldIds(id, hint, error);
  return (
    <div className="tt-field">
      <label className="tt-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        {...rest}
        id={fieldId}
        className={["tt-input", className].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </div>
  );
}
