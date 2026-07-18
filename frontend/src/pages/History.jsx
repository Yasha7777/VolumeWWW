import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import PlyViewer from '../components/PlyViewer';
import { subscribe, listQueue, retryItem, removeItem } from '../queue/queue'; // ← офлайн-очередь (PWA)

// Декор по бокам — base64 из отдельных файлов (Vite ?raw)
// декор загружается отдельными файлами из public/decor/*.png —
// не встраиваем ~550 KB base64 в JS-чанк History
const FLORA_LEFT  = '/decor/flora-left.png';
const FLORA_RIGHT = '/decor/flora-right.png';

/* ============================================================
   СОПОСТАВЛЕНИЕ ПОЛЕЙ API  ←—  правится здесь, в одном месте
   ------------------------------------------------------------
   Карточка показывает результат замера. Геттеры ниже сначала
   ищут структурированные поля, а если их нет — парсят число из
   текстового поля result. Если у тебя в API поля называются
   иначе — поменяй имена прямо в этих функциях.

   Ожидаемая запись (item):
     id          — id замера
     status      — 'completed' | 'error' | 'pending' (любой другой
                   статус трактуется как «в обработке»)
     created_at  — ISO-дата
     photo_urls  — string[]  (ссылки на фото)
     result      — текст результата (может содержать ссылку .glb)
     owner_name / owner_company — владелец замера (бэкенд добавляет
                   ТОЛЬКО суперадмину; обычному юзеру полей нет)
     // желательно структурой:
     material / material_type      — тип материала («Щебень 5–20»)
     site / object / warehouse     — объект/склад
     volume_m3 / volume            — объём, м³
     weight_t / weight / mass_t     — вес, т
     location / city               — строка локации  ИЛИ
     lat,lng (lat/latitude, lng/lon/longitude) — координаты из EXIF
     error / error_message / fail_reason — причина ошибки
   ============================================================ */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const parseMetric = (text, re) => {
  if (!text) return null;
  const m = String(text).match(re);
  return m ? num(m[1]) : null;
};

/* Материал приходит НЕ отдельным полем, а строкой внутри текста вебхука n8n:
   «🔍 Материал: Щебень 5–20». Достаём его оттуда. result может быть как
   простой строкой, так и JSON со вложенным dust3rBlock — обрабатываем оба.
   Пока ИИ-зрение выключено, материал = «Неизвестно» → возвращаем null,
   чтобы не подменять заголовок мусором. */
