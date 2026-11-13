# Развёртывание «ТелеТау»

Инструкция по установке стенда на домене **teletau.study** (ТЗ хакатона §6): состав, сервер, переменные,
миграции, запуск, TLS, бот и проверка после установки. Развёртывание боевого продакшена отличается только
набором секретов и запретом демо-режимов — §10. Стенд для показа описан сценарием `docs/demo/M2.md`.

## 1. Состав и адреса

Один сервер; обратный прокси терминирует TLS и проксирует на приложения, которые слушают localhost.
На стенде это **Caddy** (§7): сервер уже использует его для других своих сайтов, а сертификаты Let's Encrypt
он выпускает и продлевает сам. Подойдёт и nginx + certbot — тогда см. альтернативу в §7. Бот работает по
long polling — публичного адреса ему не нужно, только исходящий HTTPS к Telegram.

| Адрес | Что там | Приложение | Порт |
|---|---|---|---|
| `https://teletau.study` | веб ученика; Mini App — `/miniapp` | `apps/web` (Next.js) | 3000 |
| `https://api.teletau.study` | API, базовый путь `/api/v1` | `apps/api` (Fastify) | 4000 |
| `https://console.teletau.study` | консоль сотрудников (министерство, фонд, модерация) | `apps/console` (Next.js) | 3100 |
| — | бот `@teletaubot` (long polling) | `apps/bot` (grammY) | — |
| — | Postgres 17 + pgvector, Valkey, ClickHouse, S3 (SeaweedFS) | `docker-compose.yml` | 15432, 16379, 18123, 18333 |

DNS: A-записи `teletau.study`, `api.teletau.study`, `console.teletau.study` → IP сервера (CNAME-записи
`www` и пр. — по желанию). Порт 80 нужен только выпуску/продлению сертификатов и редиректу на https,
весь содержательный трафик — по 443.

## 2. Требования к серверу

- Linux x86_64 (Ubuntu 24.04+ или Debian 12), 2 vCPU, 4 ГБ RAM, 40 ГБ диска.
- Исходящий HTTPS к `api.telegram.org` (бот) и к репозиторию пакетов.
- Входящий: только 22 (SSH), 80 и 443. **Порты приложений (3000/3100/4000) и хранилищ (15432/16379/18123/18333)
  наружу закрыть** — в firewall облака (security group). Одного `ufw` мало: Docker публикует порты в обход
  `ufw`, поэтому либо security group, либо `docker-compose.override.yml` из §4.

## 3. Программное обеспечение

```sh
# Node 24 (версия — .nvmrc; NodeSource)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
# pnpm (версия — packageManager в package.json)
sudo corepack enable && sudo corepack prepare pnpm@9.15.0 --activate
# Docker + compose-плагин. Caddy для §7 обычно уже есть в образе хостинга;
# если нет — caddyserver.com/docs/install (официальный репозиторий пакетов)
sudo apt-get install -y docker.io docker-compose-v2
```

Код — в `/opt/teletau` (пример ниже; путь может быть любым):

```sh
sudo mkdir -p /opt/teletau && sudo chown -R $USER: /opt/teletau
git clone <репозиторий> /opt/teletau        # или rsync-снапшот каталога с машины разработки
cd /opt/teletau
pnpm install --frozen-lockfile
```

## 4. `.env` (секреты и адреса)

`.env` в корне — единственное место для секретов; он в `.gitignore`, в git лежит только `.env.example`
с комментариями по каждой переменной. Для стенда `teletau.study`:

```sh
# ── адреса (CORS API и адреса в интерфейсах) ──
PUBLIC_WEB_URL=https://teletau.study
PUBLIC_CONSOLE_URL=https://console.teletau.study
NEXT_PUBLIC_API_URL=https://api.teletau.study     # вшивается в сборку веба и консоли — меняется только с пересборкой

# ── стек и порты (как в .env.example) ──
DATABASE_URL=postgres://teletau:teletau@localhost:15432/teletau
VALKEY_URL=redis://localhost:16379
CLICKHOUSE_URL=http://teletau:teletau@localhost:18123/teletau
S3_ENDPOINT=http://localhost:18333
S3_ACCESS_KEY=teletau
S3_SECRET_KEY=teletau-local-secret
API_PORT=4000
WEB_PORT=3000
CONSOLE_PORT=3100
NEXT_TELEMETRY_DISABLED=1

# ── Telegram ──
TELEGRAM_BOT_TOKEN=<токен @teletaubot от @BotFather>
TELEGRAM_MINIAPP_URL=https://teletau.study/miniapp   # кнопка «Учиться» и кнопка меню; Telegram требует https
BOT_API_URL=http://127.0.0.1:4000                    # бот на том же сервере
BOT_SERVICE_TOKEN=<секрет ≥ 32 символов>             # одинаковый у API и бота (X-Service-Token)

# ── вход и сессии (секреты — свои, см. генерацию ниже) ──
# ВАЖНО: значение PEM — строго в ОДИНАРНЫХ кавычках. Юниты systemd читают этот же файл через EnvironmentFile=,
# а парсер systemd в неквотированных значениях съедает обратную косую черту (\n становится просто n) — ключ
# ломается и API не стартует. Одинарные кавычки — единственный формат, который systemd и node --env-file
# передают одинаково; приложение само превратит \n в переводы строк.
AUTH_JWT_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\nMIGH...\n-----END PRIVATE KEY-----\n'
AUTH_SECRET_PEPPER=<случайные ≥ 32 символов>
AUTH_ENCRYPTION_KEY=<base64 от 32 байт>
TRUST_PROXY=loopback
BFF_TRUST_PROXY=loopback

# ── демо-режимы стенда (§10) ──
AUTH_DEMO_OTP=0000
AUTH_DEMO_STAFF=1
AUTH_DEMO_CLASS_CODE=000000
```

