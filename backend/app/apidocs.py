# -*- coding: utf-8 -*-
"""Описания методов для Swagger: /api/docs и /api/openapi.json.

ЗАЧЕМ. FastAPI сам строит список методов, но без пояснений: что метод делает,
куда ходит внутри (БД, Storage, GPU-сервер) и какие ошибки отдаёт.
Здесь лежат эти пояснения, а `install(app)` накладывает их на схему.

КАК УСТРОЕНО.
  • Список путей бэкенда берётся ИЗ КОДА (маршруты FastAPI) в момент запуска.
    Описание отсюда подставляется по паре «путь + HTTP-метод».
  • Метод есть в коде, а описания нет -> он всё равно виден в Swagger, в разделе
    «Без описания», и в лог уходит предупреждение. Значит, сюда пора дописать.
  • Описание есть, а метода в коде уже нет -> в Swagger не попадает, в лог
    уходит предупреждение. Значит, отсюда пора убрать.
  • Три метода GPU-приёмника (/health, /run, /result/…) к маршрутам бэкенда не
    относятся: это другой сервер. Они описаны здесь же руками по
    receiver_dust3r.py и показываются всегда. Поменялся приёмник -> правь тут.

На работу самих методов файл НЕ влияет: роутеры из него берут только константу
DOCS_PASSWORD (routers/admin.py показывает её суперадмину), а сам он лишь
меняет то, что отдаёт /api/openapi.json. Сломается сборка описаний -> в лог
уйдёт ошибка, а Swagger покажет обычную автосхему FastAPI.

КАК ДОБАВИТЬ МЕТОД: записать paths["/api/…"] = {"get": {...}} по образцу
соседних. Текст описания собирает D(сервис, доступ, [(куда, что делает), …],
пояснение).
"""
import base64
import copy
import json
import logging
import secrets

from fastapi import Depends, HTTPException, Request
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse

logger = logging.getLogger(__name__)

# ДОСТУП К SWAGGER.
#   /api/docs          — открытая страница-оболочка: поле «Пароль» и больше
#                        ничего, ни одного описания в ней нет;
#   /api/openapi.json  — сама схема со всеми описаниями, отдаётся ТОЛЬКО с
#                        паролем. Страница запрашивает её после ввода пароля.
# Пароль едет заголовком `Authorization: Basic base64(":пароль")` (логин не
# нужен), так что схему можно забрать и из консоли: curl -u ':пароль' …
#
# ПОЧЕМУ СВОЯ ФОРМА, А НЕ ОКНО ВХОДА БРАУЗЕРА. Первая версия (08.10.2026)
# отвечала 401 с заголовком WWW-Authenticate и рассчитывала на штатное окно
# Basic-входа. На проде Chrome его не показал: человек видел голый ответ
# {"detail":"Not authenticated"} и войти не мог (сервер при этом отвечал
# верно — проверено запросом). Форма на странице от поведения браузера не
# зависит. По той же причине 401 здесь БЕЗ WWW-Authenticate: с ним браузер мог
# бы поверх формы показать ещё и своё окно.
#
# Пароль зашит в код намеренно (решение владельца проекта, 08.10.2026); он
# лежит в git, так что сменить = поправить строку ниже и выкатить. Закрывает он
# ТОЛЬКО документацию: сами методы /api/… защищены своим — JWT пользователя.
DOCS_PASSWORD = "!bl+P&w7;ZE6(Js"
DOCS_URL = "/api/docs"
# Схема ОБЯЗАНА лежать под /api/: nginx проксирует на бэкенд только этот
# префикс. С адресом FastAPI по умолчанию (/openapi.json) страница открывалась,
# а схему получить не могла — на проде там был 404.
OPENAPI_URL = "/api/openapi.json"
SWAGGER_UI = {
    "docExpansion": "list",            # разделы раскрыты, методы свёрнуты
    "defaultModelsExpandDepth": 0,     # блок схем внизу свёрнут
    "filter": True,                    # строка поиска по разделам
    "persistAuthorization": True,      # введённый токен переживает F5
}
# Сам Swagger UI — с CDN, версия закреплена (её же ставит FastAPI по умолчанию,
# только новее). Сменить версию = поправить номер здесь.
SWAGGER_CDN = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14"

DOCS_REVISION = "2026-10-10.1"   # правка описаний (дата.номер за день), видна в шапке Swagger
UNDOC_TAG = "Без описания"
HTTP_METHODS = ("get", "put", "post", "delete", "patch", "options", "head", "trace")

BE = "Бэкенд сайта"
GPU = "GPU-сервер (приёмник)"

A_OPEN = "открыт, ключ не нужен"
A_USER = "JWT пользователя (`Authorization: Bearer <access_token Supabase>`)"
A_ADMIN = "JWT пользователя + `profiles.is_superadmin = true`"
A_GPU = "ключ приёмника (`X-Volmetric-Token` или `Authorization: Bearer`)"


def D(service, access, calls, text=""):
    rows = "\n".join(f"| {a} | {b} |" for a, b in calls) if calls else "| — | никуда не обращается |"
    return (
        f"**Сервис:** {service}  \n**Доступ:** {access}\n\n"
        f"| Куда обращается | Что делает |\n|---|---|\n{rows}\n\n{text}".strip()
    )


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def js(schema, example=None):
    c = {"schema": schema}
    if example is not None:
        c["example"] = example
    return {"application/json": c}


def err(desc, *details):
    out = {"description": desc, "content": js(ref("Error"))}
    if details:
        out["content"]["application/json"]["examples"] = {
            f"e{i + 1}": {"summary": d, "value": {"detail": d}} for i, d in enumerate(details)
        }
    return out


R401 = err("JWT не прошёл проверку", "Токен истёк или неверен", "Невалидный токен")
R403_NOAUTH = err("Нет заголовка Authorization", "Not authenticated")
R422 = {"description": "Тело или параметры не прошли проверку типов (FastAPI)",
        "content": js(ref("ValidationError"))}
R503_GPU = err("Адрес GPU-сервера не задан ни в БД, ни в окружении",
               "Расчётный сервер не настроен. Обратитесь к администратору.")


def user_errors(**extra):
    out = {"401": R401, "403": R403_NOAUTH}
    out.update(extra)
    return out


SEC_USER = [{"userJWT": []}]
SEC_GPU = [{"gpuToken": []}, {"gpuBearer": []}]

GPU_BG = ("GPU-сервер",
          "в фоне, после ответа: `POST /run` с `wait: false`, затем `GET /result/{analysis_id}` "
          "раз в 5 с, пока не придёт `state: done` (предел ожидания 3600 с)")
DB_SETTINGS = ("БД · `app_settings`", "SELECT строки `key = gpu`: адрес, режим и ключ GPU-сервера")
DB_ADMIN = ("БД · `profiles`", "SELECT `is_superadmin` текущего пользователя")
DB_FINISH = ("БД · `analyses`",
             "в фоне, по итогу расчёта: UPDATE `status` (`completed` / `error`), `result` (текст), "
             "`completed_at`, `ply_url`, `glb_url`")

paths = {}

# ════════════════════════════ БЭКЕНД: служебное ═════════════════════════════
paths["/api/health"] = {"get": {
    "tags": ["Сайт · служебное"],
    "summary": "Жив ли бэкенд · никуда не ходит",
    "operationId": "health",
    "x-calls": [],
    "security": [],
    "description": D(BE, A_OPEN, [], "БД и GPU-сервер не проверяются: ответ говорит только о том, что процесс запущен."),
    "responses": {"200": {"description": "Бэкенд запущен",
                          "content": js({"type": "object", "properties": {
                              "status": {"type": "string"}, "service": {"type": "string"}}},
                              {"status": "ok", "service": "karelia-build-ai"})}},
}}

