const IMAGE_EXTENSIONS = /\.(png|jpe?g|tif?f|bmp|webp)$/i;

export function isSupportedImageFile(file) {
  const mediaType = typeof file?.type === "string" ? file.type : "";
  const name = typeof file?.name === "string" ? file.name : "";
  return mediaType.startsWith("image/") || IMAGE_EXTENSIONS.test(name);
}

export async function readDirectoryFiles(directoryHandle, pathPrefix = "") {
  const fileEntries = [];
  for await (const [name, entryHandle] of directoryHandle.entries()) {
    const relativePath = pathPrefix ? `${pathPrefix}/${name}` : name;
    if (entryHandle.kind === "directory") {
      fileEntries.push(...await readDirectoryFiles(entryHandle, relativePath));
    } else if (entryHandle.kind === "file") {
      const file = await entryHandle.getFile();
      if (isSupportedImageFile(file)) {
        fileEntries.push({ file, relativePath });
      }
    }
  }
  return fileEntries;
}