Генерация секретов:

```sh
openssl rand -base64 32    # AUTH_SECRET_PEPPER (и отдельно — AUTH_ENCRYPTION_KEY: base64 ровно 32 байт)
openssl rand -hex 24       # BOT_SERVICE_TOKEN (48 символов ≥ 32)
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt | awk '{printf "%s\\n", $0}'
# строка вывода — тело AUTH_JWT_PRIVATE_KEY: PEM, где переводы строк заменены на \n.
# В .env его берём в одинарные кавычки (см. комментарий выше про systemd)
```

`TRUST_PROXY`/`BFF_TRUST_PROXY` — `loopback`, потому что прокси и приложения на одном сервере: Caddy дописывает
IP браузера в `X-Forwarded-For`, API и BFF доверяют заголовку только от loopback, и лимиты частоты считаются
по IP учеников, а не по IP сервера. Если между браузером и сервером стоит свой балансировщик — указать его
адреса/подсети (`.env.example` описывает формат).

**Порты хранилищ наружу не торчат.** На сервере создайте `docker-compose.override.yml` (серверный файл,
в git его нет — он в `.gitignore`):

```yaml
# /opt/teletau/docker-compose.override.yml — порты хранилищ только на loopback
services:
  postgres:
    ports: !override
      - "127.0.0.1:${POSTGRES_HOST_PORT:-15432}:5432"
  valkey:
    ports: !override
      - "127.0.0.1:${VALKEY_HOST_PORT:-16379}:6379"
  clickhouse:
    ports: !override
      - "127.0.0.1:${CLICKHOUSE_HOST_PORT:-18123}:8123"
  s3:
    ports: !override
      - "127.0.0.1:${S3_HOST_PORT:-18333}:8333"
```

Пароли хранилищ можно сменить там же (`environment: POSTGRES_PASSWORD` и `DATABASE_URL` согласованно) —
на стенде с закрытыми портами допустимы и dev-значения из `.env.example`.

## 5. Хранилища, миграции, данные

```sh
cd /opt/teletau
docker compose up -d --wait      # Postgres, Valkey, ClickHouse, S3 (SeaweedFS)
pnpm db:migrate                  # миграции drizzle (apps/api/drizzle) — читают корневой .env
pnpm --filter @teletau/api org:import       # справочник районов и школ РБ (идемпотентно)
pnpm --filter @teletau/api content:import   # курс из content/course (идемпотентно по версии)
pnpm --filter @teletau/api corpus:import    # дуэли «Помоги языку» (идемпотентно)
```

**Демо-мир для показа** — вместо трёх импортов и на чистой базе выполните `pnpm demo:reset`: он пересоздаёт
базу, прогоняет всё выше и разворачивает мир из `docs/demo/M2.md` (учитель, класс 5 «Б», ученик №07, регион,
демо-сотрудники консоли). Карточка демо-ученика — `.demo/student-card.png` (секрет; не публиковать). При
запущенных приложениях `demo:reset` откажется — остановите их (§6), сбросьте, запустите снова. Голоса в
дуэлях неизменяемы (правило 9), поэтому сброс мира — только пересозданием базы.

## 6. Сборка и запуск

`NEXT_PUBLIC_API_URL` и другие `NEXT_PUBLIC_*` вшиваются в сборку — сборка и запуск идут с одним `.env`:

```sh
cd /opt/teletau
set -a; source .env; set +a   # значения .env — в окружение сборки (PEM в одинарных кавычках сорсится как есть)
pnpm build
```

Запуск — systemd (по юниту на приложение; пример для API — точно тот, что работает на стене, остальные —
тем же шаблоном с заменой имени и `--filter`). `EnvironmentFile=` читает systemd — поэтому PEM в `.env`
обязан быть в одинарных кавычках (см. §4); сами приложения дополнительно читают этот же `.env` через
`node --env-file-if-exists`.

