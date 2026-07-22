export const SCHEMA_VERSION = "coral-scribbles/v1";

export const CLASS_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "rubble", name: "Rubble", training_value: 1, color: "#26966d" }),
  Object.freeze({ id: "sediment", name: "Sediment", training_value: 2, color: "#e3b52f" }),
  Object.freeze({ id: "unsure", name: "Unsure", training_value: null, color: "#36a2bd" }),
]);

const CLASS_IDS = new Set(CLASS_DEFINITIONS.map((item) => item.id));
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
    created_at_utc: now,
    updated_at_utc: now,
    classes: CLASS_DEFINITIONS.map((item) => ({ ...item })),
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
  };
}

export function normalizeSession(rawDocument) {
  if (!rawDocument || typeof rawDocument !== "object") {
    throw new Error("Annotation file is not a JSON object.");
  }
  if (rawDocument.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported annotation schema: ${rawDocument.schema_version || "missing"}`);
  }

  const session = createSession(String(rawDocument.dataset_name || "Imported dataset"));
  session.session_id = String(rawDocument.session_id || session.session_id);
  session.annotator = String(rawDocument.annotator || "");
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

export function summarizeSession(session, imagePaths = null) {
  const paths = imagePaths || Object.keys(session.images);
  const summary = {
    image_count: paths.length,
    reviewed_count: 0,
    in_progress_count: 0,
    stroke_count: 0,
    point_count: 0,
    class_strokes: { rubble: 0, sediment: 0, unsure: 0 },
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

function csvCell(value) {
  const text = safeSpreadsheetText(value).replaceAll('"', '""');
  return `"${text}"`;
}

export function sessionToCsv(session) {
  const document = documentForExport(session);
  const headers = [
    "record_type",
    "schema_version",
    "session_id",
    "dataset_name",
    "annotator",
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
  ];
  const rows = [headers.map(csvCell).join(",")];
  const classValue = Object.fromEntries(
    CLASS_DEFINITIONS.map((definition) => [definition.id, definition.training_value]),
  );

  const commonValues = (record) => [
    document.schema_version,
    document.session_id,
    document.dataset_name,
    document.annotator,
    record.relative_path,
    record.name,
    record.width,
    record.height,
    record.file_size,
    record.last_modified,
    record.review_status,
    record.reviewed_at_utc || "",
    record.notes,
  ];

  for (const record of Object.values(document.images)) {
    rows.push([
      "image",
      ...commonValues(record),
      "", "", "", "", "", "", "", "", "",
    ].map(csvCell).join(","));

    for (const stroke of record.strokes) {
      stroke.points.forEach((point, pointIndex) => {
        rows.push([
          "point",
          ...commonValues(record),
          stroke.id,
          stroke.class_id,
          classValue[stroke.class_id] ?? "",
          stroke.brush_diameter_px,
          stroke.created_at_utc,
          pointIndex,
          Number(point[0].toFixed(3)),
          Number(point[1].toFixed(3)),
          Math.round(point[2] || 0),
        ].map(csvCell).join(","));
      });
    }
  }
  return `${rows.join("\n")}\n`;
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
