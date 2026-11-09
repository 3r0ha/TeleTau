"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, MagnifyingGlass } from "@phosphor-icons/react/ssr";
import type { Schema } from "@teletau/contracts";
import { Button, Card, Chip, ChoiceGroup, Form, InlineAlert, LinkButton, ProgressBar, Skeleton, SkeletonGroup, StepHeading, TextField, useInvalidFocus } from "@teletau/ui";
import { api, unwrap } from "@teletau/session/api";
import { ApiProblem, describeProblem, fieldErrors } from "@teletau/session/problem";
import { useCursorList, useResource } from "@teletau/session/react";
import { BackButton, LoadError, LoadingBlock, Screen, SignOutAction, SimpleTop, useDocumentTitle } from "../../_components/screens";
import { useFlowSteps } from "../../_components/steps";
import { clearApplyDraft, loadDraft, saveDraft, type Draft } from "../applyDraft";
import { OnboardLayout } from "../Journey";
import { useTeacherGate } from "../useTeacher";

type School = Schema<"School">;
type Step = "1" | "2" | "3";

const KIND_LABEL: Record<Schema<"DistrictKind">, string> = {
  municipal_district: "муниципальный район",
  urban_okrug: "городской округ",
};

const TITLES: Record<Step, string> = { "1": "Расскажите о себе", "2": "Выберите район", "3": "Выберите школу" };

const fold = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е");

const profileValid = (d: Pick<Draft, "fullName" | "position">) => d.fullName.trim().length >= 3 && d.position.trim().length >= 2;

/**
 * Заявка на подтверждение учителя: ФИО и должность → район → школа из справочника РБ.
 * Шаг — в адресе (`?step=2`): системная «Назад» возвращает на предыдущий шаг, введённое сохраняется.
 */