```ini
# /etc/systemd/system/teletau-api.service
[Unit]
Description=TeTau API
After=network-online.target docker.service
Wants=network-online.target

[Service]
WorkingDirectory=/opt/teletau
EnvironmentFile=/opt/teletau/.env
Environment=HOME=/home/kitty
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/local/bin/pnpm --filter @teletau/api start
Restart=on-failure
RestartSec=3
User=kitty
Group=kitty

[Install]
WantedBy=multi-user.target
```

Пользователь — непривилегированный (выше это `kitty`, владелец `/opt/teletau`); путь к `pnpm` — свой
(`which pnpm`; для pnpm из corepack это `/usr/local/bin`, HOME нужен для его кеша).

Четыре юнита: `teletau-api` (`--filter @teletau/api`), `teletau-web` (`--filter @teletau/web`),
`teletau-console` (`--filter @teletau/console`), `teletau-bot` (`--filter @teletau/bot`; юниту бота задайте
`After=teletau-api.service`, бот при недоступном API просто вежливо отвечает «попробуй позже»). У `web` и
`console` можно дописать `-H 127.0.0.1` к `next start` (скрипт `start` в их `package.json`) — тогда порты
3000/3100 не слышны и на сетевых интерфейсах.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now teletau-api teletau-web teletau-console teletau-bot
journalctl -u teletau-api -f      # логи; у бота ждём «bot: @teletaubot на связи…»
```

`ai-gateway`, `ml-worker` и `workers` для демо-стенда не обязательны (AI-функции — M5); при желании
запускаются тем же шаблоном.

**Бот — один экземпляр на токен.** Второй процесс с тем же `TELEGRAM_BOT_TOKEN` Telegram не пустит (409).
Случайный второй запуск локально на машине разработки «отбирает» обновления у стендового бота — следите,
чтобы на время показа ничто с этим токеном не работало.

## 7. TLS и обратный прокси (Caddy)

На стенде TLS терминирует Caddy — он уже работает на сервере для других сайтов. Сертификаты Let's Encrypt
он выпускает и продлевает сам: отдельного certbot и ручного обновления не нужно. Дописываем три блока в
`/etc/caddy/Caddyfile`:

```caddyfile
# TeTau: веб ученика, API, консоль. Сертификаты и редирект http→https — сам Caddy.
teletau.study {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}

api.teletau.study {
	encode zstd gzip
	reverse_proxy 127.0.0.1:4000
}

console.teletau.study {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3100
}
```

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy     # выпустит сертификаты при первом обращении (DNS уже указывает на сервер)
```

Caddy сам ставит `X-Forwarded-For`/`X-Forwarded-Proto` — этого достаточно для `TRUST_PROXY=loopback` из §4.

**Альтернатива (чистый сервер без Caddy): nginx + certbot.** Три `server`-блока с `server_name
teletau.study | api.teletau.study | console.teletau.study`, `listen 443 ssl http2`, `proxy_pass` на
127.0.0.1:3000/4000/3100, заголовки `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, `client_max_body_size 10m`
(«Загрузить фото» карточки входа), для API — `proxy_read_timeout 60s` (печать PDF-карточек). Затем
`certbot --nginx -d teletau.study -d api.teletau.study -d console.teletau.study` — он допишет ssl-директивы,
редирект и автопродление.

С Mini App по `http://` и с самоподписанным сертификатом Telegram не работает: адрес кнопки — только
`https://teletau.study/miniapp` с действующим сертификатом.

## 8. Бот @teletaubot

Токен выдан владельцем в @BotFather (новый бот — `/newbot`, шаги в `docs/demo/M2.md`). В `.env` стенда:

- `TELEGRAM_BOT_TOKEN` — токен; секрет: не в git, не в логи. Утёк — `/mybots` → **API Token** → **Revoke
  current token**, новый вписать в `.env` и перезапустить `teletau-bot`;
- `TELEGRAM_MINIAPP_URL=https://teletau.study/miniapp` — кнопка «Учиться» и кнопка меню; бот ставит её сам
  при старте (настроить вручную — `docs/demo/M2.md`);
- `BOT_API_URL=http://127.0.0.1:4000` и `BOT_SERVICE_TOKEN` — служебные операции (привязка чата, напоминания,
  задание дня) от имени роли `service`;
- команды бота: `/start`, `/daily` (задание дня — дуэль «Помоги языку»), `/cancel`, `/remind`, `/remind_off`,
  `/unlink`, `/help` — сценарий показа в `docs/demo/M2.md`, раздел «Telegram Mini App».

## 9. Проверка после установки

