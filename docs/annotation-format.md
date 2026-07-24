# Annotation Format

The CSV export is the canonical annotation record. Its schema identifier is
`coral-annotations/v2`. Version `coral-scribbles/v1` files remain importable.

The file is a flat representation of image records, dot counts, ordered stroke
points, and the dataset summary:

- One `image` row is written for every loaded image. It includes the image's
  dot counts and calculated percentages.
- One `dot` row stores every query location and its assigned class.
- One `point` row is written for every sampled point in every stroke.
- One `dataset_summary` row contains pooled counts, pooled cover percentages,
  mean per-image usable-area percentages, and inclusion totals.
- `image_relative_path` links rows to source images.
- `dot_id` and `dot_index` identify dots; `dot_x` and `dot_y` use
  original-image pixels.
- `stroke_id` groups points into strokes, and `point_index` preserves their
  drawing order.
- `x`, `y`, and `brush_diameter_px` use original-image pixels.
- `dot_class_id` is `live`, `dsc`, `rubble`, `sediment`, or `unknown_other`.
- Scribble `class_id` is `rubble`, `sediment`, or `unsure`. Unsure strokes are
  retained for provenance but excluded from supervised training.

## Cover Calculations

Per-image `*_pct_image` values divide each class count by all classified dots.
Per-image `*_pct_usable` values remove `unknown_other` from the denominator, so
Live, DSC, Rubble, and Sediment sum to 100% when known dots are present.

A completed image is eligible for dataset cover summaries when at most 25 of
50 dots are Unknown / other. More than 50% Unknown / other excludes the image;
exactly 50% remains included. Incomplete images are also omitted.

The `dataset_summary` row reports two usable-area summaries:

- `live_pct_usable` through `sediment_pct_usable` pool eligible dot counts
  before calculating percentages.
- `mean_live_pct_usable` through `mean_sediment_pct_usable` are arithmetic
  means of the eligible per-image percentages.

Session, image, and stroke metadata are repeated where needed so the table is
self-contained. Important columns include:

| Scope | Columns |
| --- | --- |
| Session | `schema_version`, `session_id`, `dataset_name`, `annotator`, `annotation_mode`, `session_dot_target_count`, timestamps |
| Image | path, name, dimensions, file metadata, review state, notes, dot counts, image and usable-area percentages |
| Dot | `dot_id`, `dot_index`, `dot_x`, `dot_y`, `dot_class_id`, `dot_training_value`, `dot_classified_at_utc` |
| Stroke | `stroke_id`, `class_id`, `training_value`, `brush_diameter_px`, `stroke_created_at_utc` |
| Point | `point_index`, `x`, `y`, `elapsed_ms` |
| Dataset | image inclusion totals, pooled counts and percentages, mean per-image usable percentages |

The elapsed value is relative to the start of that stroke and is retained as
provenance; model training normally uses only coordinates, class, and brush
diameter. CSV fields are quoted, so commas, quotes, and line breaks in notes are
preserved. Text that spreadsheet programs could interpret as a formula is
escaped on export and restored when the file is imported into Coral Scribbler.

Valid review states are `unreviewed`, `in_progress`, and `reviewed`. In dot
mode, completing all target dots sets the image to reviewed. In scribble mode,
an image may be reviewed with no strokes when it contains no useful rubble or
sediment examples.