export default function ApplyPage() {
  const { me, resource } = useTeacherGate("apply");
  const router = useRouter();
  const params = useSearchParams();
  const flow = useFlowSteps<Step>("1");
  const raw = params.get("step");
  const step: Step = raw === "2" || raw === "3" ? raw : "1";
  const [fullName, setFullName] = useState("");
  const [position, setPosition] = useState("");
  const [errors, setErrors] = useState<{ fullName?: string; position?: string }>({});
  const [districtId, setDistrictId] = useState<string | null>(null);
  const [districtQuery, setDistrictQuery] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolId, setSchoolId] = useState<string | null>(null);
  // «Показать ещё»: один запрос за раз, без дублей, без страниц прежнего поиска.
  const schoolList = useCursorList<School>();
  const schools = schoolList.items ?? [];
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const invalid = useInvalidFocus();

  useDocumentTitle(TITLES[step]);

  // Черновик этого аккаунта — один раз, когда аккаунт известен; без черновика ФИО берётся из профиля.
  const accountId = me?.id;
  const profileName = me?.profile?.fullName;
  useEffect(() => {
    if (!accountId || restored) return;
    const d = loadDraft();
    if (d && d.accountId === accountId) {
      setFullName(d.fullName);
      setPosition(d.position);
      setDistrictId(d.districtId);
    } else {
      if (d) clearApplyDraft();
      if (profileName) setFullName(profileName);
    }
    setRestored(true);
  }, [accountId, profileName, restored]);

  useEffect(() => {
    if (restored && accountId) saveDraft({ accountId, fullName, position, districtId });
  }, [restored, accountId, fullName, position, districtId]);

  // Шаг из адреса недоступен (нет ФИО или района) — на первый недостающий.
  useEffect(() => {
    if (!restored) return;
    if (step !== "1" && !profileValid({ fullName, position })) flow.replace("1");
    else if (step === "3" && !districtId) flow.replace("2");
  }, [restored, step, fullName, position, districtId, flow]);

  const districts = useResource(() => unwrap(api.GET("/api/v1/districts")), [], { enabled: Boolean(me) });
  const deferredSchoolQuery = useDeferredValue(schoolQuery.trim());
  const schoolPage = useResource(
    () =>
      unwrap(
        api.GET("/api/v1/schools", {
          params: { query: { district: districtId!, ...(deferredSchoolQuery.length >= 2 ? { q: deferredSchoolQuery } : {}), limit: 30 } },
        }),
      ),
    [districtId, deferredSchoolQuery],
    { enabled: step === "3" && Boolean(districtId) },
  );

  const { reset: resetSchools } = schoolList;
  useEffect(() => {
    if (schoolPage.data) resetSchools(schoolPage.data);
  }, [schoolPage.data, resetSchools]);

  const filteredDistricts = useMemo(() => {
    const q = fold(districtQuery.trim());
    const list = districts.data?.items ?? [];
    return (q ? list.filter((d) => fold(d.nameRu).includes(q)) : list).slice().sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
  }, [districts.data, districtQuery]);

  const district = districts.data?.items.find((d) => d.id === districtId);

  const goStep2 = () => {
    const e: typeof errors = {};
    if (fullName.trim().length < 3) e.fullName = "Укажите фамилию, имя и отчество.";
    if (position.trim().length < 2) e.position = "Укажите должность.";
    setErrors(e);
    if (!e.fullName && !e.position) flow.go("2");
    else invalid.request();
  };

  const loadMore = async () => {
    if (!districtId) return;
    try {
      await schoolList.loadMore((cursor) =>
        unwrap(api.GET("/api/v1/schools", { params: { query: { district: districtId, cursor, limit: 30, ...(deferredSchoolQuery.length >= 2 ? { q: deferredSchoolQuery } : {}) } } })),
      );
    } catch (e) {
      setSubmitError(describeProblem(e));
    }
  };

  const submit = async () => {
    if (!schoolId) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await unwrap(api.POST("/api/v1/teacher/verification", { body: { schoolId, fullName: fullName.trim(), position: position.trim() } }));
      clearApplyDraft();
      router.replace("/teacher/pending");
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiProblem && e.code === "consent_required") router.replace("/teacher/terms");
      else if (e instanceof ApiProblem && (e.code === "verification_pending" || e.code === "already_verified")) router.replace(e.code === "already_verified" ? "/teacher" : "/teacher/pending");
      else {
        // ФИО или должность отклонил сервер (validation_failed) — на шаг 1, ошибка у поля и фокус на нём.
        const { fullName: nameError, position: positionError } = fieldErrors(e);
        if (nameError || positionError) {
          setErrors({ fullName: nameError, position: positionError });
          invalid.request();
          flow.go("1");
        } else setSubmitError(describeProblem(e));
      }
    }
  };

  const stepNo = Number(step);
  const prev: Step | null = step === "3" ? "2" : step === "2" ? "1" : null;

  return (
    <Screen
      wide
      top={
        <SimpleTop
          wide
          start={prev ? <BackButton label="Предыдущий шаг" onClick={() => flow.back(prev)} /> : undefined}
          title="Заявка учителя"
          end={<SignOutAction onBeforeLogout={clearApplyDraft} />}
        />
      }
      className="auth"
    >
      <OnboardLayout step="apply">
      {resource.error && !me ? (
        <LoadError error={resource.error} onRetry={resource.reload} />
      ) : !me || !restored ? (
        <LoadingBlock rows={2} />
      ) : (
        <Card roomy className="auth__card">
          <div className="tt-stack tt-stack--loose">
            <ProgressBar value={stepNo} max={3} label="Шаг заявки" valueText={`Шаг ${stepNo} из 3`} showValue />
            <header className="tt-stack tt-stack--tight">
              <StepHeading focusKey={step}>{TITLES[step]}</StepHeading>
              {step === "3" && district ? <p className="tt-lead">{district.nameRu}</p> : null}
            </header>

            {me.teacherStatus === "rejected" && step === "1" ? (
              <InlineAlert tone="honey">Прошлую заявку не подтвердили. Проверьте данные.</InlineAlert>
            ) : null}

            {step === "1" ? (
              <Form className="tt-stack tt-stack--loose" invalidFocus={invalid} onSubmit={goStep2}>
                <TextField
                  label="Фамилия, имя, отчество"
                  name="fullName"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  error={errors.fullName}
                  maxLength={200}
                  required
                />
                <TextField
                  label="Должность"
                  name="position"
                  autoComplete="organization-title"
                  hint="Например, учитель башкирского языка"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  error={errors.position}
                  maxLength={120}
                  required
                />
                <Button type="submit" block>
                  Дальше
                </Button>
              </Form>
            ) : step === "2" ? (
              <div className="tt-stack">
                <TextField
                  label="Найти район или город"
                  type="search"
                  icon={<MagnifyingGlass weight="bold" aria-hidden />}
                  value={districtQuery}
                  onChange={(e) => setDistrictQuery(e.target.value)}
                  placeholder="Уфа, Бурзянский…"
                />
                {districts.error && !districts.data ? (
                  <RetryAlert error={districts.error} onRetry={districts.reload} busy={districts.loading} />
                ) : !districts.data ? (
                  <SkeletonGroup label="Загружаем районы" className="tt-stack tt-stack--tight">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} height={56} radius="button" />
                    ))}
                  </SkeletonGroup>
                ) : (
                  <div className="pick-list">
                    <ChoiceGroup
                      legend="Район"
                      hideLegend
                      value={districtId}
                      onChange={(id) => {
                        setDistrictId(id);
                        setSchoolId(null);
                      }}
                      options={filteredDistricts.map((d) => ({ value: d.id, label: d.nameRu, description: KIND_LABEL[d.kind] }))}
                    />
                    {filteredDistricts.length === 0 ? <p className="tt-muted">Ничего не нашлось.</p> : null}
                  </div>
                )}
                <Button block disabled={!districtId} onClick={() => flow.go("3")}>
                  Дальше
                </Button>
              </div>
            ) : (
              <div className="tt-stack">
                <TextField
                  label="Название или номер школы"
                  type="search"
                  icon={<MagnifyingGlass weight="bold" aria-hidden />}
                  value={schoolQuery}
                  onChange={(e) => setSchoolQuery(e.target.value)}
                  placeholder="7, гимназия…"
                />
                {schoolPage.error && !schools.length ? (
                  <RetryAlert error={schoolPage.error} onRetry={schoolPage.reload} busy={schoolPage.loading} />
                ) : schoolPage.loading && !schools.length ? (
                  <SkeletonGroup label="Ищем школы" className="tt-stack tt-stack--tight">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} height={64} radius="button" />
                    ))}
                  </SkeletonGroup>
                ) : (
                  <div className="pick-list" aria-busy={schoolPage.loading}>
                    <ChoiceGroup
                      legend="Школа"
                      hideLegend
                      value={schoolId}
                      onChange={setSchoolId}
                      options={schools.map((s) => ({
                        value: s.id,
                        label: (
                          <>
                            {s.shortNameRu}
                            {s.isDemo ? (
                              <>
                                {" "}
                                <Chip tone="violet">демо</Chip>
                              </>
                            ) : null}
                          </>
                        ),
                        description: s.address ?? (s.nameRu !== s.shortNameRu ? s.nameRu : undefined),
                      }))}
                    />
                    {schools.length === 0 ? (
                      <p className="tt-muted">
                        {deferredSchoolQuery.length >= 2 ? "Ничего не нашлось." : "В этом районе пока нет школ."}
                      </p>
                    ) : null}
                    {schoolList.hasMore && !schoolPage.loading ? (
                      <LinkButton loading={schoolList.loadingMore} onClick={() => void loadMore()}>
                        Показать ещё
                      </LinkButton>
                    ) : null}
                  </div>
                )}
                {submitError ? <InlineAlert tone="danger">{submitError}</InlineAlert> : null}
                <Button block disabled={!schoolId} loading={busy} onClick={() => void submit()}>
                  Отправить заявку
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}
      </OnboardLayout>
    </Screen>
  );
}

/** Список не загрузился: текст ошибки и повтор рядом с ней — без перезагрузки страницы и потери введённого. */
function RetryAlert({ error, onRetry, busy }: { error: unknown; onRetry: () => void; busy: boolean }) {
  return (
    <div className="tt-stack tt-stack--tight">
      <InlineAlert tone="danger">{describeProblem(error)}</InlineAlert>
      <Button variant="secondary" icon={<ArrowsClockwise weight="bold" />} loading={busy} onClick={onRetry}>
        Попробовать снова
      </Button>
    </div>
  );
}
