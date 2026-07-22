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