# ════════════════════════════ БЭКЕНД: замеры ════════════════════════════════
paths["/api/analyses/"] = {
    "post": {
        "tags": ["Сайт · замеры"],
        "summary": "Создать замер по фото · БД, Storage, GPU",
        "operationId": "createAnalysis",
        "x-calls": ["db", "storage", "gpu"],
        "security": SEC_USER,
        "description": D(BE, A_USER, [
            DB_SETTINGS,
            ("БД · `analyses`", "SELECT по `client_id` (защита от дублей), INSERT строки со статусом `pending`, "
                                "UPDATE `photo_urls` и `thumbnail_urls` после загрузки"),
            ("Storage · бакет `colmap`", "на каждое фото два файла: оригинал байт в байт "
                                        "`{analysis_id}/{uuid}.jpg` и миниатюра 400 px `{uuid}_thumb.jpg`"),
            ("БД · `colmap_photos`", "INSERT строки на каждое фото: пути, ссылки, имя файла, EXIF"),
            GPU_BG, DB_FINISH,
        ], "Ответ `202` приходит сразу после загрузки фото, расчёт идёт в фоне. Готовность смотреть по "
           "`GET /api/analyses/{analysis_id}`: поле `status`.\n\n"
           "Сами фото на GPU-сервер не отправляются. Уходят id строк `colmap_photos`, EXIF и параметры куба, "
           "файлы сервер качает сам.\n\n"
           "Повтор с тем же `client_id` второй замер не создаёт: возвращается уже существующая строка с её "
           "текущим статусом."),
        "requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {
            "type": "object", "required": ["files"],
            "properties": {
                "files": {"type": "array", "items": {"type": "string", "format": "binary"},
                          "description": "Фото, от 1 до 100 штук. Каждое `image/*`, не больше 20 МБ. "
                                         "Порядок файлов равен порядку кадров в расчёте."},
                "title": {"type": "string", "default": "", "description": "Название замера. Пусто: «Без названия»."},
                "notes": {"type": "string", "default": "", "description": "Заметка к замеру."},
                "exif_data": {"type": "string", "default": "[]",
                              "description": "JSON-строка: массив объектов EXIF, по одному на файл, в том же "
                                             "порядке, что `files`. Фронт читает EXIF из оригинала библиотекой exifr. "
                                             "Не массив или битый JSON: считается, что EXIF нет.",
                              "example": "[{\"FocalLength\":4.2,\"FocalLengthIn35mmFormat\":26,"
                                         "\"ExifImageWidth\":3024,\"ExifImageHeight\":4032,\"ISO\":50}]"},
                "cube": {"type": "string", "default": "",
                         "description": "JSON-строка с параметрами калибровочного куба. Пусто или мусор: "
                                        "стандартный куб 4×4 клетки по 17,5 мм.",
                         "example": "{\"squares_per_side\":4,\"square_size_m\":0.0175}"},
                "client_id": {"type": "string", "format": "uuid", "default": "",
                              "description": "UUID из очереди отправки на фронте. Становится `id` замера и "
                                             "защищает от дублей при повторной отправке."},
                "is_prod": {"type": "boolean", "default": False, "deprecated": True,
                            "description": "Принимается для совместимости, ни на что не влияет."},
            }}}}},
        "responses": {
            "202": {"description": "Замер создан (или уже существовал), расчёт запущен в фоне",
                    "content": js(ref("AnalysisAccepted"),
                                  {"id": "53e1bd1a-7c1f-4b0e-9a55-2f1c7d0e8a11", "status": "pending"})},
            "400": err("Файлы не прошли проверку", "Нужно хотя бы одно фото", "Максимум 100 фото",
                       "Не изображение: IMG_0012.mov",
                       "Файл IMG_0012.jpg больше 20 МБ. Сожмите его перед загрузкой."),
            **user_errors(), "422": R422, "503": R503_GPU,
        },
    },
    "get": {
        "tags": ["Сайт · замеры"],
        "summary": "История замеров · БД",
        "operationId": "listAnalyses",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_USER, [
            DB_ADMIN,
            ("БД · `analyses`", "SELECT до 50 последних замеров, новые сверху"),
            ("БД · `profiles`", "только для суперадмина: SELECT имени и компании владельцев"),
        ], "Обычный пользователь всегда получает только свои замеры, параметр `user_id` для него не действует."),
        "parameters": [{"name": "user_id", "in": "query", "required": False,
                        "schema": {"type": "string"},
                        "description": "Только для суперадмина: UUID пользователя или `all` (замеры всех)."}],
        "responses": {
            "200": {"description": "Список замеров",
                    "content": js({"type": "array", "items": ref("AnalysisListItem")})},
            **user_errors(),
        },
    },
}

paths["/api/analyses/admin/users"] = {"get": {
    "tags": ["Сайт · замеры"],
    "summary": "Список пользователей для фильтра истории · БД",
    "operationId": "adminListUsers",
    "x-calls": ["db"],
    "security": SEC_USER,
    "description": D(BE, A_ADMIN, [
        DB_ADMIN, ("БД · `profiles`", "SELECT `id, name, company, city` всех пользователей, по имени"),
    ], "Фронт по этому же методу определяет права: `200` показывает выбор пользователя в истории, `403` скрывает."),
    "responses": {
        "200": {"description": "Пользователи", "content": js({"type": "array", "items": {
            "type": "object", "properties": {
                "id": {"type": "string", "format": "uuid"}, "name": {"type": "string", "nullable": True},
                "company": {"type": "string", "nullable": True}, "city": {"type": "string", "nullable": True}}}})},
        "401": R401,
        "403": err("Нет заголовка Authorization либо пользователь не суперадмин",
                   "Недостаточно прав", "Not authenticated"),
    },
}}

AID = {"name": "analysis_id", "in": "path", "required": True,
       "schema": {"type": "string", "format": "uuid"}, "description": "id замера (строка `analyses`)."}
R404_AN = err("Замера нет либо он чужой (суперадмин видит любые)", "Анализ не найден")

paths["/api/analyses/{analysis_id}"] = {
    "get": {
        "tags": ["Сайт · замеры"],
        "summary": "Один замер со всеми полями · БД",
        "operationId": "getAnalysis",
        "x-calls": ["db"],
        "security": SEC_USER,
        "parameters": [AID],
        "description": D(BE, A_USER, [
            DB_ADMIN, ("БД · `analyses`", "SELECT `*` строки по `id`"),
        ], "Этим методом фронт опрашивает готовность замера: пока `status = pending`, расчёт ещё идёт."),
        "responses": {"200": {"description": "Строка замера", "content": js(ref("AnalysisRow"))},
                      **user_errors(), "404": R404_AN},
    },
    "delete": {
        "tags": ["Сайт · замеры"],
        "summary": "Удалить замер и его фото · БД, Storage",
        "operationId": "deleteAnalysis",
        "x-calls": ["db", "storage"],
        "security": SEC_USER,
        "parameters": [AID],
        "description": D(BE, A_USER, [
            DB_ADMIN,
            ("БД · `analyses`", "SELECT для проверки владельца, затем DELETE строки"),
            ("БД · `colmap_photos`", "SELECT путей файлов; сами строки удаляются каскадом вместе с замером"),
            ("Storage · бакет `colmap`", "удаление оригиналов и миниатюр замера"),
        ], "Файлы модели в бакете `dust3r-ply` этот метод не удаляет."),
        "responses": {"200": {"description": "Удалено", "content": js(ref("Ok"), {"ok": True})},
                      **user_errors(), "404": R404_AN},
    },
}

paths["/api/analyses/{analysis_id}/rerun"] = {"post": {
    "tags": ["Сайт · замеры"],
    "summary": "Пересчитать замер по уже загруженным фото · БД, GPU",
    "operationId": "rerunAnalysis",
    "x-calls": ["db", "gpu"],
    "security": SEC_USER,
    "parameters": [AID],
    "description": D(BE, A_USER, [
        DB_SETTINGS, DB_ADMIN,
        ("БД · `analyses`", "SELECT `*` строки, UPDATE: `status = pending`, `result` и `completed_at` обнуляются"),
        ("БД · `colmap_photos`", "в фоне: SELECT кадров замера (по `analyze_id`, у обхода по `scan_id`) с EXIF и данными ARKit"),
        ("БД · `scans`", "в фоне, только если замер сделан по обходу: SELECT строки обхода"),
        GPU_BG, DB_FINISH,
    ], "Фото повторно не загружаются. Прежний результат стирается сразу, до расчёта.\n\n"
       "Перезапустить можно и замер в статусе `pending`: так поднимают запись, зависшую после перезапуска бэкенда."),
    "requestBody": {"required": True, "content": js(ref("RerunRequest"),
                                                    {"cube": {"squares_per_side": 4, "square_size_m": 0.0175}})},
    "responses": {
        "202": {"description": "Пересчёт запущен в фоне", "content": js({
            "type": "object", "properties": {
                "id": {"type": "string", "format": "uuid"},
                "status": {"type": "string", "enum": ["pending"]},
                "mode": {"type": "string", "enum": ["test", "prod"],
                         "description": "Отражает присланный `is_prod`, на расчёт не влияет."}}},
            {"id": "53e1bd1a-7c1f-4b0e-9a55-2f1c7d0e8a11", "status": "pending", "mode": "test"})},
        **user_errors(), "404": R404_AN, "422": R422, "503": R503_GPU,
    },
}}

# ════════════════════════════ БЭКЕНД: профиль ═══════════════════════════════
paths["/api/profile/"] = {
    "get": {
        "tags": ["Сайт · профиль"],
        "summary": "Профиль текущего пользователя · БД",
        "operationId": "getProfile",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_USER, [("БД · `profiles`", "SELECT `*` строки с `id` текущего пользователя")]),
        "responses": {"200": {"description": "Строка профиля", "content": js(ref("Profile"))}, **user_errors()},
    },
    "put": {
        "tags": ["Сайт · профиль"],
        "summary": "Сохранить профиль · БД",
        "operationId": "updateProfile",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_USER, [("БД · `profiles`", "UPSERT строки с `id` текущего пользователя")],
                         "Записываются все шесть полей сразу. Поле, которого нет в теле, сохранится как `null`, "
                         "`emails` как пустой список. Присылать нужно профиль целиком."),
        "requestBody": {"required": True, "content": js(ref("ProfileUpdate"), {
            "name": "Яков", "company": "Volumetric Gottland", "position": "Разработчик",
            "city": "Петрозаводск", "phone": "+7 921 123-45-67", "emails": ["report@example.ru"]})},
        "responses": {
            "200": {"description": "Сохранено", "content": js(ref("Ok"), {"ok": True})},
            "400": err("Телефон или почта не прошли проверку",
                       "Номер телефона указан неверно: нужен российский номер, +7 и 10 цифр",
                       "Адрес почты указан с ошибкой: user@@mail",
                       "Адресов для результатов может быть не больше 5"),
            **user_errors(), "422": R422,
        },
    },
}

# ════════════════════════════ БЭКЕНД: обходы ════════════════════════════════
SID = {"name": "scan_id", "in": "path", "required": True,
       "schema": {"type": "string", "format": "uuid"}, "description": "id обхода (строка `scans`)."}
R404_SCAN = err("Обхода нет, он удалён либо чужой", "Обход не найден")

