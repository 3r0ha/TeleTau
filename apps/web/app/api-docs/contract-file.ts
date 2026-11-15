// Файлы контракта из пакета @teletau/contracts для скачивания со страницы документации. Веб запускается из apps/web
// (next dev, next build, next start), пакет подключён как зависимость workspace: apps/web/node_modules/@teletau/contracts.
// Пути — целиком строками: сборка видит, какой именно файл читается.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const FILES = {
  yaml: { path: () => join(process.cwd(), "node_modules/@teletau/contracts/openapi.yaml"), type: "application/yaml; charset=utf-8" },
  json: { path: () => join(process.cwd(), "node_modules/@teletau/contracts/src/generated/openapi.json"), type: "application/json; charset=utf-8" },
};

/** Ответ с файлом контракта; открыт для чтения с любого сайта (редакторы OpenAPI грузят спецификацию по адресу). */
export async function contractFileResponse(kind: keyof typeof FILES): Promise<Response> {
  const file = FILES[kind];
  return new Response(await readFile(file.path(), "utf8"), {
    headers: {
      "content-type": file.type,
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
    },
  });
}
