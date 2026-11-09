import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { Schema } from "@teletau/contracts";
import { CurrentPrincipal, type Principal } from "../../common/auth.js";
import { Operation } from "../../common/contract.js";
import { LearningService } from "./learning.service.js";

@Controller()
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get("course")
  @Operation("getCourse")
  course(@CurrentPrincipal() principal: Principal): Promise<Schema<"Course">> {
    return this.learning.course(principal);
  }

  @Post("lessons/:lessonId/runs")
  @HttpCode(201)
  @Operation("startLessonRun")
  start(
    @CurrentPrincipal() principal: Principal,
    @Param("lessonId") lessonId: string,
    @Body() body: Schema<"StartLessonRunRequest">,
  ): Promise<Schema<"LessonRun">> {
    return this.learning.startRun(principal, lessonId, body);
  }

  @Post("lesson-runs/:runId/attempts")
  @HttpCode(200)
  @Operation("submitLessonAttempt")
  attempt(@CurrentPrincipal() principal: Principal, @Param("runId") runId: string, @Body() body: Schema<"AttemptRequest">): Promise<Schema<"AttemptResult">> {
    return this.learning.submitAttempt(principal, runId, body);
  }

  @Post("reviews/runs")
  @HttpCode(201)
  @Operation("startReviewRun")
  startReview(@CurrentPrincipal() principal: Principal, @Body() body: Schema<"StartLessonRunRequest">): Promise<Schema<"LessonRun">> {
    return this.learning.startReview(principal, body);
  }

  @Post("units/:unitId/jump-runs")
  @HttpCode(201)
  @Operation("startJumpRun")
  startJump(@CurrentPrincipal() principal: Principal, @Param("unitId") unitId: string, @Body() body: Schema<"StartLessonRunRequest">): Promise<Schema<"LessonRun">> {
    return this.learning.startJump(principal, unitId, body);
  }

  @Get("lessons/:lessonId/preview")
  @Operation("getLessonPreview")
  preview(@Param("lessonId") lessonId: string): Promise<Schema<"LessonPreview">> {
    return this.learning.preview(lessonId);
  }

  @Get("me/achievements")
  @Operation("listMyAchievements")
  achievements(@CurrentPrincipal() principal: Principal): Promise<Schema<"MyAchievements">> {
    return this.learning.achievements(principal);
  }

  @Get("me/words")
  @Operation("listMyWords")
  words(@CurrentPrincipal() principal: Principal): Promise<Schema<"MyWords">> {
    return this.learning.words(principal);
  }

  @Post("lesson-runs/:runId/complete")
  @HttpCode(200)
  @Operation("completeLessonRun")
  complete(@CurrentPrincipal() principal: Principal, @Param("runId") runId: string): Promise<Schema<"LessonRunSummary">> {
    return this.learning.complete(principal, runId);
  }
}