const materialFromResult = (raw) => {
  if (!raw) return null;
  let s = raw;
  if (typeof s === 'object') {
    s = s.dust3rBlock || s.json?.dust3rBlock || '';
  } else {
    const t = String(s).trim();
    if (t[0] === '{' || t[0] === '[') {
      try {
        let p = JSON.parse(t);
        if (Array.isArray(p)) p = p[0];
        s = p?.dust3rBlock || p?.json?.dust3rBlock || t;
      } catch {
        s = t;
      }
    }
  }
  const m = String(s).match(/Материал:\s*(.+)/u);
  if (!m) return null;
  const mat = m[1]
    .replace(/[*_`]/g, '')          // markdown-звёздочки из вебхука
    .replace(/^[^\p{L}\d]+/u, '')   // ведущие эмодзи/символы (❓ 🪨 …)
    .trim();
  if (!mat) return null;
  if (/^(неизвестн|unknown|n\/?a|нет данных|[—-])/iu.test(mat)) return null;
  return mat;
};

const getMaterial = (it) =>
  it.material || it.material_type || materialFromResult(it.result) || null;
const getSite = (it) => it.site || it.object || it.warehouse || null;

const getVolume = (it) =>
  num(it.volume_m3 ?? it.volume ?? it.result_volume) ??
  parseMetric(it.result, /([\d.,]+)\s*м[³3]/i);

const getWeight = (it) =>
  num(it.weight_t ?? it.weight ?? it.mass_t) ??
  // «6,2 т» / «6.2 тонн» — лукэхед, чтобы не цеплять «т» внутри слов
  parseMetric(it.result, /([\d.,]+)\s*(?:тонн[аы]?|т(?![а-яё]))/i);

const getLocation = (it) => {
  if (typeof it.location === 'string' && it.location.trim()) return it.location.trim();
  if (typeof it.place === 'string' && it.place.trim()) return it.place.trim();
  if (typeof it.gps_place === 'string' && it.gps_place.trim()) return it.gps_place.trim();
  if (typeof it.city === 'string' && it.city.trim()) return it.city.trim();
  const lat = num(it.lat ?? it.latitude);
  const lng = num(it.lng ?? it.lon ?? it.longitude);
  if (lat != null && lng != null) return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
  return null;
};

const getErrorReason = (it) =>
  it.error || it.error_message || it.fail_reason || 'Не удалось обработать фото. Попробуйте переснять штабель.';

const extractGlbUrl = (text) => {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/\S+\.glb/i);
  return m ? m[0] : null;
};

const extractPlyUrl = (text) => {
  if (!text) return null;
  const m = String(text).match(/https?:\/\/\S+\.ply/i);
  return m ? m[0] : null;
};

/* ---------- форматирование ---------- */
const fmtNum = (n) =>
  n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

const fmtDateLong = (iso) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

const fmtDateShort = (iso) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const zamerWord = (n) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return 'замеров';
  if (b > 1 && b < 5) return 'замера';
  if (b === 1) return 'замер';
  return 'замеров';
};

/* Название от пользователя имеет приоритет. «Без названия» — это заглушка
   из Analyze (title || 'Без названия'), поэтому считаем её за пустоту. */
const hasUserTitle = (it) => {
  const t = (it.title || '').trim();
  return !!t && t.toLowerCase() !== 'без названия';
};

const getHeading = (it) =>
  (hasUserTitle(it) ? it.title.trim() : null) ||  // 1) что ввёл пользователь
  getMaterial(it) ||                              // 2) материал из вебхука
  `Замер · ${fmtDateShort(it.created_at)}`;       // 3) дата как последний фолбэк

/* Подпись владельца (видна только суперадмину — у остальных полей просто нет) */
const getOwner = (it) => {
  const name = (it.owner_name || '').trim();
  const company = (it.owner_company || '').trim();
  if (name && company) return `${name} · ${company}`;
  return name || company || null;
};

const STATUS = {
  completed: { label: 'Готово', cls: 'is-done' },
  error: { label: 'Ошибка', cls: 'is-error' },
  pending: { label: 'В обработке', cls: 'is-pending' },
};
const metaFor = (s) => STATUS[s] || STATUS.pending;

/* ============================================================
   Иконки (stroke = currentColor)
   ============================================================ */
const PinIcon = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const UserIcon = ({ s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const TrashIcon = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const WarnIcon = ({ s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);
const SearchIcon = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
const CalIcon = ({ s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const RefreshIcon = ({ s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
  </svg>
);

const ChevronIcon = ({ s = 18 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/* ============================================================
   Лесной декор по бокам (base64-картинки из flora-*.txt)
   ============================================================ */
function Flora() {
  return createPortal(
    <>
      <div
        className="kh-flora kh-flora--left"
        aria-hidden="true"
        style={FLORA_LEFT ? { backgroundImage: `url(${FLORA_LEFT})` } : undefined}
      />
      <div
        className="kh-flora kh-flora--right"
        aria-hidden="true"
        style={FLORA_RIGHT ? { backgroundImage: `url(${FLORA_RIGHT})` } : undefined}
      />
    </>,
    document.body
  );
}

/* ============================================================
   Лайтбокс для фото (портал, навигация с клавиатуры)
   ============================================================ */
const navBtn = (side) => ({
  position: 'absolute',
  [side]: 28,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 52, height: 52,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(255,255,255,0.14)',
  color: '#fff',
  fontSize: 30, lineHeight: 1,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

// Фото лежат на другом origin (Supabase Storage), поэтому обычный <a download>
// их не скачает, а откроет. Тянем как blob и отдаём через object-URL; если
// CORS не даёт — мягкий фолбэк на открытие в новой вкладке.
async function downloadPhoto(url, filename) {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj; a.download = filename || 'photo.jpg';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function photoName(url, i) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    if (base && /\.\w+$/.test(base)) return base;
  } catch {}
  return `karelia-photo-${i + 1}.jpg`;
}

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

function Lightbox({ photos, index, onClose, onNav }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNav(1);
      else if (e.key === 'ArrowLeft') onNav(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onNav]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(26,26,10,0.86)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.2s ease both',
      }}
    >
      <img
        src={photos[index]}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw', maxHeight: '86vh',
          borderRadius: 12, objectFit: 'contain',
          boxShadow: '0 12px 60px rgba(0,0,0,0.5)',
        }}
      />
      {photos.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); onNav(-1); }} style={navBtn('left')} aria-label="Назад">‹</button>
          <button onClick={(e) => { e.stopPropagation(); onNav(1); }} style={navBtn('right')} aria-label="Вперёд">›</button>
          <div style={{
            position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)',
            color: '#fff', font: '500 14px/1 Onest, sans-serif',
            background: 'rgba(0,0,0,0.4)', padding: '6px 14px', borderRadius: 999,
          }}>
            {index + 1} / {photos.length}
          </div>
        </>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); downloadPhoto(photos[index], photoName(photos[index], index)); }}
        style={{ ...navBtn('right'), right: 84, top: 28, transform: 'none', width: 44, height: 44 }}
        aria-label="Скачать фото"
      ><DownloadIcon /></button>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{ ...navBtn('right'), right: 28, top: 28, transform: 'none', width: 44, height: 44 }}
        aria-label="Закрыть"
      >×</button>
    </div>,
    document.body
  );
}

/* ============================================================
   Мелкие части карточки
   ============================================================ */
function Stat({ label, value, unit, ok }) {
  return (
    <div className="kh-stat">
      <div className="kh-stat__label">{label}</div>
      <div className={`kh-stat__value${ok ? ' is-ok' : ''}`}>
        {value}
        {unit && <span className="kh-stat__unit">{unit}</span>}
      </div>
    </div>
  );
}

function Metric({ label, value, unit }) {
  return (
    <div>
      <div className="kh-metric__label">{label}</div>
      <div className="kh-metric__value">
        {value}
        {unit && <span className="kh-metric__unit">{unit}</span>}
      </div>
    </div>
  );
}

function Badge({ status }) {
  const m = metaFor(status);
  return (
    <span className={`kh-badge ${m.cls}`}>
      <span className="kh-bdot" />
      {m.label}
    </span>
  );
}

function ExpandedContent({ item, onPhoto }) {
  const photos = item.photo_urls || [];
  const thumbs = item.thumbnail_urls || [];
  const thumbAt = (i) => thumbs[i] || photos[i];

  const glb = extractGlbUrl(item.result);
  const ply = extractPlyUrl(item.result);
  const has3d = glb || ply;

  return (
    <div className="kh-expand">
      {item.result && <div className="kh-expand__result">{item.result}</div>}

      {photos.length > 0 && (
        <>
          <p className="kh-expand__sub">Фотографии</p>
          <div className="kh-expand__photos">
            {photos.map((url, i) => (
              <div key={i} className="kh-photo-cell">
                <img
                  className="kh-expand__photo"
                  src={thumbAt(i)}
                  alt=""
                  loading="lazy"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPhoto(photos, i);
                  }}
                />
                <button
                  type="button"
                  className="kh-photo-dl"
                  aria-label={`Скачать фото ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); downloadPhoto(url, photoName(url, i)); }}
                >
                  <DownloadIcon />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {has3d && (
        <>
          <p className="kh-expand__sub">3D-модель</p>

          <div className="kh-viewer">
            {glb ? (
              <PlyViewer glbUrl={glb} height="320px" />
            ) : (
              <PlyViewer plyUrl={ply} height="320px" />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MeasureCard({ item, expanded, deleting, onToggle, onPhoto, onDelete, index = 0 }) {
  const m = metaFor(item.status);
  const heading = getHeading(item);
  const site = getSite(item);
  const loc = getLocation(item);
  const owner = getOwner(item); // только у суперадмина — бэкенд подписывает владельца

  const photos = item.photo_urls || [];
  // У старых записей thumbnail_urls пуст → фолбэк на оригинал.
  // Лайтбокс и разворот всё равно используют photos (полный размер).
  const thumbs = item.thumbnail_urls || [];
  const thumbAt = (i) => thumbs[i] || photos[i];

  const volume = item.status === 'error' ? null : getVolume(item);
  const weight = item.status === 'error' ? null : getWeight(item);
  const hasMetrics = volume != null || weight != null || photos.length > 0;

  return (
    <div
      className={`kh-card${expanded ? ' is-open' : ''}`}
      style={{ animationDelay: `${Math.min(index * 0.04, 0.32)}s` }}
    >
      {/* Разворачивание реагирует ТОЛЬКО на шапку (этот блок).
          Раньше onClick висел на всей .kh-card — поэтому клик по вьюверу
          или выделение текста в развёрнутой части сворачивали карточку. */}
      <div className="kh-card__top" onClick={() => onToggle(item.id)}>
        <div className="kh-card__main">
          <div className="kh-card__title-row">
            <span className={`kh-card__dot ${m.cls}`} />
            <span className="kh-card__title">{heading}</span>
            <Badge status={item.status} />
          </div>

          <div className="kh-card__meta">
            {site && <span>{site}</span>}
            {site && <span className="kh-mdot">·</span>}
            <span>{fmtTime(item.created_at)}</span>
            {owner && <span className="kh-mdot">·</span>}
            {owner && (
              <span className="kh-card__owner"><UserIcon /> {owner}</span>
            )}
            {loc && <span className="kh-mdot">·</span>}
            {loc && (
              <span className="kh-card__loc"><PinIcon /> {loc}</span>
            )}
          </div>

          {item.status === 'error' ? (
            <div className="kh-card__error">
              <WarnIcon /> <span>{getErrorReason(item)}</span>
            </div>
          ) : item.status !== 'completed' ? (
            <div className="kh-card__pending">
              <span className="kh-spin" /> Идёт обработка — обновляется автоматически
            </div>
          ) : hasMetrics ? (
            <div className="kh-metrics">
              {volume != null && <Metric label="Объём" value={fmtNum(volume)} unit="м³" />}
              {weight != null && <Metric label="Вес" value={fmtNum(weight)} unit="т" />}
              {photos.length > 0 && <Metric label="Фото" value={photos.length} unit="шт." />}
            </div>
          ) : null}
        </div>

        <div className="kh-card__aside" onClick={(e) => e.stopPropagation()}>
          {photos.length > 0 && (
            <div className="kh-thumbs">
              {photos.slice(0, 3).map((url, i) => (
                <img
                  key={i}
                  className="kh-thumb"
                  src={thumbAt(i)}
                  alt=""
                  loading="lazy"
                  onClick={() => onPhoto(photos, i)}
                />
              ))}
              {photos.length > 3 && (
                <div className="kh-thumb-more">+{photos.length - 3}</div>
              )}
            </div>
          )}
          <button
            className="kh-del"
            onClick={(e) => onDelete(item.id, e)}
            disabled={deleting}
            title="Удалить замер"
            aria-label="Удалить замер"
          >
            {deleting ? <span className="kh-spin" /> : <TrashIcon />}
          </button>
        </div>

        <button
          type="button"
          className={`kh-chevron${expanded ? ' is-open' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle(item.id); }}
          aria-label={expanded ? 'Свернуть' : 'Развернуть'}
          aria-expanded={expanded}
        >
          <ChevronIcon />
        </button>
      </div>

      {expanded && <ExpandedContent item={item} onPhoto={onPhoto} />}
    </div>
  );
}

/* ============================================================
   Карточка локальной очереди (замеры, ещё НЕ ушедшие на сервер).
   Живёт только в PWA-очереди (IndexedDB). Фото показываем прямо
   из blob'ов через objectURL — сети для превью не нужно.
   ============================================================ */
function useQueueThumbs(item) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const made = (item.photos || []).slice(0, 3).map((p) => URL.createObjectURL(p.blob));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  return urls;
}

function QueueCard({ item, sending, onSend, onRemove }) {
  const thumbs = useQueueThumbs(item);
  const count = item.photos?.length || 0;
  const heading = (item.title || '').trim() || 'Черновик замера';
  const meta =
    item.status === 'sending' ? { label: 'Отправляется',   cls: 'is-pending' } :
    item.status === 'error'   ? { label: 'Ошибка отправки', cls: 'is-error'   } :
                                { label: 'Ждёт отправки',   cls: 'is-queued'  };
  const busy = sending || item.status === 'sending';

  return (
    <div className="kh-card kh-card--queue">
      <div className="kh-card__top" style={{ cursor: 'default' }}>
        <div className="kh-card__main">
          <div className="kh-card__title-row">
            <span className={`kh-card__dot ${meta.cls}`} />
            <span className="kh-card__title">{heading}</span>
            <span className={`kh-badge ${meta.cls}`}>
              <span className="kh-bdot" />
              {meta.label}
            </span>
          </div>

          <div className="kh-card__meta">
            <span>{fmtTime(item.createdAt)}</span>
            <span className="kh-mdot">·</span>
            <span>{count} фото</span>
          </div>

          {item.status === 'error' && item.lastError && (
            <div className="kh-card__error"><WarnIcon /> <span>{item.lastError}</span></div>
          )}

          <div className="kh-queue__actions">
            <button className="btn btn-primary btn-sm" onClick={() => onSend(item.id)} disabled={busy}>
              {busy ? <span className="kh-spin" /> : null} Отправить сейчас
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => onRemove(item.id)} disabled={busy}>
              Убрать
            </button>
          </div>
        </div>

        {thumbs.length > 0 && (
          <div className="kh-card__aside">
            <div className="kh-thumbs">
              {thumbs.map((u, i) => <img key={i} className="kh-thumb" src={u} alt="" />)}
              {count > 3 && <div className="kh-thumb-more">+{count - 3}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Swan() {
  // Онежский петроглиф — лебедь. Самая узнаваемо-карельская графика.
  // Силуэт собран из тела, толстой шеи (stroke со скруглёнными концами),
  // головы и клюва — в одном цвете они сливаются в цельную «выбитую в
  // камне» фигуру. Цвет берётся из currentColor (см. .kh-swan { color }).
  // Живёт только в пустом состоянии — на рабочем экране его нет, чтобы
  // не спорить с изолиниями в шапке.
  return (
    <svg
      viewBox="0 0 140 150"
      className="kh-swan"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* тело */}
      <path strokeWidth="1" d="M 97 88 C 100 76, 90 69, 72 69 C 55 69, 40 73, 32 83 C 27 91, 33 101, 47 105 C 62 109, 80 107, 89 99 C 95 94, 97 93, 97 88 Z" />
      {/* хвост */}
      <path strokeWidth="1" d="M 44 72 L 16 65 L 39 91 Z" />
      {/* шея */}
      <path fill="none" strokeWidth="12" d="M 89 81 C 96 60, 93 42, 101 30 C 104 25, 108 21, 111 19" />
      {/* голова */}
      <circle cx="112" cy="18" r="7.5" stroke="none" />
      {/* клюв */}
      <path strokeWidth="1" d="M 117 13 L 131 20 L 116 23 Z" />
    </svg>
  );
}

/* ============================================================
   Страница
   ============================================================ */
export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState({});
  const [lightbox, setLightbox] = useState(null); // { photos, index }

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // ── Суперадмин: просмотр чужих историй ──
  // adminUsers === null  → обычный пользователь, селектора нет
  // adminUsers === []    → админ, но профили ещё не пришли / пусто
  // userFilter: 'mine' | 'all' | <uuid пользователя>
  const [adminUsers, setAdminUsers] = useState(null);
  const [userFilter, setUserFilter] = useState('mine');

  // load() дёргают три места с разным временем жизни замыканий:
  // эффект на userFilter, 10-секундный поллинг и подписка на очередь.
  // Чтобы поллинг/подписка не утащили СТАРЫЙ userFilter из замыкания,
  // актуальное значение читаем через ref.
  const userFilterRef = useRef('mine');
  useEffect(() => { userFilterRef.current = userFilter; }, [userFilter]);

  // ── Локальная офлайн-очередь (PWA) ──
  const [queue, setQueue] = useState([]);
  const [sendingQ, setSendingQ] = useState({});

  const load = async () => {
    try {
      const uf = userFilterRef.current;
      const data = await api.listAnalyses(uf === 'mine' ? null : uf);
      setItems(Array.isArray(data) ? data : data?.items || []);
      setError(null);
    } catch (err) {
      setError(err?.message || 'Не удалось загрузить историю');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // детект прав: 200 → админ (рисуем селектор), 403/ошибка → обычный режим
  useEffect(() => {
    api.adminListUsers()
      .then((list) => setAdminUsers(Array.isArray(list) ? list : []))
      .catch(() => setAdminUsers(null));
  }, []);

  // первичная загрузка + перезагрузка при смене выбранного пользователя
  useEffect(() => {
    setLoading(true);
    setExpanded(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter]);

  // поллинг, пока есть необработанные замеры
  useEffect(() => {
    const hasPending = items.some(
      (it) => it.status !== 'completed' && it.status !== 'error'
    );
    if (!hasPending) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // подписка на очередь: любое изменение (добавили/отправили/удалили) →
  // перечитываем локальный список И дёргаем сервер (чтобы ушедший замер
  // сразу появился серверной строкой, без ожидания 10-секундного поллинга).
  useEffect(() => {
    const refreshQueue = async () => setQueue(await listQueue());
    refreshQueue();
    const unsub = subscribe(() => { refreshQueue(); load(); });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id) => setExpanded((cur) => (cur === id ? null : id));

  const openPhoto = (photos, index) => setLightbox({ photos, index });
  const navPhoto = (dir) =>
    setLightbox((lb) =>
      lb ? { ...lb, index: (lb.index + dir + lb.photos.length) % lb.photos.length } : lb
    );

  const deleteItem = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Удалить этот замер и все его фото?')) return;
    setDeleting((d) => ({ ...d, [id]: true }));
    try {
      await api.deleteAnalysis(id);
      setItems((list) => list.filter((x) => x.id !== id));
    } catch (err) {
      alert('Не удалось удалить замер: ' + (err?.message || 'ошибка сети'));
      setDeleting((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
    }
  };

  const refresh = () => {
    setRefreshing(true);
    load();
  };

  // ── действия над локальной очередью ──
  const sendNow = async (id) => {
    setSendingQ((s) => ({ ...s, [id]: true }));
    try { await retryItem(id); }
    catch (e) { alert('Не удалось отправить: ' + (e?.message || 'нет сети')); }
    finally { setSendingQ((s) => { const n = { ...s }; delete n[id]; return n; }); }
  };
  const removeFromQueue = async (id) => {
    if (!window.confirm('Убрать замер из очереди? Фото не отправятся.')) return;
    await removeItem(id);
  };

  // локальные, которых ещё нет на сервере (дедуп по id: серверная строка
  // побеждает — если она уже есть, локальную карточку не показываем).
  const serverIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const pendingQueue = useMemo(
    () => queue
      .filter((q) => !serverIds.has(q.id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [queue, serverIds]
  );

  // Очередь — это ТВОИ локальные черновики. В чужой истории («Все
  // пользователи» / конкретный юзер) она не показывается и не влияет
  // на пустые состояния.
  const visibleQueue = userFilter === 'mine' ? pendingQueue : [];

  // фильтрация + агрегаты + группировка
  const view = useMemo(() => {
    const fromT = from ? new Date(from + 'T00:00:00').getTime() : null;
    const toT = to ? new Date(to + 'T23:59:59.999').getTime() : null;
    const q = query.trim().toLowerCase();

    const inRange = (it) => {
      const t = new Date(it.created_at).getTime();
      if (fromT !== null && t < fromT) return false;
      if (toT !== null && t > toT) return false;
      return true;
    };
    const matchesQuery = (it) => {
      if (!q) return true;
      const hay = [
        getHeading(it), getSite(it), getLocation(it), getMaterial(it),
        it.title, it.notes,
        it.owner_name, it.owner_company, // админ может искать по владельцу
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    };

    const scoped = items.filter((it) => inRange(it) && matchesQuery(it));

    const counts = { all: scoped.length, completed: 0, error: 0, pending: 0 };
    for (const it of scoped) {
      if (it.status === 'completed') counts.completed++;
      else if (it.status === 'error') counts.error++;
      else counts.pending++;
    }

    let sumVol = 0;
    let sumWeight = 0;
    for (const it of scoped) {
      if (it.status !== 'completed') continue;
      const v = getVolume(it);
      if (v != null) sumVol += v;
      const w = getWeight(it);
      if (w != null) sumWeight += w;
    }

    const visible = scoped.filter((it) =>
      statusFilter === 'all' ? true : it.status === statusFilter
    );
    const sorted = [...visible].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const groups = [];
    const idx = {};
    for (const it of sorted) {
      const key = dayKey(it.created_at);
      if (idx[key] === undefined) {
        idx[key] = groups.length;
        groups.push({ key, date: it.created_at, items: [] });
      }
      groups[idx[key]].items.push(it);
    }

    return { counts, sumVol, sumWeight, groups };
  }, [items, query, from, to, statusFilter]);

  const tabs = [
    { key: 'all', label: 'Все', count: view.counts.all },
    { key: 'completed', label: 'Готово', count: view.counts.completed },
    { key: 'error', label: 'Ошибка', count: view.counts.error },
    { key: 'pending', label: 'В обработке', count: view.counts.pending },
  ];

  const userLabel = (u) =>
    (u.name || '').trim() ||
    (u.company || '').trim() ||
    `${u.id.slice(0, 8)}…`;

  return (
    <div className="page">
      <Flora />

      <div className="content">
        {/* шапка страницы: ВАЖНО — это div, а не <header>.
            В styles.css есть глобальный селектор `header { height:64px; position:sticky; ... }`
            для навбара сайта. Если сделать тут <header>, блок схватит и его, и .kh-head —
            высота схлопнется в 64px, overflow:hidden обрежет заголовок, и всё наедет. */}
        <div className="kh-head">
          <svg className="kh-head__art" viewBox="0 0 900 120" preserveAspectRatio="none">
            <path d="M0 92 C 150 70, 320 110, 520 84 C 700 62, 820 96, 900 78" />
            <path d="M0 70 C 160 52, 330 84, 540 62 C 720 44, 830 72, 900 56" />
            <path d="M0 50 C 170 36, 340 60, 560 42 C 730 28, 840 50, 900 38" />
            <path d="M0 32 C 180 22, 360 40, 580 26 C 740 16, 850 32, 900 24" />
            <path d="M0 16 C 190 10, 380 22, 600 12 C 750 6, 860 16, 900 12" />
          </svg>
          <div className="kh-head__text">
            <div className="kh-eyebrow">
              <span className="kh-eyebrow__dot" /> Карелия · Журнал замеров
            </div>
            <h1 className="kh-h1">История анализов</h1>
          </div>
          <div className="kh-head__actions">
            <button className="btn btn-secondary" onClick={refresh} disabled={refreshing}>
              {refreshing ? <span className="kh-spin" /> : <RefreshIcon />} Обновить
            </button>
          </div>
        </div>

        {/* сводка */}
        <div className="kh-stats">
          <Stat label="Замеров" value={view.counts.all} />
          <Stat label="Успешно" value={view.counts.completed} ok />
          <Stat label="Суммарный объём" value={fmtNum(view.sumVol)} unit="м³" />
          <Stat label="Суммарный вес" value={fmtNum(view.sumWeight)} unit="т" />
        </div>

        {/* фильтр по статусу */}
        <div className="kh-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`kh-tab${statusFilter === t.key ? ' active' : ''}`}
              onClick={() => setStatusFilter(t.key)}
            >
              {t.label} <span className="kh-tab__count">{t.count}</span>
            </button>
          ))}
        </div>

        {/* поиск + выбор пользователя (только суперадмин) + период */}
        <div className="kh-toolbar">
          <div className="kh-search">
            <SearchIcon />
            <input
              type="text"
              placeholder="Поиск по объекту или материалу"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {adminUsers && (
            <select
              className="kh-userpick"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              title="Чью историю показывать"
              aria-label="Чью историю показывать"
            >
              <option value="mine">Мои замеры</option>
              <option value="all">Все пользователи</option>
              {adminUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {userLabel(u)}
                </option>
              ))}
            </select>
          )}

          <div className="kh-range">
            <div className="kh-range__field">
              <CalIcon />
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <span className="kh-range__sep" />
            <div className="kh-range__field">
              <CalIcon />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Ожидают отправки (локальная офлайн-очередь) ──
            Показываем всегда сверху, даже пока грузится серверный список:
            это локальные данные, сеть для них не нужна.
            В режиме просмотра чужой истории секцию прячем (visibleQueue). */}
        {visibleQueue.length > 0 && (
          <section className="kh-group kh-group--queue">
            <div className="kh-group__head">
              <span className="kh-group__date">Ожидают отправки</span>
              <span className="kh-group__count">
                {visibleQueue.length} {zamerWord(visibleQueue.length)}
              </span>
            </div>
            {visibleQueue.map((it) => (
              <QueueCard
                key={it.id}
                item={it}
                sending={!!sendingQ[it.id]}
                onSend={sendNow}
                onRemove={removeFromQueue}
              />
            ))}
          </section>
        )}

        {/* контент */}
        {loading ? (
          <div className="kh-loading">
            <span className="spinner" /> Загружаем журнал замеров…
          </div>
        ) : error ? (
          <div className="status error">{error}</div>
        ) : items.length === 0 && visibleQueue.length === 0 ? (
          <div className="kh-empty">
            <Swan />
            <h2 className="kh-empty__title">
              {userFilter === 'mine'
                ? 'Здесь пока тихо, как на Онеге'
                : 'У этого пользователя пока нет замеров'}
            </h2>
            <p className="kh-empty__sub">
              {userFilter === 'mine'
                ? 'Загрузите фото штабеля на странице «Анализ» — и первый замер появится здесь.'
                : 'Как только он загрузит фото штабеля, замеры появятся в этом списке.'}
            </p>
          </div>
        ) : view.groups.length === 0 ? (
          // Серверных записей под фильтр не попало. Если при этом есть очередь —
          // не показываем «ничего не найдено», секция очереди уже видна выше.
          visibleQueue.length === 0 ? (
            <div className="kh-empty">
              <Swan />
              <h2 className="kh-empty__title">Ничего не найдено</h2>
              <p className="kh-empty__sub">
                Попробуйте изменить запрос, период или статус.
              </p>
            </div>
          ) : null
        ) : (
          view.groups.map((g) => (
            <section className="kh-group" key={g.key}>
              <div className="kh-group__head">
                <span className="kh-group__date">{fmtDateLong(g.date)}</span>
                <span className="kh-group__count">
                  {g.items.length} {zamerWord(g.items.length)}
                </span>
              </div>
              {g.items.map((item, i) => (
                <MeasureCard
                  key={item.id}
                  item={item}
                  index={i}
                  expanded={expanded === item.id}
                  deleting={!!deleting[item.id]}
                  onToggle={toggle}
                  onPhoto={openPhoto}
                  onDelete={deleteItem}
                />
              ))}
            </section>
          ))
        )}
      </div>

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNav={navPhoto}
        />
      )}
    </div>
  );
}
