package ru.teletau.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import ru.teletau.core.session.StoredSession
import ru.teletau.core.session.TokenStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Сессия на устройстве (docs/06 §8, «Общее для мобильных»): refresh-токен и аккаунт шифруются AES-256-GCM ключом
 * Android Keystore (ключ не покидает аппаратное хранилище) и лежат в приватных SharedPreferences приложения.
 * Резервные копии выключены (allowBackup=false, data_extraction_rules). Не расшифровалось (ключ сброшен) — входа нет.
 */
class KeystoreTokenStore(context: Context) : TokenStore {
    private val prefs = context.getSharedPreferences("teletau.session", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    @Synchronized
    override fun load(): StoredSession? {
        val blob = prefs.getString(FIELD, null) ?: return null
        return try {
            val bytes = Base64.decode(blob, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV))
            val json = Json.parseToJsonElement(String(cipher.doFinal(bytes, IV, bytes.size - IV), Charsets.UTF_8)).jsonObject
            StoredSession(
                refreshToken = json.getValue("r").jsonPrimitive.content,
                refreshTokenExpiresAt = json.getValue("e").jsonPrimitive.content,
                accountJson = json["a"]?.jsonPrimitive?.content,
            )
        } catch (_: Exception) {
            clear()
            null
        }
    }

    @Synchronized
    override fun save(session: StoredSession) {
        val plain = buildJsonObject {
            put("r", session.refreshToken)
            put("e", session.refreshTokenExpiresAt)
            session.accountJson?.let { put("a", it) }
        }.toString().toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val out = cipher.iv + cipher.doFinal(plain)
        // commit: одноразовый refresh-токен нельзя потерять при закрытии процесса сразу после ротации.
        prefs.edit().putString(FIELD, Base64.encodeToString(out, Base64.NO_WRAP)).commit()
    }

    @Synchronized
    override fun clear() {
        prefs.edit().remove(FIELD).commit()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "teletau.session.v1"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val FIELD = "session.v1"
        const val IV = 12
    }
}