paths["/api/scans/"] = {
    "get": {
        "tags": ["Сайт · обходы из приложения"],
        "summary": "Список обходов · БД",
        "operationId": "listScans",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_USER, [
            DB_ADMIN,
            ("БД · `scans`", "SELECT до 100 неудалённых обходов, новые сверху"),
            ("БД · `colmap_photos`", "SELECT первого кадра каждого обхода для обложки"),
            ("БД · `profiles`", "SELECT имени и города авторов"),
            ("БД · `analyses`", "SELECT последнего замера по каждому обходу"),
        ]),
        "parameters": [
            {"name": "from", "in": "query", "schema": {"type": "string", "format": "date-time"},
             "description": "Снято не раньше этого момента (`captured_at`)."},
            {"name": "to", "in": "query", "schema": {"type": "string", "format": "date-time"},
             "description": "Снято не позже этого момента."},
            {"name": "user_id", "in": "query", "schema": {"type": "string"},
             "description": "Только для суперадмина: UUID пользователя или `all`."},
        ],
        "responses": {"200": {"description": "Обходы", "content": js({"type": "array", "items": ref("ScanListItem")})},
                      **user_errors()},
    },
    "post": {
        "tags": ["Сайт · обходы из приложения"],
        "summary": "Завести обход перед загрузкой кадров · БД",
        "operationId": "createScan",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_USER, [
            ("БД · `scans`", "SELECT по `id`; INSERT со статусом `uploading` либо UPDATE метаданных при повторе"),
            ("БД · `colmap_photos`", "при повторе: SELECT номеров уже загруженных кадров"),
        ], "Первый шаг загрузки из приложения VolmetricARKit. `id` придумывает телефон.\n\n"
           "Повтор с тем же `id` безопасен: в `uploaded` приходят номера кадров, которые уже лежат на сервере, "
           "и телефон докачивает остальные."),
        "requestBody": {"required": True, "content": js(ref("ScanCreate"), {
            "id": "0b6f6f2e-51a8-4c0a-9d3c-0d2f1c8b7a10", "title": "Щебень, Ладва",
            "captured_at": "2026-10-04T12:20:00+03:00", "frame_count": 64, "duration_s": 92.5,
            "device_model": "iPhone13,2", "app_version": "1.04.001",
            "lat": 61.36, "lon": 34.61, "loc_accuracy_m": 6.0, "tracking_segments": 1, "frames_degraded": 0})},
        "responses": {
            "201": {"description": "Обход заведён или уже существовал", "content": js(ref("ScanUploadState"),
                    {"id": "0b6f6f2e-51a8-4c0a-9d3c-0d2f1c8b7a10", "status": "uploading", "uploaded": [0, 1, 2]})},
            "400": err("id не UUID", "id обхода должен быть UUID"),
            **user_errors(),
            "409": err("id занят чужим обходом", "Обход с таким id уже есть у другого пользователя"),
            "422": R422,
        },
    },
}

paths["/api/scans/{scan_id}/frames/{index}"] = {"put": {
    "tags": ["Сайт · обходы из приложения"],
    "summary": "Загрузить один кадр обхода · БД, Storage",
    "operationId": "uploadFrame",
    "x-calls": ["db", "storage"],
    "security": SEC_USER,
    "parameters": [SID, {"name": "index", "in": "path", "required": True,
                         "schema": {"type": "integer", "minimum": 0},
                         "description": "Номер кадра: от 0 до `frame_count - 1`."}],
    "description": D(BE, A_USER + ", только автор обхода", [
        ("БД · `scans`", "SELECT обхода и проверка владельца"),
        ("БД · `colmap_photos`", "SELECT: нет ли уже такого кадра; INSERT строки кадра с `arkit` и `exif`"),
        ("Storage · бакет `colmap`", "оригинал байт в байт `scans/{scan_id}/{NNN}.jpg` и миниатюра `{NNN}_thumb.jpg`"),
    ], "Повтор того же кадра файл заново не пишет: приходит прежний ответ с `duplicate: true`."),
    "requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {
        "type": "object", "required": ["file"], "properties": {
            "file": {"type": "string", "format": "binary", "description": "JPEG кадра, не больше 25 МБ."},
            "meta": {"type": "string", "default": "{}",
                     "description": "JSON-строка с данными ARKit по кадру. В БД попадают ключи: `index`, `timestamp`, "
                                    "`width`, `height`, `intrinsics`, `cameraTransform`, `eulerAngles`, `trackingState`, "
                                    "`trackingReason`, `worldMappingStatus`, `exposureDuration`, `exposureOffset`, "
                                    "`ambientIntensity`, `ambientColorTemperature`, `sharpness`, `motionBlurPx`, "
                                    "`trackingSegment`, `featurePointCount`, `location`, `heading`, `device`. "
                                    "Вложенный объект `exif` сохраняется отдельно как EXIF кадра.",
                     "example": "{\"index\":0,\"width\":1920,\"height\":1440,"
                                "\"intrinsics\":[1447.2,0,0,0,1447.2,0,959.5,719.5,1],"
                                "\"cameraTransform\":[1,0,0,0,0,1,0,0,0,0,1,0,0.12,1.41,-0.3,1],"
                                "\"trackingState\":\"normal\"}"},
        }}}}},
    "responses": {
        "200": {"description": "Кадр на сервере", "content": js(ref("FrameUploaded"), {
            "index": 0, "id": "9d0c7f1a-3d3b-4a52-8a61-5b0f2b9f0c11",
            "public_url": "https://supabase.gottland.ru/storage/v1/object/public/colmap/scans/0b6f…/000.jpg"})},
        "400": err("Запрос не прошёл проверку", "Некорректный id обхода", "Номер кадра вне обхода: 64",
                   "Пустой кадр", "meta — не JSON"),
        **user_errors(), "404": R404_SCAN,
        "413": err("Файл слишком большой", "Кадр больше 25 МБ"), "422": R422,
    },
}}

paths["/api/scans/{scan_id}/complete"] = {"post": {
    "tags": ["Сайт · обходы из приложения"],
    "summary": "Завершить загрузку обхода · БД, Storage",
    "operationId": "completeScan",
    "x-calls": ["db", "storage"],
    "security": SEC_USER,
    "parameters": [SID],
    "description": D(BE, A_USER + ", только автор обхода", [
        ("БД · `scans`", "SELECT обхода; UPDATE `status = ready`, когда все кадры на месте"),
        ("Storage · бакет `colmap`", "запись `scans/{scan_id}/scan.json`, если файл прислан"),
        ("БД · `colmap_photos`", "SELECT номеров загруженных кадров"),
    ], "Если кадров не хватает, статус не меняется, а в `missing` приходят недостающие номера (первые 200). "
       "Код ответа при этом тоже `200`."),
    "requestBody": {"required": False, "content": {"multipart/form-data": {"schema": {
        "type": "object", "properties": {
            "scan_json": {"type": "string", "format": "binary",
                          "description": "Файл scan.json из приложения целиком (позы и разреженное облако ARKit), до 40 МБ."}}}}}},
    "responses": {
        "200": {"description": "Состояние загрузки", "content": js(ref("ScanCompleteState"),
                {"id": "0b6f6f2e-51a8-4c0a-9d3c-0d2f1c8b7a10", "status": "ready", "missing": [], "uploaded": 64})},
        "400": err("id не UUID", "Некорректный id обхода"),
        **user_errors(), "404": R404_SCAN,
        "413": err("Файл слишком большой", "scan.json больше 40 МБ"),
    },
}}

paths["/api/scans/{scan_id}/track"] = {"get": {
    "tags": ["Сайт · обходы из приложения"],
    "summary": "Траектория камеры для карты · БД",
    "operationId": "scanTrack",
    "x-calls": ["db"],
    "security": SEC_USER,
    "parameters": [SID],
    "description": D(BE, A_USER, [
        DB_ADMIN, ("БД · `scans`", "SELECT для проверки доступа"),
        ("БД · `colmap_photos`", "SELECT кадров обхода с позами ARKit"),
    ], "Позиции камеры считаются из `cameraTransform` каждого кадра. Блок `geo` есть, только когда в кадрах "
       "записан GPS с погрешностью до 30 м: по нему и по компасу траектория привязывается к карте."),
    "responses": {"200": {"description": "Траектория", "content": js(ref("Track"))},
                  **user_errors(), "404": R404_SCAN},
}}

paths["/api/scans/{scan_id}/cloud"] = {"get": {
    "tags": ["Сайт · обходы из приложения"],
    "summary": "Облако точек ARKit для 3D-просмотра · БД, Storage",
    "operationId": "scanCloud",
    "x-calls": ["db", "storage"],
    "security": SEC_USER,
    "parameters": [SID],
    "description": D(BE, A_USER, [
        DB_ADMIN, ("БД · `scans`", "SELECT для проверки доступа и пути в хранилище"),
        ("Storage · бакет `colmap`", "чтение готового `cloud.v2.json`; если его нет, чтение `scan.json`, "
                                    "сборка облака и запись `cloud.v2.json` на будущее"),
    ], "Это облако телефона (ARKit), а не модель DUSt3R. Не больше 6000 точек, координаты в метрах, ось y вверх. "
       "Ответ сжат gzip, если клиент это умеет."),
    "responses": {"200": {"description": "Облако", "content": js(ref("Cloud"))},
                  **user_errors(),
                  "404": err("Нет обхода или его scan.json", "Обход не найден",
                             "У обхода нет scan.json — облако недоступно")},
}}

