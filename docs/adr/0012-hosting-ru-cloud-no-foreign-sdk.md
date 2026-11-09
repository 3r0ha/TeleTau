# ADR 0012. Хостинг в российском облаке, без зарубежных SaaS-SDK в клиентах

- Статус: принято (M0)

## Решение
Прод — Yandex Cloud (Kubernetes, managed PostgreSQL, Valkey, ClickHouse, Object Storage). Аналитика и сбор ошибок — собственный контур (self-hosted). В клиентах нет Firebase Analytics и Crashlytics, Google Analytics и подобных SDK. Пуши на Android — RuStore Universal Push SDK (RuStore + FCM + HMS), на iOS — APNs.

## Последствия
Меньше внешних зависимостей и меньше риск блокировок и удалений. Нужна своя инфраструктура наблюдаемости (`docs/08` §3).
