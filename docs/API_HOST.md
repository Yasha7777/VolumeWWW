# Отдельный домен для API — что настроить на сервере

**Полный адрес API:** `https://api.volumetric.gottland.ru/api`
(проверка: `https://api.volumetric.gottland.ru/api/health`, Swagger: `https://api.volumetric.gottland.ru/api/docs`)

## Зачем

Хостовый nginx закрывает паролем (Basic) весь `volumetric.gottland.ru`, включая `/api/`.
Сайт после ввода пароля открывается, но каждый его запрос к API несёт свой токен
входа в заголовке `Authorization: Bearer …` — это тот же заголовок, в котором браузер
передаёт пароль. Браузер не может отправить оба сразу, хостовый nginx видит «нет
пароля» и отвечает 401. В итоге сайт открывается, но ни профиль, ни история, ни
загрузка замера не работают. Мобильное приложение ходит в тот же `/api/` и упирается
в то же самое.

Поэтому API вынесен на свой домен **без пароля**. Он защищён сам: каждый метод
требует токен входа (проверяет бэкенд), у Swagger свой пароль. Пароль на домене
сайта остаётся как есть — он API больше не мешает.

## Что сделать (хостовый nginx, 217.77.51.165)

1. **DNS:** A-запись `api.volumetric.gottland.ru` → `217.77.51.165` (тот же сервер).

2. **Блок nginx** — рядом с блоком `volumetric.gottland.ru`. Порт в `proxy_pass` —
   ТОТ ЖЕ, что в `proxy_pass` у сайта: это один и тот же контейнер, API от сайта он
   отличает по имени домена (поэтому `Host $host` обязателен).

   ```nginx
   server {
       listen 80;
       server_name api.volumetric.gottland.ru;

       # НЕ ставить auth_basic: пароль здесь снова сломает API (см. «Зачем»).

       client_max_body_size 2g;          # замер — до 100 оригиналов фото одним запросом
       proxy_request_buffering off;      # загрузка идёт потоком, не копится на диске
       proxy_read_timeout 3700s;         # опрос расчёта и долгие ответы
       proxy_send_timeout 3700s;
       proxy_buffer_size        32k;     # большие ответы (история, облако обхода)
       proxy_buffers            32 32k;  # без временных файлов — иначе обрывались
       proxy_busy_buffers_size  64k;
       proxy_max_temp_file_size 0;

       location / {
           proxy_pass http://127.0.0.1:ПОРТ;   # как у volumetric.gottland.ru
           proxy_http_version 1.1;
           proxy_set_header Host              $host;
           proxy_set_header X-Real-IP         $remote_addr;
           proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Connection        "";
       }
   }
   ```

3. **Сертификат:** `certbot --nginx -d api.volumetric.gottland.ru` — допишет в блок
   443 и редирект с http. Если сертификаты ставятся иначе — как для остальных доменов.
   После certbot проверить, что `auth_basic` в блоке так и не появилось.

4. `nginx -t && systemctl reload nginx`

5. **Сайт:** `cd <папка сайта> && git pull origin main && docker compose up --build -d`
   (в этой версии контейнер сайта уже знает домен API, а фронт ходит туда).

## Проверка

```bash
curl -i https://api.volumetric.gottland.ru/api/health
```
Ждём `200` и `{"status":"ok",...}` — **без** запроса пароля.

```bash
curl -i -X OPTIONS https://api.volumetric.gottland.ru/api/profile/ -H 'Origin: https://volumetric.gottland.ru' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'
```
Ждём `200` и заголовок `access-control-allow-origin`. Это проверка, которую браузер
делает перед каждым запросом с другого домена.

```bash
curl -i https://volumetric.gottland.ru/
```
По-прежнему `401` — пароль на сайте остался.

## Если что-то не так

- `/api/health` отдаёт страницу сайта (`404` в оформлении сайта) — до контейнера не
  доходит имя домена: в блоке нет `proxy_set_header Host $host`.
- Запрашивает пароль — в блок API попал `auth_basic` (или он стоит на уровне `http {}`
  и наследуется во все блоки — тогда в блоке API нужно `auth_basic off;`).
- `413` при загрузке замера — не хватает `client_max_body_size 2g`.

## Где это в коде

- адрес API во фронте — `API_BASE` в `frontend/src/api.js` (перекрывается
  `VITE_API_URL` в `frontend/.env.local` при сборке);
- домен API в контейнере — второй `server` в конце `frontend/nginx.conf`,
  проксирование — `frontend/api-proxy.conf`;
- приложение VolmetricARKit пока ходит на `https://volumetric.gottland.ru/api`
  (`Services/AppConfig.swift`, `apiURL`) — его нужно перевести на новый адрес
  отдельной сборкой; до этого под паролем сайта оно не работает.
- Сменили имя домена — поправить все три места: `api.js`, `nginx.conf`, этот файл.
