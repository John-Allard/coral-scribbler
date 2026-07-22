const IMAGE_EXTENSIONS = /\.(png|jpe?g|tif?f|bmp|webp)$/i;

export function isSupportedImageFile(file) {
  const mediaType = typeof file?.type === "string" ? file.type : "";
  const name = typeof file?.name === "string" ? file.name : "";
  return mediaType.startsWith("image/") || IMAGE_EXTENSIONS.test(name);
}

export function describeFileSelection(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) {
    return { datasetName: "Selected images", fileEntries: [] };
  }

  const firstFullPath = files[0].webkitRelativePath || files[0].name;
  const datasetName = firstFullPath.includes("/")
    ? firstFullPath.split("/")[0]
    : "Selected images";
  const fileEntries = files.map((file) => {
    const fullPath = file.webkitRelativePath || file.name;
    const pathParts = fullPath.split("/");
    const relativePath = pathParts.length > 1 && pathParts[0] === datasetName
      ? pathParts.slice(1).join("/")
      : fullPath;
    return { file, relativePath };
  });
  return { datasetName, fileEntries };
}

function readFileEntry(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryBatch(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

async function readDirectoryEntries(entry) {
  const reader = entry.createReader();
  const entries = [];
  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

async function flattenDroppedEntry(entry, parentPath = "", includeEntryName = true) {
  const relativePath = includeEntryName
    ? [parentPath, entry.name].filter(Boolean).join("/")
    : parentPath;

  if (entry.isFile) {
    const file = await readFileEntry(entry);
    return [{ file, relativePath: relativePath || file.name }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry);
  const nested = await Promise.all(
    children.map((child) => flattenDroppedEntry(child, relativePath, true)),
  );
  return nested.flat();
}

export async function describeDroppedSelection(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []).filter((item) => item.kind === "file");
  const roots = items.map((item) => {
    const getEntry = item.getAsEntry || item.webkitGetAsEntry;
    return typeof getEntry === "function" ? getEntry.call(item) : null;
  }).filter(Boolean);

  if (roots.length === 0) {
    const selection = describeFileSelection(dataTransfer?.files);
    return {
      datasetName: selection.datasetName === "Selected images" ? "Dropped images" : selection.datasetName,
      fileEntries: selection.fileEntries,
    };
  }

  const singleFolder = roots.length === 1 && roots[0].isDirectory;
  const nested = await Promise.all(roots.map((entry) => (
    flattenDroppedEntry(entry, "", !singleFolder)
  )));
  return {
    datasetName: singleFolder ? roots[0].name : "Dropped images",
    fileEntries: nested.flat(),
  };
}
