import { Module } from "@nestjs/common";
import { ContentService } from "./content.service.js";

/**
 * Модуль content: курс, юниты (места), узлы тропы, упражнения с ключами ответов, версии контента.
 * Таблицы — в content.schema.ts (ADR 0014). Лист графа модулей: ни от кого не зависит; HTTP-операций нет —
 * тропу и уроки отдаёт learning через ContentService.
 */
@Module({ providers: [ContentService], exports: [ContentService] })
export class ContentModule {}
