import test from "node:test";
import assert from "node:assert/strict";

import {
  DOTS_PER_IMAGE,
  LEGACY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  createSession,
  documentForExport,
  ensureDotQueries,
  ensureImage,
  imageDotSummary,
  normalizeSession,
  sessionDotSummary,
  sessionFromCsv,
  sessionToCsv,
  storageKeyForDataset,
  summarizeSession,
} from "../model.mjs";

function classifyDots(image, classIds) {
  ensureDotQueries(image, DOTS_PER_IMAGE, () => 0.5);
  classIds.forEach((classId, index) => {
    image.dots[index].class_id = classId;
    image.dots[index].classified_at_utc = "2026-07-23T12:00:00.000Z";
  });
}


test("session round-trip preserves sparse strokes and review state", () => {
  const session = createSession("Gulf, pilot");
  session.annotator = "Test Expert";
  const image = ensureImage(session, {
    relative_path: "Dive 1/frame,001.png",
    name: "frame,001.png",
    width: 1200,
    height: 720,
    file_size: 321,
    last_modified: 42,
  });
  image.review_status = "reviewed";
  image.reviewed_at_utc = "2026-07-21T20:00:00.000Z";
  image.notes = "Mixed rubble and sediment";
  image.strokes.push({
    id: "stroke_1",
    class_id: "rubble",
    brush_diameter_px: 24,
    created_at_utc: "2026-07-21T19:59:00.000Z",
    points: [[10.25, 20.5, 0], [14.75, 24.5, 20]],
  });

  const restored = normalizeSession(documentForExport(session));
  assert.equal(restored.schema_version, SCHEMA_VERSION);
  assert.equal(restored.annotator, "Test Expert");
  assert.equal(restored.images["Dive 1/frame,001.png"].strokes.length, 1);
  assert.equal(restored.images["Dive 1/frame,001.png"].strokes[0].points[1][0], 14.75);
  assert.equal(restored.images["Dive 1/frame,001.png"].review_status, "reviewed");
});

test("new sessions default to 50 uniformly sampled dot queries", () => {
  const session = createSession("Gulf");
  const image = ensureImage(session, {
    relative_path: "frame.png",
    name: "frame.png",
    width: 200,
    height: 100,
  });
  let value = 0;
  const dots = ensureDotQueries(image, DOTS_PER_IMAGE, () => {
    value = (value + 0.137) % 1;
    return value;
  });
  assert.equal(session.annotation_mode, "dot");
  assert.equal(dots.length, 50);
  assert.equal(new Set(dots.map((dot) => dot.index)).size, 50);
  assert.ok(dots.every((dot) => dot.x >= 0 && dot.x < 200 && dot.y >= 0 && dot.y < 100));
});

test("dot summaries apply the strict over-50-percent unknown exclusion", () => {
  const session = createSession("Gulf");
  const eligibleImage = ensureImage(session, {
    relative_path: "eligible.png",
    name: "eligible.png",
    width: 100,
    height: 100,
  });
  classifyDots(eligibleImage, [
    ...Array(10).fill("live"),
    ...Array(10).fill("dsc"),
    ...Array(10).fill("rubble"),
    ...Array(10).fill("sediment"),
    ...Array(10).fill("unknown_other"),
  ]);
  const exactlyHalfUnknown = structuredClone(eligibleImage);
  exactlyHalfUnknown.relative_path = "half.png";
  exactlyHalfUnknown.name = "half.png";
  exactlyHalfUnknown.dots.forEach((dot, index) => {
    dot.class_id = index < 25 ? "unknown_other" : "live";
  });
  session.images["half.png"] = exactlyHalfUnknown;
  const excludedImage = structuredClone(eligibleImage);
  excludedImage.relative_path = "excluded.png";
  excludedImage.name = "excluded.png";
  excludedImage.dots.forEach((dot, index) => {
    dot.class_id = index < 26 ? "unknown_other" : "rubble";
  });
  session.images["excluded.png"] = excludedImage;

  assert.equal(imageDotSummary(eligibleImage).usable_percent.live, 25);
  assert.equal(imageDotSummary(exactlyHalfUnknown).eligible, true);
  assert.equal(imageDotSummary(excludedImage).eligible, false);
  const summary = sessionDotSummary(session);
  assert.equal(summary.complete_image_count, 3);
  assert.equal(summary.eligible_image_count, 2);
  assert.equal(summary.excluded_image_count, 1);
});


