// Задания печати карточек (ADR 0016 §4): секреты карточек есть только здесь — в Valkey, зашифрованными
// AES-256-GCM на 30 минут. В Postgres — только хеши; в JSON-ответах секретов нет никогда.
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { decrypt, encrypt } from "../../common/crypto.js";
import { unavailable } from "../../common/problem.js";
import { uuidv7 } from "../../common/uuidv7.js";
import { APP_CONFIG, type AppConfig } from "../../config/config.js";
import { encryptionKey } from "../../config/secrets.js";
import { VALKEY } from "../../infra/tokens.js";

export const PRINT_JOB_TTL_SECONDS = 30 * 60;

export interface PrintJobCard {
  seatNumber: number;
  /** Каноническая полезная нагрузка TT1.… */
  payload: string;
}

export interface PrintJob {
  classId: string;
  teacherId: string;
  cards: PrintJobCard[];
}

@Injectable()
export class PrintJobStore {
  private readonly key: Buffer;

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.key = encryptionKey(config);
  }

  async save(job: PrintJob): Promise<{ id: string; expiresAt: Date }> {
    const id = uuidv7();
    const sealed = encrypt(this.key, JSON.stringify(job), `print-job:${id}`);
    try {
      await this.valkey.set(`print-job:${id}`, sealed, "EX", PRINT_JOB_TTL_SECONDS);
    } catch {
      throw unavailable();
    }
    return { id, expiresAt: new Date(Date.now() + PRINT_JOB_TTL_SECONDS * 1000) };
  }

  /** Задание или undefined, если срок истёк (или ключ шифрования сменился). */
  async load(id: string): Promise<PrintJob | undefined> {
    let sealed: string | null;
    try {
      sealed = await this.valkey.get(`print-job:${id}`);
    } catch {
      throw unavailable();
    }
    if (!sealed) return undefined;
    try {
      return JSON.parse(decrypt(this.key, sealed, `print-job:${id}`)) as PrintJob;
    } catch {
      return undefined;
    }
  }
}
