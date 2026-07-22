# Annotation Format

The CSV export is the canonical annotation record. Its schema identifier is
`coral-scribbles/v1`.

The file is a flat representation of image records and ordered stroke points:

- One `image` row is written for every loaded image, including reviewed images
  with no strokes.
- One `point` row is written for every sampled point in every stroke.
- `image_relative_path` links rows to source images.
- `stroke_id` groups points into strokes, and `point_index` preserves their
  drawing order.
- `x`, `y`, and `brush_diameter_px` use original-image pixels.
- `class_id` is `rubble`, `sediment`, or `unsure`. Unsure strokes are retained
  for provenance but excluded from supervised training.

Session, image, and stroke metadata are repeated where needed so the table is
self-contained. Important columns include:

| Scope | Columns |
| --- | --- |
| Session | `schema_version`, `session_id`, `dataset_name`, `annotator`, `session_created_at_utc`, `session_updated_at_utc` |
| Image | `image_relative_path`, `image_name`, dimensions, file metadata, `review_status`, `reviewed_at_utc`, `image_notes` |
| Stroke | `stroke_id`, `class_id`, `training_value`, `brush_diameter_px`, `stroke_created_at_utc` |
| Point | `point_index`, `x`, `y`, `elapsed_ms` |

The elapsed value is relative to the start of that stroke and is retained as
provenance; model training normally uses only coordinates, class, and brush
diameter. CSV fields are quoted, so commas, quotes, and line breaks in notes are
preserved. Text that spreadsheet programs could interpret as a formula is
escaped on export and restored when the file is imported into Coral Scribbler.

Valid review states are `unreviewed`, `in_progress`, and `reviewed`. An image
may be reviewed with no strokes when it contains no useful rubble or sediment
examples.