paths["/api/scans/{scan_id}/analyze"] = {"post": {
    "tags": ["Сайт · обходы из приложения"],
    "summary": "Запустить замер по обходу · БД, GPU",
    "operationId": "analyzeScan",
    "x-calls": ["db", "gpu"],
    "security": SEC_USER,
    "parameters": [SID],
    "description": D(BE, A_USER, [
        DB_SETTINGS, DB_ADMIN,
        ("БД · `scans`", "SELECT обхода, проверка `status = ready`"),
        ("БД · `colmap_photos`", "SELECT всех кадров обхода с EXIF и данными ARKit"),
        ("БД · `analyses`", "SELECT по `client_id` (защита от дублей), INSERT строки `pending` со ссылкой `scan_id`"),
        GPU_BG, DB_FINISH,
    ], "На GPU-сервер уходят все кадры обхода без прореживания, по каждому кадру поза и intrinsics ARKit, "
       "плюс путь к `scan.json` в хранилище. Замер записывается на автора обхода, даже если его запустил суперадмин."),
    "requestBody": {"required": True, "content": js(ref("ScanAnalyzeRequest"), {
        "title": "Щебень, Ладва", "notes": "", "cube": {"squares_per_side": 4, "square_size_m": 0.0175},
        "client_id": "7a1d1c36-0f0e-4f8a-8b1a-6f6a3d2f9e55"})},
    "responses": {
        "202": {"description": "Замер создан (или уже существовал), расчёт запущен в фоне", "content": js({
            "type": "object", "properties": {
                "id": {"type": "string", "format": "uuid"},
                "status": {"type": "string", "enum": ["pending", "completed", "error"]},
                "scan_id": {"type": "string", "format": "uuid"},
                "mode": {"type": "string", "enum": ["cube", "vio"],
                         "description": "Режим масштаба из настроек GPU-сервера. Нет в ответе на повтор с тем же `client_id`."}}},
            {"id": "7a1d1c36-0f0e-4f8a-8b1a-6f6a3d2f9e55", "status": "pending",
             "scan_id": "0b6f6f2e-51a8-4c0a-9d3c-0d2f1c8b7a10", "mode": "cube"})},
        **user_errors(), "404": R404_SCAN,
        "409": err("Обход не готов к расчёту", "Обход ещё не загружен полностью", "У обхода нет кадров в хранилище"),
        "422": R422, "503": R503_GPU,
    },
}}

# ════════════════════════════ БЭКЕНД: админка GPU ═══════════════════════════
R403_ADMIN = err("Нет заголовка Authorization либо пользователь не суперадмин",
                 "Только для администратора", "Not authenticated")

paths["/api/admin/gpu"] = {
    "get": {
        "tags": ["Сайт · настройки GPU-сервера"],
        "summary": "Текущий адрес и режим GPU-сервера · БД",
        "operationId": "getGpuSettings",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_ADMIN, [DB_ADMIN, DB_SETTINGS],
                         "Если строки в БД нет, значения берутся из переменных окружения бэкенда "
                         "`GPU_SERVER_URL`, `GPU_MODE`, `GPU_TOKEN`. Сам ключ не возвращается никогда."),
        "responses": {"200": {"description": "Настройки без ключа", "content": js(ref("GpuSettingsPublic"))},
                      "401": R401, "403": R403_ADMIN},
    },
    "put": {
        "tags": ["Сайт · настройки GPU-сервера"],
        "summary": "Сохранить адрес, режим и ключ GPU-сервера · БД",
        "operationId": "updateGpuSettings",
        "x-calls": ["db"],
        "security": SEC_USER,
        "description": D(BE, A_ADMIN, [
            DB_ADMIN, ("БД · `app_settings`", "SELECT текущих настроек, UPSERT строки `key = gpu`"),
        ], "Адрес приводится к виду `http(s)://хост[:порт]/run`: `1.2.3.4:6007` сохранится как "
           "`http://1.2.3.4:6007/run`. Связь с сервером при сохранении не проверяется, для этого есть `/check`."),
        "requestBody": {"required": True, "content": js(ref("GpuSettingsUpdate"),
                        {"url": "http://1.2.3.4:6007", "mode": "cube", "token": None})},
        "responses": {
            "200": {"description": "Сохранённые настройки без ключа", "content": js(ref("GpuSettingsPublic"))},
            "400": err("Режим, адрес или ключ с ошибкой", "Режим масштаба: cube или vio",
                       "Адрес расчётного сервера указан с ошибкой",
                       "Ключ доступа: только латиница, цифры и знаки без пробелов, до 200 символов"),
            "401": R401, "403": R403_ADMIN, "422": R422,
            "503": err("Нет таблицы `app_settings`",
                       "Таблица настроек не создана. Выполните supabase/migration_app_settings.sql в SQL-редакторе Supabase."),
        },
    },
}

paths["/api/admin/gpu/check"] = {"post": {
    "tags": ["Сайт · настройки GPU-сервера"],
    "summary": "Проверить связь с GPU-сервером · БД, GPU",
    "operationId": "checkGpu",
    "x-calls": ["db", "gpu"],
    "security": SEC_USER,
    "description": D(BE, A_ADMIN, [
        DB_ADMIN, DB_SETTINGS,
        ("GPU-сервер", "`GET /health` с ключом, ожидание до 8 с. Расчёт не запускается"),
    ], "Пустое тело проверяет сохранённые настройки. Заполненные `url` и `token` проверяются без сохранения.\n\n"
       "Неудачная проверка тоже отвечает `200`: смотреть нужно на `ok` и `error`."),
    "requestBody": {"required": True, "content": js(ref("GpuCheckRequest"), {"url": "http://1.2.3.4:6007"})},
    "responses": {
        "200": {"description": "Итог проверки", "content": js(ref("GpuCheckResult"), {
            "ok": True, "run_url": "http://1.2.3.4:6007/run", "ms": 84, "error": None, "engine": "dust3r",
            "code_edit_msk": "06.10.2026 22:32", "auth_required": True, "token_ok": True,
            "scale_modes_ready": ["cube"]})},
        "400": err("Адрес не задан или с ошибкой", "Адрес расчётного сервера не задан",
                   "Адрес должен начинаться с http:// или https://"),
        "401": R401, "403": R403_ADMIN, "422": R422,
    },
}}

paths["/api/admin/docs-password"] = {"get": {
    "tags": ["Сайт · служебное"],
    "summary": "Пароль к этой документации · БД",
    "operationId": "getDocsPassword",
    "x-calls": ["db"],
    "security": SEC_USER,
    "description": D(BE, A_ADMIN, [DB_ADMIN],
                     "Отдаёт пароль страницы `/api/docs` (зашит в `app/apidocs.py`) для панели «Swagger» "
                     "в «Профиле». Во фронт пароль не вшит: бандл сайта публичный."),
    "responses": {
        "200": {"description": "Пароль и адрес страницы", "content": js(
            {"type": "object", "properties": {"password": {"type": "string"}, "docs_url": {"type": "string"}}},
            {"password": "••••••••", "docs_url": "/api/docs"})},
        "401": R401, "403": R403_ADMIN,
    },
}}

# ════════════════════════════ GPU-ПРИЁМНИК ══════════════════════════════════
GPU_SERVERS = [{
    "url": "http://{gpu_host}:{port}",
    "description": "GPU-сервер. Адрес задаёт суперадмин в «Профиле» сайта (таблица app_settings).",
    "variables": {
        "gpu_host": {"default": "gpu-server", "description": "IP или имя арендованного сервера"},
        "port": {"default": "6007", "enum": ["6007", "6006"],
                 "description": "6007: папка VIO_Technology; 6006: старая папка dust3r"},
    },
}]
R401_GPU = err("Ключа нет или он неверный", "Неверный или отсутствующий ключ доступа")

paths["/health"] = {"servers": GPU_SERVERS, "get": {
    "tags": ["GPU-сервер · расчёт"],
    "summary": "Жив ли приёмник и подходит ли ключ · никуда не ходит",
    "operationId": "receiverHealth",
    "x-calls": [],
    "security": [{}, {"gpuToken": []}, {"gpuBearer": []}],
    "description": D(GPU, A_OPEN + "; с ключом в ответе появляется `token_ok`", [],
                     "Всегда отвечает `200`. Вызывается бэкендом из `POST /api/admin/gpu/check`."),
    "responses": {"200": {"description": "Приёмник запущен", "content": js(ref("ReceiverHealth"), {
        "status": "ok", "service": "volmetric-receiver", "code_edit_msk": "06.10.2026 22:32", "engine": "dust3r",
        "port": 6007, "auth_required": True, "scale_modes": ["cube", "vio"], "scale_modes_ready": ["cube"],
        "async_run": True, "arkit_focal": True, "jobs_running": 0, "token_ok": True})}},
}}