```sh
curl -fsS https://api.teletau.study/api/v1/health        # 200, status ok — Postgres и Valkey на месте
systemctl is-active teletau-api teletau-web teletau-console teletau-bot   # все active
curl -fsI https://teletau.study/                          # 200, редирект с http:// на https://
```

Затем по сценарию `docs/demo/M2.md`:

1. Веб `https://teletau.study` открывается, ученик входит по карточке (`.demo/student-card.png`) или коду
   класса `000-000`; урок проходится до итога.
2. Консоль `https://console.teletau.study/login`: `ministry@demo.teletau.local` и `fund@demo.teletau.local`
   (код 0000 + TOTP из `apps/api/data/README.md`) — разделы «Республика» и «Словарь для Фонда».
3. Telegram: `@teletaubot` → `/start` → «Учиться» → Mini App открывается, вход, тропа; в чате `/daily` →
   дуэль → «Голос учтён»; `/remind` → выбор часа.
4. `journalctl -u teletau-api -u teletau-bot -f` — без повторяющихся ошибок.

`bash scripts/verify.sh` на сервере не нужен — это полная проверка исходников (= CI); стенд проверяется
health-эндпоинтом и сценарием демо. Если прокси менялись — убедитесь, что `TRUST_PROXY` верен: при
ошибке лимиты частоты посчитаются по IP прокси и «Секунду, сейчас много входов» появится у всех сразу.

## 10. Демо-стенд и боевой прод

| | Стенд хакатона (`teletau.study`) | Боевой прод |
|---|---|---|
| `NODE_ENV` | не задан (development) | `production` |
| Демо-входы | включены: код 0000 для взрослых, демо-сотрудники с TOTP из репозитория, постоянный код класса 000-000, вход ученика — по QR-карточке | запрещены: API при старте отклонит `AUTH_DEMO_*` (`apps/api/src/config/config.ts`) |
| Секреты | свои, но допускаются dev-значения хранилищ (порты закрыты) | только собственные: `AUTH_JWT_PRIVATE_KEY`, `AUTH_ENCRYPTION_KEY`, `AUTH_SECRET_PEPPER` ≥ 32, `BOT_SERVICE_TOKEN` ≥ 32 — прод-конфиг проверит при старте |
| Вход взрослых | e-mail + демо-код 0000 | требует SMTP-провайдера — его ещё нет (M2-UX3): до подключения почты полноценный прод ограничен (ученики входят по карточкам) |
| Сотрудники | демо-аккаунты из `apps/api/data/README.md` | реальные учётные записи с настоящими TOTP-секретами |
| Данные | демо-мир `pnpm demo:reset` | живые пользователи |

Превратить стенд в прод: убрать `AUTH_DEMO_*` из `.env`, задать `NODE_ENV=production`, заменить dev-секреты,
поднять почтовый провайдер, завести сотрудников — и перезапустить приложения.

## 11. Обновление версии

```sh
cd /opt/teletau
git pull                            # или новый rsync-снапшот
pnpm install --frozen-lockfile
docker compose up -d --wait         # если менялся docker-compose.yml
pnpm db:migrate                     # новые миграции
set -a; source .env; set +a; pnpm build
sudo systemctl restart teletau-api teletau-web teletau-console teletau-bot
```

Мир не сбрасывается; сброс демо-мира (при подготовке показа) — `pnpm demo:reset` с остановленными приложениями
и последующим `systemctl start …`.

## 12. Если что-то не работает

| Симптом | Причина и что смотреть |
|---|---|
| Бот молчит | `journalctl -u teletau-bot`: «Telegram не принял токен (401)» — токен; «Telegram недоступен» — исходящий 443; 409 от Telegram — где-то запущен второй экземпляр с тем же токеном |
| `502 Bad Gateway` | приложение не поднято: `systemctl status teletau-api` и `journalctl -u teletau-api -n 50` |
| API не стартует с ошибкой конфигурации | в `.env` задан `NODE_ENV=production` без обязательных секретов или с `AUTH_DEMO_*` — текст ошибки называет переменную |
| API не стартует: `DECODER routines::unsupported` в TokenService | PEM в `.env` не в одинарных кавычках: парсер `EnvironmentFile` съел `\n`, ключ повреждён — см. §4 |
| Mini App не открывается | сертификат недействителен или `TELEGRAM_MINIAPP_URL` не `https://` — бот при старте пишет предупреждение |
| «Нет связи» в вебе | `NEXT_PUBLIC_API_URL` не совпадает с адресом API (пересоберите веб); CORS — `PUBLIC_WEB_URL`/`PUBLIC_CONSOLE_URL` в `.env` API |
| У всех «Секунду, сейчас много входов» | `TRUST_PROXY` не видит прокси: все ученики делят лимит IP сервера (§4) |
| Вход взрослых 503 | SMTP не подключён (M2-UX3) — на демо-стенде входите по демо-коду 0000 |
