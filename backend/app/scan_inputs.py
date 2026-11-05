"""Prepare a versioned, immutable input for the existing DUSt3R receiver.

No pose correction, invented visibility, densification or surface interpolation.
Extended observations qualify existing photo landmarks; their world coordinates
are deliberately preserved. The GPU still reads its usual frames/featurePoints.
"""
from collections import Counter
from copy import deepcopy
import hashlib
import json
import math


VERSION = 1
MAX_GPU_JSON_BYTES = 60 * 1024 * 1024  # receiver's existing limit


class ScanInputError(ValueError):
    """Actionable capture/input problem; do not submit inconsistent geometry."""


def _finite(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _distance(a, b):
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def geometry_report(scan):
    """Independent check, including old scans without capture.mapEvents.

Only physically implausible short-interval translations block submission.
Smaller jumps and long sampling gaps remain diagnostics, not point deletion.
"""
    cap = scan.get("capture") if isinstance(scan.get("capture"), dict) else {}
    tr = cap.get("trajectory") if isinstance(cap.get("trajectory"), dict) else {}
    events = []
    t, p = tr.get("tMs") or [], tr.get("positionMm") or []
    if isinstance(t, list) and isinstance(p, list) and len(p) == 3 * len(t):
        for i in range(1, len(t)):
            values = [t[i], t[i - 1], *p[3 * (i - 1):3 * (i + 1)]]
            if not all(_finite(v) for v in values):
                continue
            dt = (t[i] - t[i - 1]) / 1000
            if dt <= 0:
                continue
            step = _distance(p[3 * i:3 * i + 3], p[3 * (i - 1):3 * i]) / 1000
            if dt <= 0.2 and step > max(0.25, 4 * dt):
                events.append({"t_ms": t[i], "step_m": round(step, 4),
                               "dt_s": round(dt, 4),
                               "severe": step > max(0.5, 5 * dt)})
    # Device records the event even if a later exporter thins the trajectory.
    recorded = [e for e in cap.get("mapEvents") or []
                if isinstance(e, dict) and e.get("kind") == "translationJump"]
    severe = any(e["severe"] for e in events) or any(e.get("severe") is True for e in recorded)
    frame_epochs = cap.get("frameEpochs") or []
    distinct_epochs = set(e for e in frame_epochs if isinstance(e, int) and e >= 0) if isinstance(frame_epochs, list) else set()
    return {"events": events, "recorded_events": recorded, "coordinate_epochs": len(distinct_epochs),
            "blocked": severe or len(distinct_epochs) > 1}


def _dense_table(scan):
    """Malformed/missing optional telemetry never erases photo observations."""
    cap = scan.get("capture") if isinstance(scan.get("capture"), dict) else {}
    d = cap.get("densePoints") if isinstance(cap.get("densePoints"), dict) else {}
    ids = d.get("ids") or []
    required = ("count", "baselineMm", "spreadMm")
    if (not isinstance(ids, list) or not ids
            or any(not isinstance(d.get(k), list) or len(d[k]) != len(ids) for k in required)):
        return {}, "absent_or_malformed"
    segments = d.get("segment") or [0] * len(ids)
    epochs = d.get("epoch") or [0] * len(ids)
    if (not isinstance(segments, list) or not isinstance(epochs, list)
            or len(segments) != len(ids) or len(epochs) != len(ids)
            or any(not isinstance(v, int) or v < 0 for v in segments + epochs)):
        return {}, "malformed_namespace"
    table = {}
    for i, pid in enumerate(ids):
        if not isinstance(pid, (int, str)) or isinstance(pid, bool):
            continue
        key = (segments[i], epochs[i], str(pid))
        values = [d[k][i] for k in required]
        if not all(_finite(v) and v >= 0 for v in values):
            continue
        count, baseline, spread = values
        max_base = d.get("maxBaselineMm") or []
        if isinstance(max_base, list) and len(max_base) == len(ids) and _finite(max_base[i]):
            baseline = max(baseline, max_base[i])
        # Keep an unknown duplicate rather than arbitrarily trusting one record.
        if key in table:
            table[key] = None
        else:
            # A short track is not proof of a bad point: first photographs can
            # contain valid landmarks observed before high-rate recording began.
            # Reject only measured instability with enough supporting history.
            table[key] = (spread <= 150) if count >= 8 and baseline >= 50 else None
    return table, "available"


def _same_numbers(a, b):
    return (isinstance(a, list) and isinstance(b, list) and len(a) == len(b)
            and all(_finite(x) and _finite(y) and abs(x - y) <= 1e-6 for x, y in zip(a, b)))


def prepare(scan, rows):
    """Return (derived scan, copied DB rows, report); never mutate originals.

Rows are the exact photo list to submit. Keep their order and IDs. Source frames
not in this list are excluded, so the GPU cannot use hidden rejected segments
when it builds its scene cloud from *all* frames in scan.json.
"""
    if not isinstance(scan, dict) or not isinstance(scan.get("frames"), list):
        raise ScanInputError("Не удалось прочитать кадры обхода. Исходные данные сохранены.")
    geometry = geometry_report(scan)
    if geometry["blocked"]:
        raise ScanInputError("В обходе обнаружен резкий скачок координат ARKit. "
                             "Все фото и точки сохранены, но расчёт с закреплёнными позами "
                             "нельзя считать надёжным. Нужен повторный обход без скачка карты.")
    source = {}
    for f in scan["frames"]:
        if not isinstance(f, dict) or not isinstance(f.get("index"), int) or f["index"] in source:
            raise ScanInputError("В обходе некорректные или повторяющиеся номера кадров.")
        source[f["index"]] = f
    cap = scan.get("capture") if isinstance(scan.get("capture"), dict) else {}
    frame_epochs = cap.get("frameEpochs")
    if frame_epochs is not None and (not isinstance(frame_epochs, list) or len(frame_epochs) != len(scan["frames"])):
        raise ScanInputError("Повреждены сведения об участках координат обхода. Исходники сохранены.")
    epochs = dict(zip((f["index"] for f in scan["frames"]), frame_epochs)) if (
        isinstance(frame_epochs, list) and len(frame_epochs) == len(scan["frames"])) else {}
    if epochs and any(not isinstance(e, int) or e < 0 for e in epochs.values()):
        raise ScanInputError("Не определена система координат части кадров. Исходный обход сохранён.")
    dense, dense_state = _dense_table(scan)
    prepared_rows, prepared_frames = [], []
    seen = set()
    namespaces = set()
    counts = Counter()
    remap = {}
    for row in rows:
        idx = row.get("frame_index")
        if idx not in source or idx in seen:
            raise ScanInputError("Список фотографий не совпадает с номерами кадров обхода.")
        seen.add(idx)
        f = deepcopy(source[idx])
        arkit = row.get("arkit") or {}
        for field in ("cameraTransform", "intrinsics"):
            if field in arkit and not _same_numbers(arkit[field], f.get(field)):
                raise ScanInputError("Позы или параметры камеры в БД отличаются от исходного обхода.")
        if "timestamp" in arkit and (not _finite(arkit["timestamp"]) or not _finite(f.get("timestamp"))
                                      or abs(arkit["timestamp"] - f["timestamp"]) > 0.001):
            raise ScanInputError("Время фотографии в БД отличается от исходного обхода.")
        seg, epoch = f.get("trackingSegment", 0), epochs.get(idx, 0)
        if not isinstance(seg, int) or seg < 0:
            raise ScanInputError("Некорректный номер участка трекинга в обходе.")
        namespaces.add((seg, epoch))
        ids, pts = f.get("featurePointIdentifiers") or [], f.get("featurePoints") or []
        if pts and len(pts) % 3:
            raise ScanInputError("Повреждён массив точек кадра обхода.")
        qualified = len(ids) == len(pts) // 3
        kept_pts, kept_ids = [], []
        for j in range(len(pts) // 3):
            counts["observations_before"] += 1
            point = pts[j * 3:j * 3 + 3]
            if not all(_finite(v) for v in point):
                counts["nonfinite_removed"] += 1
                continue
            pid = ids[j] if qualified else None
            key = (seg, epoch, str(pid))
            trusted = dense.get(key) if qualified else None
            if trusted is False:
                counts["dense_rejected"] += 1
                continue
            counts["dense_supported" if trusted is True else "unassessed_kept"] += 1
            kept_pts.extend(point)
            if qualified:
                # Small exact integers avoid JS uint64 rounding and collisions
                # between tracking namespaces. Same landmark keeps the same ID.
                if key not in remap:
                    remap[key] = len(remap) + 1
                kept_ids.append(remap[key])
        f["featurePoints"] = kept_pts
        f["featurePointCount"] = len(kept_pts) // 3
        f["featurePointIdentifiers"] = kept_ids if qualified else None
        # Sync both transports from the same immutable source frame.
        out_row = deepcopy(row)
        camera_fields = ("cameraTransform", "intrinsics", "timestamp", "width", "height", "featurePointCount",
                         "trackingSegment", "trackingState", "trackingReason", "axes")
        out_row["arkit"] = {**arkit, **{k: f[k] for k in camera_fields if k in f}}
        prepared_rows.append(out_row)
        prepared_frames.append(f)
    if len(namespaces) > 1:
        raise ScanInputError("В обходе несколько участков координат ARKit. Все наблюдения сохранены; "
                             "для расчёта нужен согласованный обход в одной системе координат.")
    if not prepared_frames:
        raise ScanInputError("В обходе нет кадров для расчёта.")
    before = counts["observations_before"]
    rejected = counts["dense_rejected"] + counts["nonfinite_removed"]
    if before and rejected > 0.25 * before:
        raise ScanInputError("Более четверти наблюдений не прошли проверку точек ARKit. "
                             "Исходники сохранены; расчёт остановлен, чтобы не скрыть потерю покрытия.")
    # Do not copy high-rate raw/history into the receiver's 60 MB input.
    # It stays in the original scan.json; only measured photo associations go in.
    derived = {k: deepcopy(v) for k, v in scan.items() if k not in ("frames", "capture")}
    derived["frames"] = prepared_frames
    derived["frameCount"] = len(prepared_frames)
    report = {"version": VERSION, "dense": dense_state, "counts": dict(counts),
              "geometry": geometry, "poses_changed": False, "points_added": 0,
              "coordinate_policy": "original_world_coordinates",
              "source_sha256": hashlib.sha256(json.dumps(scan, sort_keys=True, separators=(",", ":"),
                                                        ensure_ascii=False).encode()).hexdigest()}
    derived["preparation"] = report
    return derived, prepared_rows, report


def store_prepared(storage, scan_meta, rows, analysis_id):
    """Run on a worker thread. Upload the derivative before publishing its path."""
    prefix = scan_meta.get("storage_prefix")
    if not prefix:
        raise ScanInputError("У обхода отсутствует путь к исходным данным.")
    try:
        raw = storage.download(f"{prefix}/scan.json")
        source = json.loads(raw)
    except Exception as exc:
        raise ScanInputError("Не удалось загрузить исходные точки обхода. Повторите расчёт позже.") from exc
    if (isinstance(source, dict) and source.get("id") and scan_meta.get("id")
            and str(source["id"]).lower() != str(scan_meta["id"]).lower()):
        raise ScanInputError("Файл точек относится к другому обходу. Расчёт не запущен.")
    derived, prepared_rows, report = prepare(source, rows)
    encoded = json.dumps(derived, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    if len(encoded) > MAX_GPU_JSON_BYTES:
        raise ScanInputError("Подготовленные данные превышают лимит приёмника GPU. Исходники сохранены.")
    digest = hashlib.sha256(encoded).hexdigest()
    path = f"{prefix}/prepared/v{VERSION}/{analysis_id}/{digest}.json"
    try:
        storage.upload(path, encoded, {"content-type": "application/json", "x-upsert": "true", "upsert": "true"})
    except Exception as exc:
        raise ScanInputError("Не удалось сохранить подготовленные точки. Повторите расчёт позже.") from exc
    meta = {**scan_meta, "prepared_scan_json_path": path}
    return meta, prepared_rows, report