paths["/run"] = {"servers": GPU_SERVERS, "post": {
    "tags": ["GPU-сервер · расчёт"],
    "summary": "Запустить расчёт объёма · БД, Storage, диск и GPU сервера",
    "operationId": "receiverRun",
    "x-calls": ["db", "storage", "gpu-local"],
    "security": SEC_GPU,
    "description": D(GPU, A_GPU + ". Если `RECEIVER_TOKEN` на сервере пуст, проверки нет", [
        ("БД · `colmap_photos`", "SELECT `public_url` по каждому id из `photo_ids`"),
        ("Storage · бакет `colmap`", "скачивание оригиналов кадров по ссылкам и `scan.json` обхода"),
        ("Диск сервера", "папка прогона `volmetric/projects/{analysis_id}/`: кадры `000.jpg…`, `exif.json`, "
                         "`arkit.json`, `scan.json`, модель, `run_result.json`"),
        ("Раннер `dust3r_gpu.py`", "реконструкция DUSt3R или MASt3R на GPU, поиск куба, масштаб, объём. "
                                   "Один расчёт за раз, остальные ждут в очереди; предел 3600 с"),
        ("Storage · бакет `dust3r-ply`", "запись `{analysis_id}/dust3r_output.ply` и четырёх PNG: "
                                        "`heatmap_top`, `heatmap_side`, `cloud_top`, `cloud_side`"),
        ("БД · `dust3r_results`", "INSERT строки при любом исходе, включая ошибку"),
        ("БД · `analyses`", "PATCH строки замера: ссылки на картинки, `up_vector`, `up_vector_glb`. "
                            "Статус и текст результата приёмник не трогает, их пишет бэкенд сайта"),
    ], "Вызывается бэкендом сайта, браузер сюда не ходит.\n\n"
       "Два режима ответа, выбирает поле `wait`:\n\n"
       "- `wait: false` (так ходит сайт): сразу `202`, результат забирать по `GET /result/{analysis_id}`;\n"
       "- поля нет или `true`: соединение держится до конца расчёта, в ответе `200` с объектом результата.\n\n"
       "Ошибка расчёта в синхронном режиме приходит с кодом `200` и `status: error`. Смотреть нужно на `status`, а не на код.\n\n"
       "Режим `vio` пока не считается: данные обхода сохраняются, объём считается по кубу, "
       "в ответе `scale_mode: cube`."),
    "requestBody": {"required": True, "content": js(ref("RunRequest"), {
        "analysis_id": "53e1bd1a-7c1f-4b0e-9a55-2f1c7d0e8a11",
        "photo_ids": ["9d0c7f1a-3d3b-4a52-8a61-5b0f2b9f0c11", "1f2e3d4c-5b6a-4789-90ab-cdef01234567"],
        "wait": False,
        "exif": [{"photo_index": 0, "exif": {"focal_real": 4.2, "focal_35mm": 26, "orig_width": 3024, "orig_height": 4032}}],
        "cube": {"squares_per_side": 4, "square_size_m": 0.0175},
        "mode": "cube", "source": "site"})},
    "responses": {
        "202": {"description": "`wait: false`: задача принята. Если такая уже считается, приходит то же с "
                               "`duplicate: true`, второй расчёт не запускается",
                "content": js(ref("RunAccepted"), {"status": "accepted", "state": "running",
                                                   "analysis_id": "53e1bd1a-7c1f-4b0e-9a55-2f1c7d0e8a11"})},
        "200": {"description": "Синхронный режим: расчёт закончен (в том числе с ошибкой)",
                "content": js(ref("RunResult"))},
        "400": err("Тело не JSON либо нет обязательных полей", "Invalid JSON: Expecting value: line 1 column 1 (char 0)",
                   "analysis_id and photo_ids are required"),
        "401": R401_GPU,
    },
}}

paths["/result/{analysis_id}"] = {"servers": GPU_SERVERS, "get": {
    "tags": ["GPU-сервер · расчёт"],
    "summary": "Забрать исход расчёта · память и диск сервера",
    "operationId": "receiverResult",
    "x-calls": ["gpu-local"],
    "security": SEC_GPU,
    "parameters": [{"name": "analysis_id", "in": "path", "required": True,
                    "schema": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,80}$"},
                    "description": "Тот же id, что был в `POST /run`."}],
    "description": D(GPU, A_GPU, [
        ("Память приёмника", "таблица задач, до 200 последних"),
        ("Диск сервера", "`volmetric/projects/{analysis_id}/run_result.json`, если задачи нет в памяти "
                         "(после перезапуска приёмника)"),
    ], "Бэкенд сайта опрашивает этот метод раз в 5 с.\n\n"
       "`state: done` значит «расчёт закончился», а не «удался»: исход в `result.status`.\n\n"
       "Готовый результат переживает перезапуск приёмника, незаконченная задача нет: после перезапуска будет `404`. "
       "Три ответа `404` подряд бэкенд считает потерей задачи и ставит замеру статус `error`."),
    "responses": {
        "200": {"description": "Задача считается или закончена", "content": {"application/json": {
            "schema": ref("JobState"),
            "examples": {
                "running": {"summary": "считается или ждёт очереди",
                            "value": {"analysis_id": "53e1bd1a-…", "state": "running", "elapsed_sec": 42.0}},
                "done": {"summary": "закончена",
                         "value": {"analysis_id": "53e1bd1a-…", "state": "done", "elapsed_sec": 181.3,
                                   "result": {"status": "partial", "analysis_id": "53e1bd1a-…", "volume_m3": None,
                                              "volume_dust3r_units": 4.53e-05, "scale_mode": None,
                                              "ply_url": "https://supabase.gottland.ru/storage/v1/object/public/dust3r-ply/53e1bd1a-…/dust3r_output.ply"}}},
                "from_disk": {"summary": "прочитана с диска после перезапуска",
                              "value": {"analysis_id": "53e1bd1a-…", "state": "done", "from_disk": True,
                                        "result": {"status": "success", "analysis_id": "53e1bd1a-…"}}},
            }}}},
        "400": err("id не подходит под шаблон", "Некорректный analysis_id"),
        "401": R401_GPU,
        "404": err("Приёмник не знает такой задачи", "Задача неизвестна"),
    },
}}

# ════════════════════════════ СХЕМЫ ═════════════════════════════════════════
S = {}
S["Error"] = {"type": "object", "properties": {"detail": {"type": "string", "description": "Причина, готовый текст."}},
              "required": ["detail"]}
S["ValidationError"] = {"type": "object", "properties": {"detail": {"type": "array", "items": {
    "type": "object", "properties": {"loc": {"type": "array", "items": {}}, "msg": {"type": "string"},
                                     "type": {"type": "string"}}}}}}
S["Ok"] = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
S["Cube"] = {"type": "object", "description": "Калибровочный куб с шахматным рисунком.", "properties": {
    "squares_per_side": {"type": "integer", "default": 4,
                         "description": "Клеток на стороне грани. Приёмник принимает 3…10, иначе берёт 4."},
    "square_size_m": {"type": "number", "default": 0.0175,
                      "description": "Сторона клетки в метрах. Приёмник принимает 0,003…0,20, иначе берёт 0,0175."}}}
S["AnalysisAccepted"] = {"type": "object", "properties": {
    "id": {"type": "string", "format": "uuid", "description": "id замера."},
    "status": {"type": "string", "enum": ["pending", "completed", "error"],
               "description": "`pending` у нового замера; у повтора с тем же `client_id` текущий статус."}}}
AN_BASE = {
    "id": {"type": "string", "format": "uuid"},
    "user_id": {"type": "string", "format": "uuid", "description": "Владелец замера."},
    "title": {"type": "string"},
    "notes": {"type": "string", "nullable": True},
    "photo_urls": {"type": "array", "items": {"type": "string", "format": "uri"},
                   "description": "Ссылки на оригиналы в бакете `colmap`, в порядке загрузки."},
    "thumbnail_urls": {"type": "array", "items": {"type": "string", "format": "uri"},
                       "description": "Миниатюры, в том же порядке, что `photo_urls`."},
    "status": {"type": "string", "enum": ["pending", "completed", "error"],
               "description": "`pending`: считается; `completed`: готово; `error`: причина в `result`."},
    "created_at": {"type": "string", "format": "date-time"},
    "completed_at": {"type": "string", "format": "date-time", "nullable": True},
    "result": {"type": "string", "nullable": True,
               "description": "Текст результата, его собирает бэкенд из ответа GPU-сервера. Фронт вынимает из него числа "
                              "по шаблонам, например «Объём DUSt3R: 2.2531 м³». При ошибке здесь её причина."},
    "heatmap_top_url": {"type": "string", "format": "uri", "nullable": True, "description": "Карта высот, вид сверху (пишет GPU-сервер)."},
    "heatmap_side_url": {"type": "string", "format": "uri", "nullable": True},
    "cloud_top_url": {"type": "string", "format": "uri", "nullable": True, "description": "Облако точек, вид сверху (пишет GPU-сервер)."},
    "cloud_side_url": {"type": "string", "format": "uri", "nullable": True},
}
S["AnalysisListItem"] = {"type": "object", "properties": {
    **AN_BASE,
    "owner_name": {"type": "string", "nullable": True, "description": "Только в ответе суперадмину."},
    "owner_company": {"type": "string", "nullable": True, "description": "Только в ответе суперадмину."}}}
S["AnalysisRow"] = {"type": "object", "description": "Строка таблицы `analyses` целиком. Набор колонок зависит от применённых миграций.",
                    "additionalProperties": True, "properties": {
    **AN_BASE,
    "client_id": {"type": "string", "format": "uuid", "nullable": True},
    "scan_id": {"type": "string", "format": "uuid", "nullable": True, "description": "Обход, по которому сделан замер."},
    "ply_url": {"type": "string", "format": "uri", "nullable": True, "description": "Облако точек модели в бакете `dust3r-ply`."},
    "glb_url": {"type": "string", "format": "uri", "nullable": True, "description": "Сейчас всегда пусто: GLB на сервере не строится."},
    "up_vector": {"type": "array", "items": {"type": "number"}, "nullable": True, "description": "Ось «вверх» модели для 3D-просмотра."},
    "up_vector_glb": {"type": "array", "items": {"type": "number"}, "nullable": True}}}
S["RerunRequest"] = {"type": "object", "properties": {
    "cube": {"allOf": [ref("Cube")], "nullable": True, "description": "Куб в БД не хранится: нет в теле, берётся стандартный."},
    "is_prod": {"type": "boolean", "default": False, "deprecated": True, "description": "Ни на что не влияет."}}}
S["Profile"] = {"type": "object", "properties": {
    "id": {"type": "string", "format": "uuid"}, "name": {"type": "string", "nullable": True},
    "company": {"type": "string", "nullable": True}, "position": {"type": "string", "nullable": True},
    "city": {"type": "string", "nullable": True},
    "phone": {"type": "string", "nullable": True, "example": "+7 (921) 123-45-67"},
    "emails": {"type": "array", "items": {"type": "string", "format": "email"}, "description": "Адреса для отчётов, до 5."},
    "is_superadmin": {"type": "boolean"},
    "created_at": {"type": "string", "format": "date-time"}, "updated_at": {"type": "string", "format": "date-time"}}}
