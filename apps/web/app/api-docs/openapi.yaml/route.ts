import { contractFileResponse } from "../contract-file";

// Контракт читается при сборке: файл отдаётся тот, с которым собран сайт.
export const dynamic = "force-static";

export function GET(): Promise<Response> {
  return contractFileResponse("yaml");
}
