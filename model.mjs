export const SCHEMA_VERSION = "coral-annotations/v2";
export const LEGACY_SCHEMA_VERSION = "coral-scribbles/v1";
export const DOTS_PER_IMAGE = 50;

export const CLASS_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "rubble", name: "Rubble", training_value: 1, color: "#26966d" }),
  Object.freeze({ id: "sediment", name: "Sediment", training_value: 2, color: "#e3b52f" }),
  Object.freeze({ id: "unsure", name: "Unsure", training_value: null, color: "#36a2bd" }),
]);

export const DOT_CLASS_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "live", name: "Live", training_value: 0, color: "#df5f7a", hotkey: "L" }),
  Object.freeze({ id: "dsc", name: "DSC", training_value: 1, color: "#4f7fd8", hotkey: "D" }),
  Object.freeze({ id: "rubble", name: "Rubble", training_value: 2, color: "#26966d", hotkey: "R" }),
  Object.freeze({ id: "sediment", name: "Sediment", training_value: 3, color: "#e3b52f", hotkey: "S" }),
  Object.freeze({
    id: "unknown_other",
    name: "Unknown / other",
    training_value: 4,
    color: "#7d8986",
    hotkey: "U",
  }),
]);

const CLASS_IDS = new Set(CLASS_DEFINITIONS.map((item) => item.id));
const DOT_CLASS_IDS = new Set(DOT_CLASS_DEFINITIONS.map((item) => item.id));
const SUPPORTED_SCHEMA_VERSIONS = new Set([SCHEMA_VERSION, LEGACY_SCHEMA_VERSION]);
const ANNOTATION_MODES = new Set(["dot", "scribble"]);
const REVIEW_STATES = new Set(["unreviewed", "in_progress", "reviewed"]);

function utcNow() {
  return new Date().toISOString();
}