S["ProfileUpdate"] = {"type": "object", "properties": {
    "name": {"type": "string", "nullable": True}, "company": {"type": "string", "nullable": True},
    "position": {"type": "string", "nullable": True}, "city": {"type": "string", "nullable": True},
    "phone": {"type": "string", "nullable": True,
              "description": "Российский номер в любом написании. Сохраняется как `+7 (XXX) XXX-XX-XX`. Пусто: `null`."},
    "emails": {"type": "array", "nullable": True, "maxItems": 5, "items": {"type": "string", "format": "email"},
               "description": "До 5 адресов, повторы убираются."}}}
SCAN_BASE = {
    "id": {"type": "string", "format": "uuid"}, "user_id": {"type": "string", "format": "uuid"},
    "title": {"type": "string"},
    "status": {"type": "string", "enum": ["uploading", "ready"]},
    "frame_count": {"type": "integer"},
    "lat": {"type": "number", "nullable": True}, "lon": {"type": "number", "nullable": True},
    "loc_accuracy_m": {"type": "number", "nullable": True},
    "device_model": {"type": "string", "nullable": True}, "app_version": {"type": "string", "nullable": True},
    "captured_at": {"type": "string", "format": "date-time"},
    "duration_s": {"type": "number", "nullable": True},
    "tracking_segments": {"type": "integer", "nullable": True, "description": "Сколько раз ARKit терял и заново находил трекинг."},
    "frames_degraded": {"type": "integer", "nullable": True, "description": "Кадров со сниженным качеством трекинга."},
}
S["ScanListItem"] = {"type": "object", "properties": {
    **SCAN_BASE,
    "cover_url": {"type": "string", "format": "uri", "nullable": True, "description": "Миниатюра первого кадра."},
    "author_name": {"type": "string", "nullable": True}, "author_city": {"type": "string", "nullable": True},
    "last_analysis": {"type": "object", "nullable": True, "description": "Последний замер по обходу, если запускали.",
                      "properties": {"id": {"type": "string", "format": "uuid"},
                                     "status": {"type": "string", "enum": ["pending", "completed", "error"]},
                                     "created_at": {"type": "string", "format": "date-time"}}}}}
S["ScanCreate"] = {"type": "object", "required": ["id", "captured_at", "frame_count"], "properties": {
    "id": {"type": "string", "format": "uuid", "description": "UUID, который придумало приложение."},
    "title": {"type": "string", "maxLength": 200, "nullable": True},
    "captured_at": {"type": "string", "format": "date-time"},
    "frame_count": {"type": "integer", "minimum": 2, "maximum": 2000},
    "duration_s": {"type": "number", "nullable": True},
    "device_model": {"type": "string", "maxLength": 80, "nullable": True},
    "app_version": {"type": "string", "maxLength": 40, "nullable": True},
    "lat": {"type": "number", "minimum": -90, "maximum": 90, "nullable": True},
    "lon": {"type": "number", "minimum": -180, "maximum": 180, "nullable": True},
    "loc_accuracy_m": {"type": "number", "minimum": 0, "nullable": True},
    "tracking_segments": {"type": "integer", "minimum": 0, "maximum": 32767, "nullable": True},
    "frames_degraded": {"type": "integer", "minimum": 0, "maximum": 32767, "nullable": True}}}
S["ScanUploadState"] = {"type": "object", "properties": {
    "id": {"type": "string", "format": "uuid"}, "status": {"type": "string", "enum": ["uploading", "ready"]},
    "uploaded": {"type": "array", "items": {"type": "integer"}, "description": "Номера кадров, которые уже на сервере."}}}
S["FrameUploaded"] = {"type": "object", "properties": {
    "index": {"type": "integer"}, "id": {"type": "string", "format": "uuid", "description": "id строки `colmap_photos`."},
    "public_url": {"type": "string", "format": "uri"},
    "duplicate": {"type": "boolean", "description": "Есть и равно `true`, только если кадр уже был загружен раньше."}}}
S["ScanCompleteState"] = {"type": "object", "properties": {
    "id": {"type": "string", "format": "uuid"}, "status": {"type": "string", "enum": ["uploading", "ready"]},
    "missing": {"type": "array", "items": {"type": "integer"}, "description": "Номера недостающих кадров, не больше 200."},
    "uploaded": {"type": "integer", "description": "Сколько кадров на сервере."}}}
S["ScanAnalyzeRequest"] = {"type": "object", "properties": {
    "title": {"type": "string", "nullable": True, "description": "Нет: берётся название обхода."},
    "notes": {"type": "string", "nullable": True},
    "cube": {"allOf": [ref("Cube")], "nullable": True},
    "client_id": {"type": "string", "format": "uuid", "nullable": True, "description": "Защита от дублей, как у `POST /api/analyses/`."},
    "is_prod": {"type": "boolean", "default": False, "deprecated": True, "description": "Ни на что не влияет."}}}
XZ = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}
S["Track"] = {"type": "object", "properties": {
    "scan_id": {"type": "string", "format": "uuid"},
    "points": {"type": "array", "items": XZ, "description": "Позиции камеры `[x, z]` в метрах ARKit, вид сверху."},
    "frames": {"type": "array", "description": "До 12 кадров, равномерно по обходу, для проигрывания.", "items": {
        "type": "object", "properties": {"index": {"type": "integer"}, "at": XZ, "thumb": {"type": "string", "format": "uri"}}}},
    "frame_total": {"type": "integer"},
    "geo": {"type": "object", "description": "Привязка к карте. Есть не всегда.", "properties": {
        "lat0": {"type": "number"}, "lon0": {"type": "number"},
        "rot_deg": {"type": "number", "nullable": True, "description": "Поворот системы ARKit к северу."},
        "rot_source": {"type": "string", "enum": ["compass", "gps"], "nullable": True},
        "rot_spread_deg": {"type": "number", "nullable": True},
        "shift_en": XZ, "acc_m": {"type": "number", "description": "Лучшая погрешность GPS, м."},
        "fixes": {"type": "integer", "description": "Сколько кадров с пригодным GPS."},
        "points_en": {"type": "array", "items": XZ, "description": "Точки обхода в метрах на восток и север от `lat0, lon0`."},
        "frames_en": {"type": "array", "items": XZ}}}}}
XYZ = {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}
S["Cloud"] = {"type": "object", "properties": {
    "points": {"type": "array", "items": XYZ, "description": "Точки `[x, y, z]`, метры, до 6000 штук."},
    "cameras": {"type": "array", "items": XYZ, "description": "Позиции камеры по кадрам."}}}
S["GpuSettingsPublic"] = {"type": "object", "properties": {
    "url": {"type": "string", "example": "http://1.2.3.4:6007/run"},
    "mode": {"type": "string", "enum": ["cube", "vio"]},
    "token_set": {"type": "boolean", "description": "Задан ли ключ."},
    "token_hint": {"type": "string", "description": "Последние 4 символа ключа, если он не короче 12 символов.", "example": "…k3Qz"},
    "updated_at": {"type": "string", "format": "date-time", "nullable": True},
    "source": {"type": "string", "enum": ["db", "env", "none"], "description": "Откуда взят адрес: БД, окружение бэкенда или нигде не задан."},
    "storage_ready": {"type": "boolean", "description": "`false`: таблицы `app_settings` нет, сохранить настройки нельзя."}}}
S["GpuSettingsUpdate"] = {"type": "object", "required": ["url"], "properties": {
    "url": {"type": "string", "maxLength": 500},
    "mode": {"type": "string", "enum": ["cube", "vio"], "default": "cube"},
    "token": {"type": "string", "maxLength": 200, "nullable": True,
              "description": "`null`: ключ не менять; строка: заменить; пустая строка: стереть."}}}
S["GpuCheckRequest"] = {"type": "object", "properties": {
    "url": {"type": "string", "maxLength": 500, "nullable": True, "description": "Пусто: проверить сохранённый адрес."},
    "token": {"type": "string", "maxLength": 200, "nullable": True, "description": "`null`: проверить с сохранённым ключом."}}}
S["GpuCheckResult"] = {"type": "object", "properties": {
    "ok": {"type": "boolean"}, "run_url": {"type": "string"},
    "ms": {"type": "integer", "nullable": True, "description": "Время ответа, мс."},
    "error": {"type": "string", "nullable": True, "description": "Причина неудачи, готовый текст."},
    "engine": {"type": "string"}, "code_edit_msk": {"type": "string", "description": "Версия приёмника на сервере."},
    "auth_required": {"type": "boolean"}, "token_ok": {"type": "boolean", "nullable": True},
    "scale_modes_ready": {"type": "array", "items": {"type": "string"}}}}
S["ReceiverHealth"] = {"type": "object", "properties": {
    "status": {"type": "string"}, "service": {"type": "string", "enum": ["volmetric-receiver"]},
    "code_edit_msk": {"type": "string", "description": "Штамп правки файла приёмника: какая версия стоит на сервере."},
    "engine": {"type": "string", "enum": ["dust3r", "mast3r"]}, "port": {"type": "integer"},
    "auth_required": {"type": "boolean", "description": "Задан ли `RECEIVER_TOKEN`."},
    "scale_modes": {"type": "array", "items": {"type": "string"}},
    "scale_modes_ready": {"type": "array", "items": {"type": "string"}, "description": "Режимы, которые реально считаются. Сейчас только `cube`."},
    "async_run": {"type": "boolean", "description": "Приёмник умеет `wait: false` и `/result`."},
    "arkit_focal": {"type": "boolean", "description": "Берётся ли фокус из intrinsics ARKit."},
    "jobs_running": {"type": "integer", "description": "Задач в работе и в очереди."},
    "token_ok": {"type": "boolean", "description": "Есть, только если ключ прислан или не требуется."}}}
