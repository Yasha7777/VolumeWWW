// ─────────────────────────────────────────────────────────────────────────────
// n8n · Code-нода перед зрительной моделью (LLaVA)
// Режим: «Run Once for All Items». Вставить ВМЕСТО прежней ноды со скорингом
// (той, что сама считала quality_score и резала топ-2 из полной пачки).
//
// ЧТО ИЗМЕНИЛОСЬ НА БЭКЕНДЕ (2026-08-23)
// body.photos_b64 ОСТАЛСЯ и формат прежний (data-URL), но в нём теперь
// РОВНО 2 ЛУЧШИХ КАДРА, а не вся пачка: 50 оригиналов давали ~250 МБ JSON,
// и n8n на этом ложился. Скоринг по EXIF (ISO + BrightnessValue) переехал в
// backend/app/routers/analyses.py (_photo_quality_score / _best_photo_indexes) —
// туда, где EXIF и появляется, то есть ДО того, как байты попадут в запрос.
//
// Ноды «Webhook» и «b64 → items» править НЕ НУЖНО: вторая просто получит
// два item'а вместо пятидесяти.
//
// ⚠️ ГЛАВНОЕ ОТЛИЧИЕ ОТ СТАРОЙ НОДЫ: индексы разъехались.
// body.exif[] (и построенный из него exifParsed) — по-прежнему по ВСЕЙ пачке,
// а body.photos_b64[] — только два кадра. Поэтому photos_b64[0] это НЕ
// photo_index 0. Настоящая позиция кадра: body.meta.best_photo_indexes[k]
// (то же самое — body.best_photos[k].index). Брать exifParsed[k] по позиции в
// photos_b64 НЕЛЬЗЯ — модель получит EXIF чужого кадра.
//
// Тело вебхука:
//   body.meta.analysis_id / .photo_ids / .best_photo_ids / .best_photo_indexes
//   body.photos_b64  [ 2 × "data:image/jpeg;base64,..." ] — в порядке съёмки
//   body.best_photos [ { index, id, url, thumb_url, filename, exif, quality_score } ]
//   body.photos      [ то же по всем кадрам, но БЕЗ байтов ]
//   body.exif / body.photo_urls — параллельные массивы по всей пачке, как раньше
// ─────────────────────────────────────────────────────────────────────────────

const ensemble   = $input.first().json;
const body       = $('Webhook (изображения + email)').first().json.body || {};
const exifParsed = $('EXIF → parse').first().json.exifParsed || [];

const images = body.photos_b64 || body.photo_b64 || [];

// Метаданные отобранных кадров. Если бэкенд старый и best_photos не приезжает —
// считаем, что photos_b64 идёт с начала пачки (прежнее поведение).
const best = Array.isArray(body.best_photos) && body.best_photos.length
  ? body.best_photos
  : images.map((_, k) => ({ index: k }));

const result = [];

for (let k = 0; k < images.length; k++) {
  const raw = images[k];
  if (!raw) continue;

  const meta = best[k] || { index: k };
  const photoIndex = meta.index ?? k;              // позиция в ПОЛНОЙ пачке

  // EXIF берём по настоящей позиции кадра, а не по k.
  const exif = exifParsed.find(e => e.photo_index === photoIndex)?.exif
            ?? meta.exif
            ?? null;

  const base64Image = raw.includes(',') ? raw.split(',')[1] : raw;

  const binaryData = await this.helpers.prepareBinaryData(
    Buffer.from(base64Image, 'base64'),
    meta.filename || `photo_${photoIndex + 1}.jpg`,
    'image/jpeg',
  );

  result.push({
    json: {
      image_b64:     base64Image,
      _ensemble:     ensemble,
      dbHint:        ensemble.dbMatchesSummary || 'нет данных',
      _exif:         exif,
      photo_index:   photoIndex,
      photo_id:      meta.id ?? null,              // строка colmap_photos
      photo_url:     meta.url ?? null,             // оригинал в бакете
      quality_score: meta.quality_score ?? null,   // посчитан на бэкенде
      analysis_id:   body?.meta?.analysis_id ?? null,
    },
    binary: { data: binaryData },
  });
}

return result;