test("CSV round-trip preserves metadata and exact stroke geometry", () => {
  const session = createSession("Gulf, pilot");
  session.annotator = "=unsafe spreadsheet text";
  const image = ensureImage(session, {
    relative_path: "frame,001.png",
    name: "frame,001.png",
    width: 100,
    height: 80,
  });
  image.review_status = "reviewed";
  image.reviewed_at_utc = "2026-07-21T20:00:00.000Z";
  image.notes = "Quoted \"note\", with a newline\nand =formula text";
  image.strokes.push({
    id: "stroke_1",
    class_id: "sediment",
    brush_diameter_px: 12,
    created_at_utc: "2026-07-21T19:00:00.000Z",
    points: [[4.123456, 5.654321, 0], [7, 9, 11]],
  });
  classifyDots(image, [
    ...Array(12).fill("live"),
    ...Array(8).fill("dsc"),
    ...Array(10).fill("rubble"),
    ...Array(10).fill("sediment"),
    ...Array(10).fill("unknown_other"),
  ]);

  const csv = sessionToCsv(session);
  assert.match(csv, /"'=unsafe spreadsheet text"/);
  assert.match(csv, /"frame,001.png"/);
  const restored = sessionFromCsv(csv);
  const restoredImage = restored.images["frame,001.png"];
  assert.equal(restored.annotator, "=unsafe spreadsheet text");
  assert.equal(restoredImage.notes, image.notes);
  assert.equal(restoredImage.review_status, "reviewed");
  assert.equal(restoredImage.strokes[0].class_id, "sediment");
  assert.deepEqual(restoredImage.strokes[0].points, image.strokes[0].points);
  assert.deepEqual(restoredImage.dots, image.dots);
  assert.match(csv, /"dataset_summary"/);
  assert.match(csv, /"dot_eligible_for_cover"/);
});


test("CSV import rejects missing canonical columns", () => {
  assert.throws(() => sessionFromCsv('"record_type","schema_version"\n"image","coral-scribbles/v1"\n'), {
    message: /missing required columns/,
  });
});

test("legacy scribble sessions migrate without creating dots", () => {
  const legacy = documentForExport(createSession("Legacy"));
  legacy.schema_version = LEGACY_SCHEMA_VERSION;
  delete legacy.annotation_mode;
  delete legacy.dot_target_count;
  const restored = normalizeSession(legacy);
  assert.equal(restored.schema_version, SCHEMA_VERSION);
  assert.equal(restored.annotation_mode, "scribble");
});


test("summary and storage key are deterministic", () => {
  const descriptors = [
    { relative_path: "frame_2.png", file_size: 2 },
    { relative_path: "frame_10.png", file_size: 10 },
  ];
  const session = createSession("Dive");
  for (const descriptor of descriptors) {
    ensureImage(session, descriptor);
  }
  session.images["frame_2.png"].review_status = "reviewed";
  session.images["frame_2.png"].strokes.push({
    id: "s",
    class_id: "unsure",
    brush_diameter_px: 4,
    created_at_utc: "now",
    points: [[1, 1, 0]],
  });
  const summary = summarizeSession(session, descriptors.map((item) => item.relative_path));
  assert.equal(summary.image_count, 2);
  assert.equal(summary.reviewed_count, 1);
  assert.equal(summary.class_strokes.unsure, 1);
  assert.equal(storageKeyForDataset("Dive", descriptors), storageKeyForDataset("Dive", descriptors));
});
