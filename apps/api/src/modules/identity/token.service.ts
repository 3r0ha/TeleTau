// Access-токен (ADR 0015 §1): JWT ES256 на 15 минут, `kid` в заголовке; ПДн в токене нет.
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { calculateJwkThumbprint, errors, exportJWK, jwtVerify, SignJWT } from "jose";
import { ALL_ROLES, type AccountKind, type Principal, type Role } from "../../common/auth.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const ISSUER = "teletau-api";
const AUDIENCE = "teletau";
const KINDS: readonly AccountKind[] = ["child", "adult", "staff"];
const ROLES: readonly Role[] = ALL_ROLES;

export class AccessTokenError extends Error {
  constructor(readonly expired: boolean) {
    super(expired ? "access token expired" : "access token invalid");
  }
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private kid?: Promise<string>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.AUTH_JWT_PRIVATE_KEY) {
      this.privateKey = createPrivateKey(config.AUTH_JWT_PRIVATE_KEY.replace(/\\n/g, "\n"));
      if (this.privateKey.asymmetricKeyType !== "ec" || this.privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
        throw new Error("AUTH_JWT_PRIVATE_KEY: нужен ключ EC P-256 (ES256) в PKCS#8 PEM");
      }
    } else {
      // Только dev/test (в production loadConfig требует ключ): после перезапуска старые access-токены недействительны,
      // клиент получает новый через POST /auth/refresh — refresh-токены живут в базе.
      this.privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
      this.logger.warn("AUTH_JWT_PRIVATE_KEY не задан — временный ключ подписи (только для разработки)");
    }
    this.publicKey = createPublicKey(this.privateKey);
  }

  private keyId(): Promise<string> {
    this.kid ??= exportJWK(this.publicKey).then((jwk) => calculateJwkThumbprint(jwk));
    return this.kid;
  }

  async sign(p: Principal, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
    const token = await new SignJWT({ kind: p.kind, roles: p.roles, sid: p.sessionId, did: p.deviceId })
      .setProtectedHeader({ alg: "ES256", kid: await this.keyId(), typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(p.accountId)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.privateKey);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["ES256"] });
      const kind = payload["kind"] as AccountKind;
      const roles = payload["roles"];
      const sid = payload["sid"];
      const did = payload["did"];
      if (
        typeof payload.sub !== "string" ||
        !KINDS.includes(kind) ||
        !Array.isArray(roles) ||
        !roles.every((r) => ROLES.includes(r as Role)) ||
        typeof sid !== "string" ||
        typeof did !== "string"
      ) {
        throw new AccessTokenError(false);
      }
      return { accountId: payload.sub, kind, roles: roles as Role[], sessionId: sid, deviceId: did };
    } catch (e) {
      if (e instanceof AccessTokenError) throw e;
      throw new AccessTokenError(e instanceof errors.JWTExpired);
    }
  }
}
