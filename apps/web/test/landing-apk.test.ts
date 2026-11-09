import { describe, expect, it } from "vitest";
import { androidApkUrl } from "../app/_components/landing/apk";

describe("androidApkUrl (ANDROID_APK_URL → кнопка «Скачать для Android»)", () => {
  it("пусто или не задано — кнопки нет", () => {
    expect(androidApkUrl(undefined)).toBeNull();
    expect(androidApkUrl("")).toBeNull();
    expect(androidApkUrl("   ")).toBeNull();
  });

  it("http и https — ссылка как есть", () => {
    expect(androidApkUrl("http://192.168.1.232:8080/teletau.apk")).toBe("http://192.168.1.232:8080/teletau.apk");
    expect(androidApkUrl(" https://apk.example/teletau.apk ")).toBe("https://apk.example/teletau.apk");
  });

  it("не адрес или другой протокол — кнопки нет", () => {
    expect(androidApkUrl("teletau.apk")).toBeNull();
    expect(androidApkUrl("javascript:alert(1)")).toBeNull();
    expect(androidApkUrl("ftp://apk.example/teletau.apk")).toBeNull();
  });
});
