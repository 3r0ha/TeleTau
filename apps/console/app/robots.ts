import type { MetadataRoute } from "next";

/** Консоль — рабочий инструмент сотрудников: поисковикам и превью ссылок здесь нечего брать. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
