import test from "node:test";
import assert from "node:assert/strict";

import { describeFileSelection, isSupportedImageFile } from "../file-selection.mjs";

test("image detection accepts image media types and known extensions", () => {
  assert.equal(isSupportedImageFile({ name: "frame.data", type: "image/png" }), true);
  assert.equal(isSupportedImageFile({ name: "FRAME_01.JPG", type: "" }), true);
  assert.equal(isSupportedImageFile({ name: "notes.txt", type: "text/plain" }), false);
});

test("directory input preserves the dataset name and nested paths", () => {
  const files = [
    { name: "frame_2.png", webkitRelativePath: "Dive/frame_2.png" },
    { name: "frame_10.jpg", webkitRelativePath: "Dive/nested/frame_10.jpg" },
  ];
  const selection = describeFileSelection(files);
  assert.equal(selection.datasetName, "Dive");
  assert.deepEqual(selection.fileEntries.map((entry) => entry.relativePath), [
    "frame_2.png",
    "nested/frame_10.jpg",
  ]);
});
