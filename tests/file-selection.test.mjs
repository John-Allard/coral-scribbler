import test from "node:test";
import assert from "node:assert/strict";

import {
  describeDroppedSelection,
  describeFileSelection,
  isSupportedImageFile,
} from "../file-selection.mjs";

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

function fileEntry(name) {
  const file = { name, type: "image/jpeg", size: 10, lastModified: 1 };
  return {
    name,
    isFile: true,
    isDirectory: false,
    file(resolve) {
      resolve(file);
    },
  };
}

function directoryEntry(name, batches) {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      let index = 0;
      return {
        readEntries(resolve) {
          resolve(batches[index++] || []);
        },
      };
    },
  };
}

test("folder drops preserve nested paths and read every directory batch", async () => {
  const nested = directoryEntry("nested", [[fileEntry("frame_10.jpg")], []]);
  const root = directoryEntry("Dive", [[fileEntry("frame_2.jpg")], [nested], []]);
  const selection = await describeDroppedSelection({
    items: [{ kind: "file", webkitGetAsEntry: () => root }],
  });

  assert.equal(selection.datasetName, "Dive");
  assert.deepEqual(selection.fileEntries.map((entry) => entry.relativePath), [
    "frame_2.jpg",
    "nested/frame_10.jpg",
  ]);
});

test("plain dropped files use a clear fallback dataset name", async () => {
  const file = { name: "frame.jpg", type: "image/jpeg" };
  const selection = await describeDroppedSelection({ files: [file] });
  assert.equal(selection.datasetName, "Dropped images");
  assert.equal(selection.fileEntries[0].relativePath, "frame.jpg");
});
