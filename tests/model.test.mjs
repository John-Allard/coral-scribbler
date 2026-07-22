import test from "node:test";
import assert from "node:assert/strict";

import {
  SCHEMA_VERSION,
  createSession,
  documentForExport,
  ensureImage,
  normalizeSession,
  sessionToCsv,
  storageKeyForDataset,
  summarizeSession,
} from "../model.mjs";


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


test("CSV includes image metadata rows and point rows", () => {
  const session = createSession("Gulf, pilot");
  session.annotator = "=unsafe spreadsheet text";
  const image = ensureImage(session, {
    relative_path: "frame,001.png",
    name: "frame,001.png",
    width: 100,
    height: 80,
  });
  image.strokes.push({
    id: "stroke_1",
    class_id: "sediment",
    brush_diameter_px: 12,
    created_at_utc: "2026-07-21T19:00:00.000Z",
    points: [[4, 5, 0], [7, 9, 11]],
  });

  const csv = sessionToCsv(session);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^"image",/);
  assert.match(lines[2], /^"point",/);
  assert.match(lines[2], /"sediment","2","12"/);
  assert.match(csv, /"'=unsafe spreadsheet text"/);
  assert.match(csv, /"frame,001.png"/);
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
