# Annotation Format

The JSON export is the canonical annotation record. Its schema identifier is
`coral-scribbles/v1`.

```json
{
  "schema_version": "coral-scribbles/v1",
  "session_id": "session_...",
  "dataset_name": "Selected images",
  "annotator": "Expert name",
  "created_at_utc": "2026-07-22T12:00:00.000Z",
  "updated_at_utc": "2026-07-22T12:05:00.000Z",
  "classes": [],
  "images": {
    "frame_001.jpg": {
      "relative_path": "frame_001.jpg",
      "name": "frame_001.jpg",
      "width": 1920,
      "height": 1080,
      "file_size": 1234567,
      "last_modified": 1784736000000,
      "review_status": "reviewed",
      "reviewed_at_utc": "2026-07-22T12:05:00.000Z",
      "notes": "Optional note",
      "strokes": [
        {
          "id": "stroke_...",
          "class_id": "rubble",
          "brush_diameter_px": 24,
          "created_at_utc": "2026-07-22T12:03:00.000Z",
          "points": [[120.5, 340.25, 0], [128.0, 344.5, 31]]
        }
      ]
    }
  }
}
```

Each point is `[x, y, elapsed_ms]` in source-image coordinates. The elapsed
value is relative to the start of that stroke and is retained as provenance;
model training normally uses only `x`, `y`, class, and brush diameter.

Valid review states are `unreviewed`, `in_progress`, and `reviewed`. An image
may be reviewed with no strokes when it contains no useful rubble or sediment
examples.

CSV export contains one `image` row per loaded image and one `point` row per
stroke point. JSON should be preferred for import, rasterization, and training
because it preserves the nested stroke geometry without reconstruction.
