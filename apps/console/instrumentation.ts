// Адрес сокета запроса для BFF сессии: HTTP-сервер Next.js кладёт его в служебный заголовок до обработки
// запроса вместе с секретом процесса (@teletau/session/peer), а BFF берёт IP браузера оттуда — только при совпадении
// секрета, — а не из присланного клиентом X-Forwarded-For.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installPeerAddressStamp } = await import("@teletau/session/peer");
    installPeerAddressStamp();
  }
}