export function randomId(prefix = "id") {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  const randomPart = Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now().toString(36)}_${randomPart}`;
}

export function naturalCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function createSession(datasetName = "Untitled dataset") {
  const now = utcNow();
  return {
    schema_version: SCHEMA_VERSION,
    session_id: randomId("session"),
    dataset_name: datasetName,
    annotator: "",
    annotation_mode: "dot",
    dot_target_count: DOTS_PER_IMAGE,
    created_at_utc: now,
    updated_at_utc: now,
    classes: CLASS_DEFINITIONS.map((item) => ({ ...item })),
    dot_classes: DOT_CLASS_DEFINITIONS.map((item) => ({ ...item })),
    images: {},
  };
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanPoint(point) {
  if (!Array.isArray(point) || point.length < 2) {
    return null;
  }
  const x = finiteNumber(point[0], NaN);
  const y = finiteNumber(point[1], NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return [x, y, Math.max(0, finiteNumber(point[2], 0))];
}

function cleanStroke(stroke) {
  if (!stroke || !CLASS_IDS.has(stroke.class_id)) {
    return null;
  }
  const points = Array.isArray(stroke.points)
    ? stroke.points.map(cleanPoint).filter(Boolean)
    : [];
  if (points.length === 0) {
    return null;
  }
  return {
    id: String(stroke.id || randomId("stroke")),
    class_id: stroke.class_id,
    brush_diameter_px: Math.max(1, finiteNumber(stroke.brush_diameter_px, 24)),
    created_at_utc: String(stroke.created_at_utc || utcNow()),
    points,
  };
}

function cleanDot(dot, fallbackIndex = 0) {
  if (!dot || typeof dot !== "object") {
    return null;
  }
  const x = finiteNumber(dot.x, NaN);
  const y = finiteNumber(dot.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const classId = DOT_CLASS_IDS.has(dot.class_id) ? dot.class_id : null;
  return {
    id: String(dot.id || randomId("dot")),
    index: Math.max(0, Math.round(finiteNumber(dot.index, fallbackIndex))),
    x,
    y,
    class_id: classId,
    classified_at_utc: classId && dot.classified_at_utc
      ? String(dot.classified_at_utc)
      : null,
  };
}

function cleanImageRecord(record, fallbackPath = "") {
  const relativePath = String(record?.relative_path || fallbackPath || record?.name || "");
  if (!relativePath) {
    return null;
  }
  const reviewStatus = REVIEW_STATES.has(record.review_status)
    ? record.review_status
    : "unreviewed";
  const strokes = Array.isArray(record.strokes)
    ? record.strokes.map(cleanStroke).filter(Boolean)
    : [];
  const dots = Array.isArray(record.dots)
    ? record.dots.map(cleanDot).filter(Boolean).sort((left, right) => left.index - right.index)
    : [];
  return {
    relative_path: relativePath,
    name: String(record.name || relativePath.split("/").pop()),
    width: Math.max(0, Math.round(finiteNumber(record.width, 0))),
    height: Math.max(0, Math.round(finiteNumber(record.height, 0))),
    file_size: Math.max(0, Math.round(finiteNumber(record.file_size, 0))),
    last_modified: Math.max(0, Math.round(finiteNumber(record.last_modified, 0))),
    review_status: reviewStatus,
    reviewed_at_utc: record.reviewed_at_utc ? String(record.reviewed_at_utc) : null,
    notes: String(record.notes || ""),
    strokes,
    dots,
  };
}

export function normalizeSession(rawDocument) {
  if (!rawDocument || typeof rawDocument !== "object") {
    throw new Error("Annotation data is not an object.");
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.has(rawDocument.schema_version)) {
    throw new Error(`Unsupported annotation schema: ${rawDocument.schema_version || "missing"}`);
  }

  const session = createSession(String(rawDocument.dataset_name || "Imported dataset"));
  session.session_id = String(rawDocument.session_id || session.session_id);
  session.annotator = String(rawDocument.annotator || "");
  session.annotation_mode = ANNOTATION_MODES.has(rawDocument.annotation_mode)
    ? rawDocument.annotation_mode
    : rawDocument.schema_version === LEGACY_SCHEMA_VERSION ? "scribble" : "dot";
  session.dot_target_count = Math.max(
    1,
    Math.round(finiteNumber(rawDocument.dot_target_count, DOTS_PER_IMAGE)),
  );
  session.created_at_utc = String(rawDocument.created_at_utc || session.created_at_utc);
  session.updated_at_utc = String(rawDocument.updated_at_utc || session.updated_at_utc);
  session.images = {};

  const imageEntries = Array.isArray(rawDocument.images)
    ? rawDocument.images.map((record) => [record?.relative_path, record])
    : Object.entries(rawDocument.images || {});

  for (const [path, rawRecord] of imageEntries) {
    const record = cleanImageRecord(rawRecord, path);
    if (record) {
      session.images[record.relative_path] = record;
    }
  }
  return session;
}

export function ensureImage(session, descriptor) {
  const relativePath = String(descriptor.relative_path || descriptor.name || "");
  if (!relativePath) {
    throw new Error("Image descriptor has no relative path.");
  }
  if (!session.images[relativePath]) {
    session.images[relativePath] = cleanImageRecord({
      relative_path: relativePath,
      name: descriptor.name,
      width: descriptor.width,
      height: descriptor.height,
      file_size: descriptor.file_size,
      last_modified: descriptor.last_modified,
      review_status: "unreviewed",
      strokes: [],
      dots: [],
    });
  } else {
    const record = session.images[relativePath];
    record.name = String(descriptor.name || record.name);
    record.width = Math.max(0, Math.round(finiteNumber(descriptor.width, record.width)));
    record.height = Math.max(0, Math.round(finiteNumber(descriptor.height, record.height)));
    record.file_size = Math.max(0, Math.round(finiteNumber(descriptor.file_size, record.file_size)));
    record.last_modified = Math.max(0, Math.round(finiteNumber(descriptor.last_modified, record.last_modified)));
  }
  return session.images[relativePath];
}

export function imageStrokeCounts(imageRecord) {
  const counts = { rubble: 0, sediment: 0, unsure: 0, total: 0 };
  for (const stroke of imageRecord?.strokes || []) {
    if (Object.hasOwn(counts, stroke.class_id)) {
      counts[stroke.class_id] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

export function ensureDotQueries(
  imageRecord,
  targetCount = DOTS_PER_IMAGE,
  random = Math.random,
) {
  if (!imageRecord || imageRecord.width <= 0 || imageRecord.height <= 0) {
    return [];
  }
  if (!Array.isArray(imageRecord.dots)) {
    imageRecord.dots = [];
  }
  const target = Math.max(1, Math.round(finiteNumber(targetCount, DOTS_PER_IMAGE)));
  const usedIndexes = new Set(imageRecord.dots.map((dot) => dot.index));
  let nextIndex = 0;
  while (imageRecord.dots.length < target) {
    while (usedIndexes.has(nextIndex)) {
      nextIndex += 1;
    }
    imageRecord.dots.push({
      id: randomId("dot"),
      index: nextIndex,
      x: Math.max(0, Math.min(imageRecord.width - 1, random() * imageRecord.width)),
      y: Math.max(0, Math.min(imageRecord.height - 1, random() * imageRecord.height)),
      class_id: null,
      classified_at_utc: null,
    });
    usedIndexes.add(nextIndex);
    nextIndex += 1;
  }
  imageRecord.dots.sort((left, right) => left.index - right.index);
  return imageRecord.dots;
}

function percentage(numerator, denominator) {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export function imageDotSummary(imageRecord, targetCount = DOTS_PER_IMAGE) {
  const target = Math.max(1, Math.round(finiteNumber(targetCount, DOTS_PER_IMAGE)));
  const counts = Object.fromEntries(DOT_CLASS_DEFINITIONS.map(({ id }) => [id, 0]));
  const dots = (imageRecord?.dots || [])
    .slice()
    .sort((left, right) => left.index - right.index)
    .slice(0, target);
  for (const dot of dots) {
    if (DOT_CLASS_IDS.has(dot.class_id)) {
      counts[dot.class_id] += 1;
    }
  }
  const classifiedCount = Object.values(counts).reduce((total, count) => total + count, 0);
  const unknownCount = counts.unknown_other;
  const knownCount = classifiedCount - unknownCount;
  const complete = dots.length >= target && classifiedCount >= target;
  const unknownFraction = percentage(unknownCount, classifiedCount);
  const eligible = complete && unknownCount <= target / 2;
  const imagePercent = Object.fromEntries(
    DOT_CLASS_DEFINITIONS.map(({ id }) => [id, percentage(counts[id], classifiedCount)]),
  );
  const usablePercent = Object.fromEntries(
    DOT_CLASS_DEFINITIONS
      .filter(({ id }) => id !== "unknown_other")
      .map(({ id }) => [id, percentage(counts[id], knownCount)]),
  );
  return {
    target_count: target,
    generated_count: dots.length,
    classified_count: classifiedCount,
    known_count: knownCount,
    counts,
    complete,
    eligible,
    unknown_fraction: unknownFraction == null ? null : unknownFraction / 100,
    image_percent: imagePercent,
    usable_percent: usablePercent,
  };
}

export function sessionDotSummary(session, imagePaths = null) {
  const paths = imagePaths || Object.keys(session.images);
  const imageSummaries = paths
    .map((path) => ({ path, summary: imageDotSummary(session.images[path], session.dot_target_count) }));
  const eligible = imageSummaries.filter(({ summary }) => summary.eligible);
  const pooledCounts = Object.fromEntries(DOT_CLASS_DEFINITIONS.map(({ id }) => [id, 0]));
  const meanUsablePercent = Object.fromEntries(
    DOT_CLASS_DEFINITIONS
      .filter(({ id }) => id !== "unknown_other")
      .map(({ id }) => [id, null]),
  );
  for (const { summary } of eligible) {
    for (const classId of Object.keys(pooledCounts)) {
      pooledCounts[classId] += summary.counts[classId];
    }
  }
  for (const classId of Object.keys(meanUsablePercent)) {
    const values = eligible
      .map(({ summary }) => summary.usable_percent[classId])
      .filter((value) => value != null);
    meanUsablePercent[classId] = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : null;
  }
  const pooledClassified = Object.values(pooledCounts).reduce((total, count) => total + count, 0);
  const pooledKnown = pooledClassified - pooledCounts.unknown_other;
  const pooledImagePercent = Object.fromEntries(
    DOT_CLASS_DEFINITIONS.map(({ id }) => [id, percentage(pooledCounts[id], pooledClassified)]),
  );
  const pooledUsablePercent = Object.fromEntries(
    Object.keys(meanUsablePercent).map((id) => [id, percentage(pooledCounts[id], pooledKnown)]),
  );
  const completeCount = imageSummaries.filter(({ summary }) => summary.complete).length;
  return {
    image_count: imageSummaries.length,
    complete_image_count: completeCount,
    eligible_image_count: eligible.length,
    excluded_image_count: completeCount - eligible.length,
    incomplete_image_count: imageSummaries.length - completeCount,
    pooled_counts: pooledCounts,
    pooled_image_percent: pooledImagePercent,
    pooled_usable_percent: pooledUsablePercent,
    mean_usable_percent: meanUsablePercent,
  };
}

export function summarizeSession(session, imagePaths = null) {
  const paths = imagePaths || Object.keys(session.images);
  const summary = {
    image_count: paths.length,
    reviewed_count: 0,
    in_progress_count: 0,
    stroke_count: 0,
    point_count: 0,
    class_strokes: { rubble: 0, sediment: 0, unsure: 0 },
    dot_complete_image_count: 0,
    dot_classified_count: 0,
  };

  for (const path of paths) {
    const record = session.images[path];
    if (!record) {
      continue;
    }
    if (record.review_status === "reviewed") {
      summary.reviewed_count += 1;
    } else if (record.review_status === "in_progress") {
      summary.in_progress_count += 1;
    }
    for (const stroke of record.strokes) {
      summary.stroke_count += 1;
      summary.point_count += stroke.points.length;
      if (Object.hasOwn(summary.class_strokes, stroke.class_id)) {
        summary.class_strokes[stroke.class_id] += 1;
      }
    }
    const dotSummary = imageDotSummary(record, session.dot_target_count);
    summary.dot_complete_image_count += dotSummary.complete ? 1 : 0;
    summary.dot_classified_count += dotSummary.classified_count;
  }
  return summary;
}

export function documentForExport(session) {
  const normalized = normalizeSession({
    ...session,
    updated_at_utc: utcNow(),
  });
  const sortedImages = {};
  for (const path of Object.keys(normalized.images).sort(naturalCompare)) {
    sortedImages[path] = normalized.images[path];
  }
  normalized.images = sortedImages;
  return normalized;
}

function safeSpreadsheetText(value) {
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function restoreSpreadsheetText(value) {
  const text = value == null ? "" : String(value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function csvCell(value) {
  const text = safeSpreadsheetText(value).replaceAll('"', '""');
  return `"${text}"`;
}

function csvMetric(value) {
  return value == null ? "" : Number(value.toFixed(6));
}

export function sessionToCsv(session) {
  const document = documentForExport(session);
  const headers = [
    "record_type",
    "schema_version",
    "session_id",
    "dataset_name",
    "annotator",
    "annotation_mode",
    "session_dot_target_count",
    "session_created_at_utc",
    "session_updated_at_utc",
    "image_relative_path",
    "image_name",
    "image_width",
    "image_height",
    "file_size",
    "last_modified",
    "review_status",
    "reviewed_at_utc",
    "image_notes",
    "stroke_id",
    "class_id",
    "training_value",
    "brush_diameter_px",
    "stroke_created_at_utc",
    "point_index",
    "x",
    "y",
    "elapsed_ms",
    "dot_id",
    "dot_index",
    "dot_x",
    "dot_y",
    "dot_class_id",
    "dot_training_value",
    "dot_classified_at_utc",
    "dot_target_count",
    "dot_generated_count",
    "dot_classified_count",
    "dot_known_count",
    "dot_complete",
    "dot_eligible_for_cover",
    "live_count",
    "dsc_count",
    "rubble_count",
    "sediment_count",
    "unknown_other_count",
    "live_pct_image",
    "dsc_pct_image",
    "rubble_pct_image",
    "sediment_pct_image",
    "unknown_other_pct_image",
    "live_pct_usable",
    "dsc_pct_usable",
    "rubble_pct_usable",
    "sediment_pct_usable",
    "dataset_image_count",
    "dataset_complete_image_count",
    "dataset_eligible_image_count",
    "dataset_excluded_image_count",
    "dataset_incomplete_image_count",
    "mean_live_pct_usable",
    "mean_dsc_pct_usable",
    "mean_rubble_pct_usable",
    "mean_sediment_pct_usable",
  ];
  const rows = [headers.map(csvCell).join(",")];
  const strokeClassValue = Object.fromEntries(
    CLASS_DEFINITIONS.map((definition) => [definition.id, definition.training_value]),
  );
  const dotClassValue = Object.fromEntries(
    DOT_CLASS_DEFINITIONS.map((definition) => [definition.id, definition.training_value]),
  );
  const csvRow = (values) => headers.map((header) => csvCell(values[header] ?? "")).join(",");
  const sessionValues = {
    schema_version: document.schema_version,
    session_id: document.session_id,
    dataset_name: document.dataset_name,
    annotator: document.annotator,
    annotation_mode: document.annotation_mode,
    session_dot_target_count: document.dot_target_count,
    session_created_at_utc: document.created_at_utc,
    session_updated_at_utc: document.updated_at_utc,
  };
  const imageValues = (record) => ({
    image_relative_path: record.relative_path,
    image_name: record.name,
    image_width: record.width,
    image_height: record.height,
    file_size: record.file_size,
    last_modified: record.last_modified,
    review_status: record.review_status,
    reviewed_at_utc: record.reviewed_at_utc || "",
    image_notes: record.notes,
  });
  const dotSummaryValues = (summary) => ({
    dot_target_count: summary.target_count,
    dot_generated_count: summary.generated_count,
    dot_classified_count: summary.classified_count,
    dot_known_count: summary.known_count,
    dot_complete: summary.complete,
    dot_eligible_for_cover: summary.eligible,
    live_count: summary.counts.live,
    dsc_count: summary.counts.dsc,
    rubble_count: summary.counts.rubble,
    sediment_count: summary.counts.sediment,
    unknown_other_count: summary.counts.unknown_other,
    live_pct_image: csvMetric(summary.image_percent.live),
    dsc_pct_image: csvMetric(summary.image_percent.dsc),
    rubble_pct_image: csvMetric(summary.image_percent.rubble),
    sediment_pct_image: csvMetric(summary.image_percent.sediment),
    unknown_other_pct_image: csvMetric(summary.image_percent.unknown_other),
    live_pct_usable: csvMetric(summary.usable_percent.live),
    dsc_pct_usable: csvMetric(summary.usable_percent.dsc),
    rubble_pct_usable: csvMetric(summary.usable_percent.rubble),
    sediment_pct_usable: csvMetric(summary.usable_percent.sediment),
  });

  for (const record of Object.values(document.images)) {
    const common = { ...sessionValues, ...imageValues(record) };
    const dotSummary = imageDotSummary(record, document.dot_target_count);
    rows.push(csvRow({
      record_type: "image",
      ...common,
      ...dotSummaryValues(dotSummary),
    }));

    for (const stroke of record.strokes) {
      stroke.points.forEach((point, pointIndex) => {
        rows.push(csvRow({
          record_type: "point",
          ...common,
          stroke_id: stroke.id,
          class_id: stroke.class_id,
          training_value: strokeClassValue[stroke.class_id] ?? "",
          brush_diameter_px: stroke.brush_diameter_px,
          stroke_created_at_utc: stroke.created_at_utc,
          point_index: pointIndex,
          x: point[0],
          y: point[1],
          elapsed_ms: point[2] || 0,
        }));
      });
    }
    for (const dot of record.dots) {
      rows.push(csvRow({
        record_type: "dot",
        ...common,
        dot_id: dot.id,
        dot_index: dot.index,
        dot_x: dot.x,
        dot_y: dot.y,
        dot_class_id: dot.class_id || "",
        dot_training_value: dot.class_id ? dotClassValue[dot.class_id] : "",
        dot_classified_at_utc: dot.classified_at_utc || "",
      }));
    }
  }
  const datasetSummary = sessionDotSummary(document);
  rows.push(csvRow({
    record_type: "dataset_summary",
    ...sessionValues,
    live_count: datasetSummary.pooled_counts.live,
    dsc_count: datasetSummary.pooled_counts.dsc,
    rubble_count: datasetSummary.pooled_counts.rubble,
    sediment_count: datasetSummary.pooled_counts.sediment,
    unknown_other_count: datasetSummary.pooled_counts.unknown_other,
    live_pct_image: csvMetric(datasetSummary.pooled_image_percent.live),
    dsc_pct_image: csvMetric(datasetSummary.pooled_image_percent.dsc),
    rubble_pct_image: csvMetric(datasetSummary.pooled_image_percent.rubble),
    sediment_pct_image: csvMetric(datasetSummary.pooled_image_percent.sediment),
    unknown_other_pct_image: csvMetric(datasetSummary.pooled_image_percent.unknown_other),
    live_pct_usable: csvMetric(datasetSummary.pooled_usable_percent.live),
    dsc_pct_usable: csvMetric(datasetSummary.pooled_usable_percent.dsc),
    rubble_pct_usable: csvMetric(datasetSummary.pooled_usable_percent.rubble),
    sediment_pct_usable: csvMetric(datasetSummary.pooled_usable_percent.sediment),
    dataset_image_count: datasetSummary.image_count,
    dataset_complete_image_count: datasetSummary.complete_image_count,
    dataset_eligible_image_count: datasetSummary.eligible_image_count,
    dataset_excluded_image_count: datasetSummary.excluded_image_count,
    dataset_incomplete_image_count: datasetSummary.incomplete_image_count,
    mean_live_pct_usable: csvMetric(datasetSummary.mean_usable_percent.live),
    mean_dsc_pct_usable: csvMetric(datasetSummary.mean_usable_percent.dsc),
    mean_rubble_pct_usable: csvMetric(datasetSummary.mean_usable_percent.rubble),
    mean_sediment_pct_usable: csvMetric(datasetSummary.mean_usable_percent.sediment),
  }));
  return `${rows.join("\n")}\n`;
}

function parseCsvRows(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field.");
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvNumber(value, label, fallback = null) {
  if (value === "" && fallback !== null) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`CSV has an invalid ${label}: ${value || "blank"}`);
  }
  return numeric;
}

export function sessionFromCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    throw new Error("CSV has no annotation records.");
  }

  const headers = rows[0];
  const columns = new Map(headers.map((header, index) => [header, index]));
  const required = [
    "record_type",
    "schema_version",
    "session_id",
    "dataset_name",
    "annotator",
    "image_relative_path",
    "image_name",
    "image_width",
    "image_height",
    "review_status",
    "stroke_id",
    "class_id",
    "brush_diameter_px",
    "stroke_created_at_utc",
    "point_index",
    "x",
    "y",
    "elapsed_ms",
  ];
  const missing = required.filter((header) => !columns.has(header));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}`);
  }

  const valueAt = (row, name) => restoreSpreadsheetText(row[columns.get(name)] || "");
  let session = null;
  const strokeHolders = [];
  const strokesByImage = new Map();

  rows.slice(1).forEach((row, rowOffset) => {
    if (row.every((value) => value === "")) {
      return;
    }
    const rowNumber = rowOffset + 2;
    const recordType = valueAt(row, "record_type");
    if (!new Set(["image", "point", "dot", "dataset_summary"]).has(recordType)) {
      throw new Error(`CSV row ${rowNumber} has unsupported record_type: ${recordType || "blank"}`);
    }
    const schemaVersion = valueAt(row, "schema_version");
    if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
      throw new Error(`Unsupported annotation schema: ${schemaVersion || "missing"}`);
    }

    if (!session) {
      session = createSession(valueAt(row, "dataset_name") || "Imported dataset");
      session.session_id = valueAt(row, "session_id") || session.session_id;
      session.annotator = valueAt(row, "annotator");
      session.annotation_mode = ANNOTATION_MODES.has(valueAt(row, "annotation_mode"))
        ? valueAt(row, "annotation_mode")
        : schemaVersion === LEGACY_SCHEMA_VERSION ? "scribble" : "dot";
      session.dot_target_count = Math.max(
        1,
        Math.round(csvNumber(
          valueAt(row, "session_dot_target_count"),
          "session_dot_target_count",
          DOTS_PER_IMAGE,
        )),
      );
      session.created_at_utc = valueAt(row, "session_created_at_utc") || session.created_at_utc;
      session.updated_at_utc = valueAt(row, "session_updated_at_utc") || session.updated_at_utc;
    }

    if (recordType === "dataset_summary") {
      return;
    }

    const relativePath = valueAt(row, "image_relative_path");
    if (!relativePath) {
      throw new Error(`CSV row ${rowNumber} has no image_relative_path.`);
    }
    let record = session.images[relativePath];
    if (!record) {
      record = cleanImageRecord({
        relative_path: relativePath,
        name: valueAt(row, "image_name"),
        width: csvNumber(valueAt(row, "image_width"), "image_width", 0),
        height: csvNumber(valueAt(row, "image_height"), "image_height", 0),
        file_size: csvNumber(valueAt(row, "file_size"), "file_size", 0),
        last_modified: csvNumber(valueAt(row, "last_modified"), "last_modified", 0),
        review_status: valueAt(row, "review_status"),
        reviewed_at_utc: valueAt(row, "reviewed_at_utc") || null,
        notes: valueAt(row, "image_notes"),
        strokes: [],
        dots: [],
      }, relativePath);
      session.images[relativePath] = record;
    }

    if (recordType === "image") {
      return;
    }

    if (recordType === "dot") {
      const classId = valueAt(row, "dot_class_id");
      if (classId && !DOT_CLASS_IDS.has(classId)) {
        throw new Error(`CSV row ${rowNumber} has an invalid dot_class_id.`);
      }
      const dot = cleanDot({
        id: valueAt(row, "dot_id"),
        index: csvNumber(valueAt(row, "dot_index"), "dot_index"),
        x: csvNumber(valueAt(row, "dot_x"), "dot_x"),
        y: csvNumber(valueAt(row, "dot_y"), "dot_y"),
        class_id: classId || null,
        classified_at_utc: valueAt(row, "dot_classified_at_utc") || null,
      });
      if (dot) {
        record.dots.push(dot);
      }
      return;
    }

    const strokeId = valueAt(row, "stroke_id");
    const classId = valueAt(row, "class_id");
    if (!strokeId || !CLASS_IDS.has(classId)) {
      throw new Error(`CSV row ${rowNumber} has an invalid stroke_id or class_id.`);
    }
    let imageStrokes = strokesByImage.get(relativePath);
    if (!imageStrokes) {
      imageStrokes = new Map();
      strokesByImage.set(relativePath, imageStrokes);
    }
    let holder = imageStrokes.get(strokeId);
    if (!holder) {
      holder = {
        record,
        id: strokeId,
        class_id: classId,
        brush_diameter_px: csvNumber(valueAt(row, "brush_diameter_px"), "brush_diameter_px"),
        created_at_utc: valueAt(row, "stroke_created_at_utc"),
        indexedPoints: [],
      };
      imageStrokes.set(strokeId, holder);
      strokeHolders.push(holder);
    } else if (holder.class_id !== classId) {
      throw new Error(`CSV row ${rowNumber} changes the class of stroke ${strokeId}.`);
    }
    holder.indexedPoints.push({
      index: csvNumber(valueAt(row, "point_index"), "point_index"),
      point: [
        csvNumber(valueAt(row, "x"), "x"),
        csvNumber(valueAt(row, "y"), "y"),
        csvNumber(valueAt(row, "elapsed_ms"), "elapsed_ms", 0),
      ],
    });
  });

  if (!session) {
    throw new Error("CSV has no annotation records.");
  }
  for (const holder of strokeHolders) {
    holder.indexedPoints.sort((left, right) => left.index - right.index);
    const stroke = cleanStroke({
      id: holder.id,
      class_id: holder.class_id,
      brush_diameter_px: holder.brush_diameter_px,
      created_at_utc: holder.created_at_utc,
      points: holder.indexedPoints.map(({ point }) => point),
    });
    if (stroke) {
      holder.record.strokes.push(stroke);
    }
  }
  return normalizeSession(session);
}

export function storageKeyForDataset(datasetName, descriptors) {
  const signature = [
    datasetName,
    descriptors.length,
    ...descriptors.slice(0, 8).map((item) => `${item.relative_path}:${item.file_size || 0}`),
  ].join("|");
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `coral-scribbler:${(hash >>> 0).toString(16)}`;
}