S["RunRequest"] = {"type": "object", "required": ["analysis_id", "photo_ids"], "properties": {
    "analysis_id": {"type": "string", "description": "id строки `analyses`. Имя папки прогона и ключ задачи."},
    "photo_ids": {"type": "array", "items": {"type": "string"}, "minItems": 2,
                  "description": "id строк `colmap_photos`. Порядок важен: кадр `i` сохраняется как `00i.jpg`."},
    "wait": {"type": "boolean", "description": "`false`: ответить сразу `202`. Нет или `true`: держать соединение до конца расчёта."},
    "exif": {"type": "array", "description": "По записи на фото. Фокус фиксируется, только если есть все четыре величины: "
                                            "фокусное в мм, фокусное 35 мм экв., ширина и высота оригинала.",
             "items": {"type": "object", "properties": {
                 "photo_index": {"type": "integer"},
                 "exif": {"type": "object", "nullable": True, "additionalProperties": True, "properties": {
                     "focal_real": {"type": "number", "description": "Фокусное, мм."},
                     "focal_35mm": {"type": "number", "description": "Фокусное в 35 мм эквиваленте."},
                     "orig_width": {"type": "integer"}, "orig_height": {"type": "integer"},
                     "iso": {"type": "number"}, "make": {"type": "string"}, "model": {"type": "string"},
                     "lat": {"type": "number"}, "lon": {"type": "number"}, "shot_at": {"type": "string"}}}}}},
    "cube": ref("Cube"),
    "mode": {"type": "string", "enum": ["cube", "vio"], "default": "cube",
             "description": "Режим масштаба. `vio` пока только сохраняет данные обхода."},
    "options": {"type": "object", "description": "Настройки расчёта. Сайт их не шлёт, действуют значения по умолчанию.", "properties": {
        "height_pct": {"type": "number", "default": 75, "description": "Перцентиль высоты в ячейке, обрезается до 50…99."},
        "cell_m": {"type": "number", "default": 0.01, "description": "Ячейка сетки, м, обрезается до 0,002…0,10."},
        "keep_vegetation": {"type": "boolean", "default": False},
        "min_conf_thr": {"type": "number"}, "no_cam_crop": {"type": "boolean", "default": False},
        "dump_raw": {"type": "boolean", "default": False}, "debug": {"type": "boolean", "default": False}}},
    "scan": {"type": "object", "description": "Только у замеров по обходу из приложения.", "additionalProperties": True, "properties": {
        "id": {"type": "string"}, "bucket": {"type": "string", "default": "colmap"},
        "scan_json_path": {"type": "string", "description": "Путь к scan.json в бакете; приёмник качает его своим ключом."}}},
    "frames": {"type": "array", "description": "Данные ARKit по кадрам обхода.", "items": {"type": "object", "properties": {
        "photo_id": {"type": "string"}, "frame_index": {"type": "integer"}, "filename": {"type": "string"},
        "arkit": {"type": "object", "nullable": True, "additionalProperties": True, "properties": {
            "intrinsics": {"type": "array", "items": {"type": "number"}, "description": "Матрица K, 9 чисел."},
            "width": {"type": "integer"}, "height": {"type": "integer"},
            "cameraTransform": {"type": "array", "items": {"type": "number"}, "description": "Поза камеры, 16 чисел."}}}}}},
    "source": {"type": "string", "description": "Сайт шлёт `site`. Приёмник это поле не читает."}}}
S["RunAccepted"] = {"type": "object", "properties": {
    "status": {"type": "string", "enum": ["accepted"]}, "state": {"type": "string", "enum": ["running"]},
    "analysis_id": {"type": "string"}, "duplicate": {"type": "boolean"}}}
S["RunResult"] = {"type": "object", "additionalProperties": True,
                  "description": "Итог расчёта, около 120 полей; здесь те, на которые опирается сайт. Любое поле может быть `null`. "
                                 "Полный список с расшифровкой: `API.md` в папке GPU-кода, раздел 5.",
                  "properties": {
    "status": {"type": "string", "enum": ["success", "partial", "error"],
               "description": "`success`: объём посчитан; `partial`: модель есть, но объёма нет либо он под сомнением; `error`: расчёт не удался."},
    "analysis_id": {"type": "string"},
    "error_message": {"type": "string", "nullable": True, "description": "Причина для `error` и `partial`; при `success` замечания по качеству."},
    "elapsed_sec": {"type": "number"},
    "volume_m3": {"type": "number", "nullable": True}, "volume_litres": {"type": "number", "nullable": True},
    "height_m": {"type": "number", "nullable": True}, "width_m": {"type": "number", "nullable": True},
    "depth_m": {"type": "number", "nullable": True}, "footprint_area_m2": {"type": "number", "nullable": True},
    "scale_mode_requested": {"type": "string", "enum": ["cube", "vio"]},
    "scale_mode": {"type": "string", "nullable": True,
                   "description": "Чем посчитан масштаб: `arkit_pose` — позы ARKit из обхода закреплены в DUSt3R, объём сразу в м³; `null` — масштаба нет (загрузка фото без обхода или позы непригодны). Куба нет с 10.10.2026."},
    "scale_m_per_unit": {"type": "number", "nullable": True, "description": "Масштаб, м на единицу реконструкции: 1.0 при `arkit_pose`."},
    "pose_mode": {"type": "string", "nullable": True, "description": "`arkit` — позы ARKit закреплены (режим A)."},
    "arkit_pose_frames": {"type": "integer", "nullable": True}, "arkit_pose_frames_total": {"type": "integer", "nullable": True},
    "arkit_pose_note": {"type": "string", "nullable": True, "description": "Почему позы ARKit не применены."},
    "arkit_depth_ratio_median": {"type": "number", "nullable": True,
                                 "description": "Глубина модели / глубина точек ARKit в тех же пикселях; ≈1 — масштаб верен (КТ2 (а))."},
    "volume_dust3r_units": {"type": "number", "nullable": True, "description": "Объём в единицах реконструкции (без масштаба)."},
    "photos_total": {"type": "integer"},
    "point_count": {"type": "integer", "nullable": True},
    "focal_from": {"type": "string", "enum": ["arkit", "exif"], "nullable": True},
    "ply_url": {"type": "string", "format": "uri", "nullable": True}, "glb_url": {"type": "string", "nullable": True},
    "heatmap_top_url": {"type": "string", "format": "uri", "nullable": True},
    "heatmap_side_url": {"type": "string", "format": "uri", "nullable": True},
    "cloud_top_url": {"type": "string", "format": "uri", "nullable": True},
    "cloud_side_url": {"type": "string", "format": "uri", "nullable": True},
    "log_summary": {"type": "string", "nullable": True}}}
S["JobState"] = {"type": "object", "properties": {
    "analysis_id": {"type": "string"}, "state": {"type": "string", "enum": ["running", "done"]},
    "elapsed_sec": {"type": "number"}, "result": ref("RunResult"),
    "from_disk": {"type": "boolean", "description": "Результат прочитан с диска после перезапуска приёмника."}}}

INFO = """
## Куда обращаются методы

| Система | Что это | Кто туда ходит |
|---|---|---|
| **БД** | Postgres в Supabase (supabase.gottland.ru), доступ service-ключом. Таблицы: `analyses` (замеры), `colmap_photos` (кадры), `scans` (обходы из приложения), `profiles`, `app_settings` (настройки GPU), `dust3r_results` (итоги расчётов) | бэкенд и приёмник |
| **Storage** | файловое хранилище Supabase. Бакет `colmap`: фото, миниатюры, `scan.json`. Бакет `dust3r-ply`: модель и картинки расчёта | бэкенд (`colmap`), приёмник (читает `colmap`, пишет `dust3r-ply`) |
| **GPU-сервер** | приёмник `receiver_dust3r.py` и раннер `dust3r_gpu.py` на арендованном сервере | только бэкенд, с ключом `X-Volmetric-Token` |
| **Supabase Auth** | учётные записи и сессии: вход по почте и паролю, регистрация | только фронт, напрямую |

n8n с 06.10.2026 в цепочке нет: бэкенд вызывает GPU-сервер напрямую.
""".strip()

TAGS = [
    {"name": "Сайт · замеры", "description": "Бэкенд сайта. Создание замера по фото, история, пересчёт, удаление."},
    {"name": "Сайт · обходы из приложения", "description": "Бэкенд сайта. Загрузка обхода из VolmetricARKit, просмотр и запуск замера по нему."},
    {"name": "Сайт · профиль", "description": "Бэкенд сайта. Данные пользователя."},
    {"name": "Сайт · настройки GPU-сервера", "description": "Бэкенд сайта. Панель суперадмина в «Профиле»: адрес, режим Cube/VIO, ключ."},
    {"name": "Сайт · служебное", "description": "Бэкенд сайта."},
    {"name": "GPU-сервер · расчёт", "description": "Приёмник `receiver_dust3r.py`. Вызывается только бэкендом сайта, браузер сюда не ходит."},
]

