import test from "node:test";
import assert from "node:assert/strict";

import { isSupportedImageFile, readDirectoryFiles } from "../file-selection.mjs";

function fileHandle(name, type = "") {
  return {
    kind: "file",
    name,
    async getFile() {
      return { name, type };
    },
  };
}

function directoryHandle(name, children) {
  return {
    kind: "directory",
    name,
    async *entries() {
      for (const child of children) {
        yield [child.name, child];
      }
    },
  };
}

test("image detection accepts image media types and known extensions", () => {
  assert.equal(isSupportedImageFile({ name: "frame.data", type: "image/png" }), true);
  assert.equal(isSupportedImageFile({ name: "FRAME_01.JPG", type: "" }), true);
  assert.equal(isSupportedImageFile({ name: "notes.txt", type: "text/plain" }), false);
});

test("directory traversal preserves nested paths and excludes non-images", async () => {
  const root = directoryHandle("Dive", [
    fileHandle("frame_2.png", "image/png"),
    directoryHandle("nested", [
      fileHandle("frame_10.jpg", "image/jpeg"),
      fileHandle("notes.txt", "text/plain"),
    ]),
  ]);

  const entries = await readDirectoryFiles(root);
  assert.deepEqual(entries.map((entry) => entry.relativePath), [
    "frame_2.png",
    "nested/frame_10.jpg",
  ]);
});
