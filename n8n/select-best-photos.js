// ─────────────────────────────────────────────────────────────────────────────
// n8n · Code-нода перед зрительной моделью (LLaVA)
// Режим: «Run Once for All Items». Вставить ВМЕСТО старой ноды со скорингом.
//
// ЧТО ИЗМЕНИЛОСЬ (2026-08-23). Вебхук больше НЕ получает photos_b64: сайт шлёт
// analysis_id, id строк colmap_photos, ссылки на оригиналы и EXIF, а пиксели
// воркфлоу забирает сам. Скоринг по EXIF (ISO + BrightnessValue) и отбор 2
// лучших кадров переехали на бэкенд — туда, где EXIF и появляется (backend/
// app/routers/analyses.py: _photo_quality_score / _pick_best_photos).
// Здесь остаётся только «скачать отобранное и отдать дальше».
//
// Тело вебхука:
//   body.meta.analysis_id            — id замера
//   body.photos      [{ index, id, url, thumb_url, filename, exif, quality_score }]
//   body.best_photos [ то же, но уже отобранные: 2 лучших, в порядке съёмки ]
//   body.exif / body.photo_urls      — параллельные массивы, как раньше
// ─────────────────────────────────────────────────────────────────────────────

const ensemble = $input.first().json;
const body     = $('Webhook (изображения + email)').first().json.body || {};

const MAX_FOR_LLAVA = 2;

const photos = Array.isArray(body.photos) ? body.photos : [];

// Отбор уже сделан на сайте. Фолбэк на первые кадры — на случай, если нода
// окажется впереди задеплоенного бэкенда (best_photos ещё не приезжает).
const selected = (Array.isArray(body.best_photos) && body.best_photos.length
  ? body.best_photos
  : photos
).slice(0, MAX_FOR_LLAVA);

const result = [];

for (const p of selected) {
  if (!p || !p.url) continue;

  // Оригинал лежит в публичном бакете colmap — тянем по ссылке из БД.
  const buffer = Buffer.from(
    await this.helpers.httpRequest({
      method: 'GET',
      url: p.url,
      encoding: 'arraybuffer',
      json: false,
    })
  );

  const filename = p.filename || `photo_${(p.index ?? 0) + 1}.jpg`;
  const binaryData = await this.helpers.prepareBinaryData(buffer, filename, 'image/jpeg');

  result.push({
    json: {
      image_b64:     buffer.toString('base64'),   // как и раньше — для нод, ждущих base64
      _ensemble:     ensemble,
      dbHint:        ensemble.dbMatchesSummary || 'нет данных',
      _exif:         p.exif ?? null,
      photo_id:      p.id ?? null,                // строка colmap_photos
      photo_index:   p.index ?? null,
      quality_score: p.quality_score ?? null,     // посчитан на бэкенде, для отладки
      analysis_id:   body?.meta?.analysis_id ?? null,
    },
    binary: { data: binaryData },
  });
}

return result;
