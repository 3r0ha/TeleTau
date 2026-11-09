"use client";

/**
 * Черновик заявки (ФИО, должность, район) — в sessionStorage вкладки: «Назад» и перезагрузка его не теряют,
 * а закрытие вкладки, выход и отправка заявки — стирают. Это данные самого учителя на его устройстве; черновик другого
 * аккаунта (общий компьютер) не показывается и стирается.
 */
const DRAFT_KEY = "tt-teacher-apply-draft";

export interface Draft {
  accountId: string;
  fullName: string;
  position: string;
  districtId: string | null;
}

export function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return { accountId: String(d.accountId ?? ""), fullName: String(d.fullName ?? ""), position: String(d.position ?? ""), districtId: typeof d.districtId === "string" ? d.districtId : null };
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* приватный режим — черновик живёт только на этой странице */
  }
}

export function clearApplyDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ничего */
  }
}
