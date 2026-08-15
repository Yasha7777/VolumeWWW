// Подготовка выбранного файла к отправке в замер.
//
// ГЛАВНЫЙ ИНВАРИАНТ: на сервер уходит ОРИГИНАЛЬНЫЙ ФАЙЛ, байт в байт — без
// пережатия, без ресайза, без пересохранения через canvas. Это не «можно бы и
// сжать», от этого зависит достоверность объёма:
//   • расчётный сервер берёт фокусное расстояние из EXIF, а canvas.toBlob()
//     срезает EXIF целиком → фокус оптимизируется свободно и разъезжается втрое
//     (замер: 391..1238 px по кадрам одной съёмки) → масштаб сцены строится на
//     одном кадре из пачки;
//   • прежний ресайз до 1600 px по длинной стороне (3024×4032 → 1200×1600)
//     ужимал калибровочный куб до 5-7 px, его клетка становилась субпиксельной.
// Canvas остался ТОЛЬКО для локального превью (сетка миниатюр + фото в
// PDF-отчёте); превью на сервер не уходит — там своя миниатюра, отдельным
// объектом в colmap_photos.thumb_url. Не возвращай сюда сжатие оригинала:
// вес пачки решается загрузкой, а не порчей исходника.

// Превью — только для UI и PDF.
export const PREVIEW_MAX     = 1024
export const PREVIEW_QUALITY = 0.8

// Форматы, которые уходят на сервер БАЙТ-В-БАЙТ. Всё, что вне списка (HEIC/HEIF
// и экзотика), пайплайн не читает — такие конвертируем в JPEG, но в ПОЛНОМ
// разрешении, без даунскейла.
const PASSTHROUGH_TYPES = /^image\/(jpe?g|png|webp)$/i

const EXT_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif',
}

// Тип файла: некоторые пикеры (часть Android-браузеров) отдают File с пустым
// type — тогда определяем по расширению, иначе бэкенд отобьёт «Не изображение».
function fileType(file) {
  if (file.type) return file.type
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return EXT_TYPES[ext] || ''
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
    img.src = url
  })
}

// Рисуем в canvas с ограничением по длинной стороне (Infinity = 1:1).
function toCanvas(img, maxDim) {
  let width = img.naturalWidth, height = img.naturalHeight
  if (width > maxDim || height > maxDim) {
    if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim }
    else                 { width  = Math.round(width * maxDim / height); height = maxDim }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d').drawImage(img, 0, 0, width, height)
  return canvas
}

/**
 * @returns {Promise<{blob: Blob, dataUrl: string, name: string,
 *                    width: number, height: number, sizeKb: number,
 *                    original: boolean}>}
 *   blob — то, что уйдёт на сервер (для JPEG/PNG/WebP это сам File),
 *   dataUrl — уменьшенное превью, остаётся на клиенте.
 */
export async function prepareImage(file) {
  const type   = fileType(file)
  const isHeic = /image\/hei[cf]/i.test(type) || /\.(heic|heif)$/i.test(file.name)
  if (!type.startsWith('image/') && !isHeic) {
    throw new Error(`Не изображение: ${file.name}`)
  }

  let img
  try {
    img = await loadImage(file)
  } catch {
    if (isHeic) throw new Error('HEIC не поддерживается браузером. Конвертируйте в JPG/PNG.')
    throw new Error(`Не удалось загрузить: ${file.name}`)
  }

  // naturalWidth/Height уже с учётом EXIF-ориентации (image-orientation:
  // from-image — дефолт во всех актуальных браузерах), как и drawImage.
  const width = img.naturalWidth, height = img.naturalHeight
  const dataUrl = toCanvas(img, PREVIEW_MAX).toDataURL('image/jpeg', PREVIEW_QUALITY)

  if (PASSTHROUGH_TYPES.test(type)) {
    // Оригинал как есть. File — тоже Blob, FormData отдаст его байты нетронутыми.
    // Пере-обёртка нужна, только когда пикер не проставил type (байты те же).
    const blob = file.type ? file : new File([file], file.name, { type })
    return {
      blob, dataUrl, name: file.name, width, height,
      sizeKb: Math.round(file.size / 1024), original: true,
    }
  }

  // HEIC/HEIF: пайплайн такие файлы не читает, поэтому конвертируем — но в
  // полном разрешении. EXIF при этом теряется, он уходит отдельным полем
  // exif_data (его парсит exifr из ОРИГИНАЛА, до конвертации).
  const blob = await new Promise((resolve, reject) => {
    toCanvas(img, Infinity).toBlob(
      b => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      0.95,
    )
  })
  return {
    blob, dataUrl, width, height,
    name: file.name.replace(/\.(heic|heif)$/i, '.jpg'),
    sizeKb: Math.round(blob.size / 1024), original: false,
  }
}
