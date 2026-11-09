import { type DynamicModule, Module } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "./config/config.js";
import { InfraModule } from "./infra/infra.module.js";
import { AdminModule } from "./modules/admin/index.js";
import { AssignmentsModule } from "./modules/assignments/index.js";
import { CompetitionModule } from "./modules/competition/index.js";
import { ConsensusModule } from "./modules/consensus/index.js";
import { ConsentModule } from "./modules/consent/index.js";
import { ContentModule } from "./modules/content/index.js";
import { CorpusModule } from "./modules/corpus/index.js";
import { HealthModule } from "./modules/health/index.js";
import { IdentityModule } from "./modules/identity/index.js";
import { LearningModule } from "./modules/learning/index.js";
import { MinistryModule } from "./modules/ministry/index.js";
import { ModerationModule } from "./modules/moderation/index.js";
import { OrgModule } from "./modules/org/index.js";
import { ProgressModule } from "./modules/progress/index.js";
import { TelegramModule } from "./modules/telegram/index.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
      imports: [
        InfraModule,
        HealthModule,
        IdentityModule,
        OrgModule,
        ConsentModule,
        ModerationModule,
        AdminModule,
        // Граф: learning → content, corpus, consensus, progress; consensus → corpus, progress; progress → competition, org
        ContentModule,
        CorpusModule,
        CompetitionModule,
        ProgressModule,
        ConsensusModule,
        // Задания учителя (ADR 0021): assignments → org, content; learning → assignments
        AssignmentsModule,
        LearningModule,
        // Telegram (ADR 0020): telegram → progress
        TelegramModule,
        // Кабинет министерства (ADR 0023): ministry → org, progress, consensus; словарь для Фонда — в consensus
        MinistryModule,
      ],
    };
  }
}