SPEC = {
    "openapi": "3.0.3",
    "info": {"title": "Volumetric Gottland API", "version": DOCS_REVISION, "description": INFO},
    # относительный адрес: «Try it out» ходит на тот же сервер, с которого открыта страница
    "servers": [{"url": "/", "description": "Бэкенд сайта (этот сервер)"}],
    "tags": TAGS,
    "paths": paths,
    "components": {
        "securitySchemes": {
            "userJWT": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT",
                        "description": "Токен сессии Supabase (`access_token`). Бэкенд проверяет подпись HS256 и берёт из него id пользователя."},
            "gpuToken": {"type": "apiKey", "in": "header", "name": "X-Volmetric-Token",
                         "description": "Общий секрет бэкенда и приёмника (`RECEIVER_TOKEN` на GPU-сервере, ключ в `app_settings` на сайте)."},
            "gpuBearer": {"type": "http", "scheme": "bearer", "description": "Тот же ключ приёмника, вторым способом: `Authorization: Bearer <ключ>`."},
        },
        "schemas": S,
    },
}


# ════════════════════════════ СБОРКА СХЕМЫ ══════════════════════════════════

def merge(auto: dict) -> dict:
    """Автосхема FastAPI + описания отсюда. См. шапку файла."""
    auto_paths = auto.get("paths") or {}
    out_paths: dict = {}
    undocumented: list[str] = []
    stale: list[str] = []

    # 1) в порядке этого файла: он задаёт порядок методов внутри раздела
    for path, item in SPEC["paths"].items():
        if "servers" in item:                       # другой сервер (GPU-приёмник)
            out_paths[path] = copy.deepcopy(item)
            continue
        live = auto_paths.get(path) or {}
        kept = {}
        for method, op in item.items():
            if method not in HTTP_METHODS:
                continue
            if method in live:
                kept[method] = copy.deepcopy(op)
            else:
                stale.append(f"{method.upper()} {path}")
        if kept:
            out_paths[path] = kept

    # 2) методы из кода, которых здесь нет
    for path, item in auto_paths.items():
        for method, op in item.items():
            if method not in HTTP_METHODS or method in (out_paths.get(path) or {}):
                continue
            op = copy.deepcopy(op)
            op["tags"] = [UNDOC_TAG]
            out_paths.setdefault(path, {})[method] = op
            undocumented.append(f"{method.upper()} {path}")

    # Схемы из кода нужны только методам без описания. Пока таких нет, их не
    # подмешиваем: FastAPI пишет схемы в диалекте OpenAPI 3.1 (type: null), а
    # этот файл — в 3.0, и смесь не проходит строгую проверку спецификации.
    auto_comp = (auto.get("components") or {}) if undocumented else {}
    schema = {
        "openapi": SPEC["openapi"],
        "info": copy.deepcopy(SPEC["info"]),
        "servers": copy.deepcopy(SPEC["servers"]),
        "tags": copy.deepcopy(SPEC["tags"]),
        "paths": out_paths,
        "components": {
            # одноимённые схемы отсюда — главнее
            "schemas": {**(auto_comp.get("schemas") or {}), **copy.deepcopy(SPEC["components"]["schemas"])},
            "securitySchemes": {**(auto_comp.get("securitySchemes") or {}),
                                **copy.deepcopy(SPEC["components"]["securitySchemes"])},
        },
    }
    if undocumented:
        schema["tags"].append({
            "name": UNDOC_TAG,
            "description": "Методы есть в коде, но не описаны в `backend/app/apidocs.py`. Показана автосхема FastAPI.",
        })
        logger.warning("Swagger: нет описания для %s — допиши в app/apidocs.py", ", ".join(undocumented))
    if stale:
        logger.warning("Swagger: описаны, но в коде их нет: %s — убери из app/apidocs.py", ", ".join(stale))
    return schema


def password_ok(request: Request) -> bool:
    """Верный ли пароль в `Authorization: Basic …`. Логин не проверяется."""
    scheme, _, value = (request.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "basic":
        return False
    try:
        decoded = base64.b64decode(value.strip(), validate=True).decode("utf-8")
    except Exception:
        return False
    _, sep, password = decoded.partition(":")
    return bool(sep) and secrets.compare_digest(password.encode("utf-8"), DOCS_PASSWORD.encode("utf-8"))


def require_docs_password(request: Request) -> None:
    if not password_ok(request):
        # без WWW-Authenticate — см. комментарий у DOCS_PASSWORD
        raise HTTPException(status_code=401, detail="Нужен пароль к документации")


DOCS_PAGE = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>__TITLE__</title>
<link rel="stylesheet" href="__CDN__/swagger-ui.css">
<style>
  html { background: #fff; }
  body { margin: 0; background: #fff; color: #2b3440;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  #gate { max-width: 360px; margin: 18vh auto 0; padding: 0 16px; }
  #gate h1 { font-size: 20px; margin: 0 0 6px; }
  #gate p { margin: 0 0 18px; color: #5d6875; font-size: 14px; line-height: 1.45; }
  #gate label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
  #gate .row { display: flex; gap: 8px; }
  #gate input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 9px 11px;
                border: 1px solid #b8c0ca; border-radius: 6px; background: #fff; color: inherit; }
  #gate input:focus-visible, #gate button:focus-visible { outline: 2px solid #2f6fdb; outline-offset: 1px; }
  #gate button { font: inherit; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 6px;
                 background: #1f4e9c; color: #fff; cursor: pointer; }
  #gate button:disabled { opacity: .6; cursor: default; }
  #msg { min-height: 20px; margin-top: 10px; font-size: 14px; color: #b3261e; }
  #bar { max-width: 1460px; margin: 0 auto; padding: 8px 20px 0; text-align: right; font-size: 13px; }
  #bar button { font: inherit; background: none; border: 0; color: #1f4e9c; cursor: pointer; padding: 4px 0; }
</style>
</head>
<body>
<form id="gate" autocomplete="off">
  <h1>__TITLE__</h1>
  <p>Описание методов сайта и расчётного сервера. Доступ по паролю.</p>
  <label for="pw">Пароль</label>
  <div class="row">
    <input id="pw" name="pw" type="password" autocomplete="current-password" autofocus required>
    <button id="go" type="submit">Открыть</button>
  </div>
  <div id="msg" role="alert"></div>
</form>
<div id="bar" hidden><button id="out" type="button">Выйти</button></div>
<div id="swagger-ui"></div>
<script src="__CDN__/swagger-ui-bundle.js"></script>
<script>
(function () {
  var OPENAPI_URL = __OPENAPI_URL__, UI = __UI__, KEY = "kb-docs-pw";
  var gate = document.getElementById("gate"), pw = document.getElementById("pw"),
      go = document.getElementById("go"), msg = document.getElementById("msg"),
      bar = document.getElementById("bar");
  function store(v) { try { v === null ? sessionStorage.removeItem(KEY) : sessionStorage.setItem(KEY, v); } catch (e) {} }
  function saved() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function basic(p) {                       // base64 от ":пароль" в UTF-8
    var bytes = new TextEncoder().encode(":" + p), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return "Basic " + btoa(bin);
  }
  function open(p, quiet) {
    go.disabled = true; msg.textContent = "";
    return fetch(OPENAPI_URL, { headers: { Authorization: basic(p) }, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) { store(null); if (!quiet) msg.textContent = "Пароль не подошёл."; return null; }
        if (!r.ok) throw new Error("код " + r.status);
        return r.json();
      })
      .then(function (spec) {
        if (!spec) return;
        if (!window.SwaggerUIBundle) throw new Error("не загрузился Swagger UI (cdn.jsdelivr.net недоступен)");
        store(p);
        gate.hidden = true; bar.hidden = false;
        window.ui = SwaggerUIBundle(Object.assign({
          spec: spec, dom_id: "#swagger-ui", deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis], layout: "BaseLayout", validatorUrl: null
        }, UI));
      })
      .catch(function (e) { msg.textContent = "Не удалось открыть: " + e.message + "."; })
      .then(function () { go.disabled = false; });
  }
  gate.addEventListener("submit", function (e) { e.preventDefault(); open(pw.value, false); });
  document.getElementById("out").addEventListener("click", function () { store(null); location.reload(); });
  var p = saved(); if (p) open(p, true);    // пароль уже вводили в этой вкладке — F5 не спрашивает заново
})();
</script>
</body>
</html>
"""
# [hidden] у формы и панели: у .swagger-ui своих правил на них нет, но страховка от чужого display
DOCS_PAGE = DOCS_PAGE.replace("</style>", "  [hidden] { display: none !important; }\n</style>")


def docs_page(title: str) -> str:
    return (DOCS_PAGE
            .replace("__TITLE__", title)
            .replace("__CDN__", SWAGGER_CDN)
            .replace("__OPENAPI_URL__", json.dumps(OPENAPI_URL))
            .replace("__UI__", json.dumps(SWAGGER_UI)))


def install(app) -> None:
    """Подключает Swagger: схему с описаниями (под паролем) и страницу входа.

    Штатные /docs и /openapi.json в FastAPI(...) должны быть ВЫКЛЮЧЕНЫ
    (docs_url=None, openapi_url=None): иначе рядом останутся открытые копии.
    Вызывать после объявления всех маршрутов.
    """

    def openapi() -> dict:
        # схема строится один раз, при первом запросе
        if app.openapi_schema:
            return app.openapi_schema
        auto = get_openapi(title=app.title, version=app.version, routes=app.routes)
        try:
            app.openapi_schema = merge(auto)
        except Exception:
            logger.exception("Swagger: описания не собрались — отдаю автосхему FastAPI")
            app.openapi_schema = auto
        return app.openapi_schema

    app.openapi = openapi

    @app.get(OPENAPI_URL, include_in_schema=False, dependencies=[Depends(require_docs_password)])
    def openapi_json():
        return JSONResponse(app.openapi(), headers={"Cache-Control": "no-store"})

    @app.get(DOCS_URL, include_in_schema=False)
    def swagger_page():
        return HTMLResponse(docs_page(f"{app.title} — API"), headers={"Cache-Control": "no-store"})
