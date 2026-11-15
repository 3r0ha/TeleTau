/** Похоже на адрес почты: что-то@домен.зона без пробелов. Точную проверку делает сервер (422 /email). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
