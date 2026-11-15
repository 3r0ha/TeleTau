/** Выключатель (role="switch") для строки настроек: подпись — элемент с id `labelledBy`. */
export function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (next: boolean) => void; labelledBy: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} className="tt-switch" onClick={() => onChange(!checked)}>
      <span className="tt-switch__knob" aria-hidden />
    </button>
  );
}
