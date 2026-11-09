package ru.teletau.core.session

import java.security.SecureRandom

/**
 * UUIDv7 клиента (RFC 9562): `runId` урока, `attemptId` ответа. Повтор запроса с тем же идентификатором сервер
 * не засчитывает дважды, а время в старших битах упорядочивает попытки (как `apps/web/.../learn/ids.ts`).
 */
public object Uuid7 {
    private val random = SecureRandom()

    public fun next(nowMillis: Long = System.currentTimeMillis()): String {
        val b = ByteArray(16)
        random.nextBytes(b)
        var ts = nowMillis.coerceAtLeast(0)
        for (i in 5 downTo 0) {
            b[i] = (ts and 0xff).toByte()
            ts = ts ushr 8
        }
        b[6] = ((b[6].toInt() and 0x0f) or 0x70).toByte()
        b[8] = ((b[8].toInt() and 0x3f) or 0x80).toByte()
        val hex = b.joinToString("") { "%02x".format(it) }
        return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
    }
}
