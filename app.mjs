import {
  CLASS_DEFINITIONS,
  createSession,
  documentForExport,
  ensureImage,
  imageStrokeCounts,
  naturalCompare,
  normalizeSession,
  randomId,
  sessionToCsv,
  storageKeyForDataset,
  summarizeSession,
} from "./model.mjs";
import { isSupportedImageFile, readDirectoryFiles } from "./file-selection.mjs";

const $ = (id) => document.getElementById(id);

const elements = {
  canvas: $("annotationCanvas"),
  stage: $("canvasStage"),
  emptyState: $("emptyState"),
  loadingState: $("loadingState"),
  datasetName: $("datasetName"),
  progressText: $("progressText"),
  folderInput: $("folderInput"),
  fileInput: $("fileInput"),
  importButton: $("importButton"),
  importInput: $("importInput"),
  exportJsonButton: $("exportJsonButton"),
  exportCsvButton: $("exportCsvButton"),
  helpButton: $("helpButton"),
  helpDialog: $("helpDialog"),
  annotatorInput: $("annotatorInput"),
  brushSize: $("brushSize"),
  brushValue: $("brushValue"),
  imageSearch: $("imageSearch"),
  imageList: $("imageList"),
  queueCount: $("queueCount"),
  fitButton: $("fitButton"),
  zoomOutButton: $("zoomOutButton"),
  zoomInButton: $("zoomInButton"),
  zoomText: $("zoomText"),
  overlayButton: $("overlayButton"),
  undoButton: $("undoButton"),
  redoButton: $("redoButton"),
  saveStatus: $("saveStatus"),
  previousButton: $("previousButton"),
  nextButton: $("nextButton"),
  currentImageName: $("currentImageName"),
  currentImageMeta: $("currentImageMeta"),
  reviewState: $("reviewState"),
  imagePosition: $("imagePosition"),
  rubbleCount: $("rubbleCount"),
  sedimentCount: $("sedimentCount"),
  unsureCount: $("unsureCount"),
  reviewNextButton: $("reviewNextButton"),
  imageNotes: $("imageNotes"),
  demoButton: $("demoButton"),
  toast: $("toast"),
};

const classById = Object.fromEntries(CLASS_DEFINITIONS.map((item) => [item.id, item]));
const ctx = elements.canvas.getContext("2d", { alpha: false });

const state = {
  descriptors: [],
  session: createSession(),
  currentIndex: -1,
  imageElement: null,
  imageLoadToken: 0,
  activeTool: "rubble",
  brushDiameter: 24,
  showOverlay: true,
  overlayOpacity: 0.72,
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  canvasSize: { width: 1, height: 1, dpr: 1 },
  cursor: { visible: false, x: 0, y: 0 },
  pointer: null,
  currentStroke: null,
  spaceDown: false,
  histories: new Map(),
  mode: "empty",
  storageKey: null,
  serverSaveEnabled: false,
  saveTimer: null,
  saveGeneration: 0,
  toastTimer: null,
  objectUrls: [],
};

function currentDescriptor() {
  return state.currentIndex >= 0 ? state.descriptors[state.currentIndex] : null;
}

function currentRecord() {
  const descriptor = currentDescriptor();
  return descriptor ? state.session.images[descriptor.relative_path] : null;
}

function setSaveStatus(status, text) {
  elements.saveStatus.dataset.state = status;
  elements.saveStatus.querySelector("span:last-child").textContent = text;
}

function showToast(message, duration = 3200) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), duration);
}

function cleanupObjectUrls() {
  for (const url of state.objectUrls) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls = [];
}

function descriptorPaths() {
  return state.descriptors.map((descriptor) => descriptor.relative_path);
}

function snapshotRecord(record) {
  return structuredClone({
    strokes: record.strokes,
    review_status: record.review_status,
    reviewed_at_utc: record.reviewed_at_utc,
    notes: record.notes,
  });
}

function restoreRecord(record, snapshot) {
  record.strokes = structuredClone(snapshot.strokes);
  record.review_status = snapshot.review_status;
  record.reviewed_at_utc = snapshot.reviewed_at_utc;
  record.notes = snapshot.notes;
}

function historyForCurrentImage() {
  const descriptor = currentDescriptor();
  if (!descriptor) {
    return null;
  }
  if (!state.histories.has(descriptor.relative_path)) {
    state.histories.set(descriptor.relative_path, { undo: [], redo: [] });
  }
  return state.histories.get(descriptor.relative_path);
}

function commitMutation(beforeSnapshot) {
  const history = historyForCurrentImage();
  if (history && beforeSnapshot) {
    history.undo.push(beforeSnapshot);
    if (history.undo.length > 100) {
      history.undo.shift();
    }
    history.redo = [];
  }
  state.session.updated_at_utc = new Date().toISOString();
  scheduleSave();
  updateInterface();
  render();
}

function undo() {
  const record = currentRecord();
  const history = historyForCurrentImage();
  if (!record || !history || history.undo.length === 0) {
    return;
  }
  history.redo.push(snapshotRecord(record));
  restoreRecord(record, history.undo.pop());
  commitWithoutHistory();
}

function redo() {
  const record = currentRecord();
  const history = historyForCurrentImage();
  if (!record || !history || history.redo.length === 0) {
    return;
  }
  history.undo.push(snapshotRecord(record));
  restoreRecord(record, history.redo.pop());
  commitWithoutHistory();
}

function commitWithoutHistory() {
  state.session.updated_at_utc = new Date().toISOString();
  scheduleSave();
  updateInterface();
  render();
}

function localBackup() {
  if (!state.storageKey || state.mode === "demo") {
    return;
  }
  try {
    localStorage.setItem(state.storageKey, JSON.stringify(documentForExport(state.session)));
  } catch (error) {
    console.warn("Could not save browser backup", error);
  }
}

function scheduleSave() {
  state.saveGeneration += 1;
  const generation = state.saveGeneration;
  clearTimeout(state.saveTimer);
  localBackup();
  setSaveStatus("saving", state.serverSaveEnabled ? "Saving project draft" : "Saving in browser");
  state.saveTimer = setTimeout(() => persistSession(generation), 260);
}

async function persistSession(generation) {
  const document = documentForExport(state.session);
  state.session.updated_at_utc = document.updated_at_utc;
  if (!state.serverSaveEnabled) {
    if (generation === state.saveGeneration) {
      setSaveStatus("saved", state.mode === "demo" ? "Demo is not saved" : "Saved in this browser");
    }
    return;
  }

  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    });
    if (!response.ok) {
      throw new Error(`Save failed with HTTP ${response.status}`);
    }
    if (generation === state.saveGeneration) {
      setSaveStatus("saved", "Saved to project draft");
    }
  } catch (error) {
    console.error(error);
    setSaveStatus("error", "Project save failed; browser backup kept");
    showToast("The project draft could not be written. Export JSON before closing.", 6000);
  }
}

function setTool(toolId) {
  state.activeTool = toolId;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    const active = button.dataset.tool === toolId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  render();
}

function setBrushDiameter(value) {
  state.brushDiameter = Math.max(4, Math.min(96, Number(value) || 24));
  elements.brushSize.value = String(state.brushDiameter);
  elements.brushValue.textContent = `${state.brushDiameter} px`;
  render();
}

function setControlsEnabled(enabled) {
  [
    elements.exportJsonButton,
    elements.exportCsvButton,
    elements.imageSearch,
    elements.fitButton,
    elements.zoomOutButton,
    elements.zoomInButton,
    elements.overlayButton,
    elements.previousButton,
    elements.nextButton,
    elements.reviewNextButton,
    elements.imageNotes,
  ].forEach((element) => {
    element.disabled = !enabled;
  });
}

function reviewStatusLabel(status) {
  if (status === "reviewed") {
    return "Reviewed";
  }
  if (status === "in_progress") {
    return "In progress";
  }
  return "Not reviewed";
}

function updateInterface() {
  const hasImages = state.descriptors.length > 0;
  setControlsEnabled(hasImages);
  elements.emptyState.hidden = hasImages;
  elements.datasetName.textContent = hasImages ? state.session.dataset_name : "No folder loaded";
  elements.annotatorInput.value = state.session.annotator || "";

  const paths = descriptorPaths();
  const summary = summarizeSession(state.session, paths);
  elements.progressText.textContent = `${summary.reviewed_count} of ${summary.image_count} reviewed`;
  elements.queueCount.textContent = `${summary.image_count} image${summary.image_count === 1 ? "" : "s"}`;

  const descriptor = currentDescriptor();
  const record = currentRecord();
  if (!descriptor || !record) {
    elements.currentImageName.textContent = "No image selected";
    elements.currentImageMeta.textContent = "Open a folder to begin";
    elements.reviewState.textContent = "Not loaded";
    elements.imagePosition.textContent = `0 / ${state.descriptors.length}`;
    elements.rubbleCount.textContent = "0";
    elements.sedimentCount.textContent = "0";
    elements.unsureCount.textContent = "0";
    elements.imageNotes.value = "";
  } else {
    const counts = imageStrokeCounts(record);
    elements.currentImageName.textContent = descriptor.name;
    elements.currentImageMeta.textContent = record.width && record.height
      ? `${record.width} x ${record.height} px | ${counts.total} stroke${counts.total === 1 ? "" : "s"}`
      : "Loading image dimensions";
    elements.reviewState.textContent = reviewStatusLabel(record.review_status);
    elements.imagePosition.textContent = `${state.currentIndex + 1} / ${state.descriptors.length}`;
    elements.rubbleCount.textContent = String(counts.rubble);
    elements.sedimentCount.textContent = String(counts.sediment);
    elements.unsureCount.textContent = String(counts.unsure);
    if (document.activeElement !== elements.imageNotes) {
      elements.imageNotes.value = record.notes || "";
    }
  }

  const history = historyForCurrentImage();
  elements.undoButton.disabled = !hasImages || !history || history.undo.length === 0;
  elements.redoButton.disabled = !hasImages || !history || history.redo.length === 0;
  elements.previousButton.disabled = !hasImages || state.currentIndex <= 0;
  elements.nextButton.disabled = !hasImages || state.currentIndex >= state.descriptors.length - 1;
  updateImageList();
  updateZoomReadout();
}

function updateImageList() {
  const scrollTop = elements.imageList.scrollTop;
  const query = elements.imageSearch.value.trim().toLocaleLowerCase();
  elements.imageList.replaceChildren();

  const matches = state.descriptors
    .map((descriptor, index) => ({ descriptor, index }))
    .filter(({ descriptor }) => !query || descriptor.relative_path.toLocaleLowerCase().includes(query));

  if (matches.length === 0) {
    const message = document.createElement("div");
    message.className = "image-list-empty";
    message.textContent = state.descriptors.length ? "No filenames match." : "Images will appear here.";
    elements.imageList.append(message);
    return;
  }

  for (const { descriptor, index } of matches) {
    const record = state.session.images[descriptor.relative_path];
    const counts = imageStrokeCounts(record);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `image-list-item ${record?.review_status || "unreviewed"}`;
    button.classList.toggle("active", index === state.currentIndex);
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === state.currentIndex));
    button.title = descriptor.relative_path;
    button.innerHTML = `
      <span class="queue-state" aria-hidden="true"></span>
      <span class="image-list-name"></span>
      <span class="image-list-count">${counts.total || ""}</span>
    `;
    button.querySelector(".image-list-name").textContent = descriptor.name;
    button.addEventListener("click", () => loadImage(index));
    elements.imageList.append(button);
  }
  elements.imageList.scrollTop = scrollTop;
  const activeItem = elements.imageList.querySelector(".image-list-item.active");
  if (activeItem && !isElementVisible(activeItem, elements.imageList)) {
    activeItem.scrollIntoView({ block: "nearest" });
  }
}

function isElementVisible(child, parent) {
  const childRect = child.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return childRect.top >= parentRect.top && childRect.bottom <= parentRect.bottom;
}

async function setDataset(descriptors, datasetName, session, options = {}) {
  cleanupObjectUrls();
  state.descriptors = descriptors.slice().sort((a, b) => naturalCompare(a.relative_path, b.relative_path));
  state.session = session || createSession(datasetName);
  state.session.dataset_name = datasetName;
  state.mode = options.mode || "folder";
  state.serverSaveEnabled = Boolean(options.serverSaveEnabled);
  state.storageKey = options.storageKey || storageKeyForDataset(datasetName, state.descriptors);
  state.histories.clear();
  state.imageElement = null;
  state.currentIndex = -1;

  for (const descriptor of state.descriptors) {
    ensureImage(state.session, descriptor);
    if (descriptor.objectUrl) {
      state.objectUrls.push(descriptor.objectUrl);
    }
  }

  elements.imageSearch.value = "";
  updateInterface();
  if (state.descriptors.length > 0) {
    const firstUnreviewed = state.descriptors.findIndex((descriptor) => (
      state.session.images[descriptor.relative_path]?.review_status !== "reviewed"
    ));
    await loadImage(firstUnreviewed >= 0 ? firstUnreviewed : 0);
    setSaveStatus(
      "saved",
      state.serverSaveEnabled ? "Project draft autosave ready" : "Browser autosave ready",
    );
  }
}

async function loadSelectedFileEntries(fileEntries, datasetName) {
  const entries = fileEntries.filter(({ file }) => isSupportedImageFile(file));
  if (entries.length === 0) {
    showToast("That selection does not contain supported image files.");
    return null;
  }

  const descriptors = entries.map(({ file, relativePath }) => {
    const objectUrl = URL.createObjectURL(file);
    return {
      relative_path: relativePath || file.name,
      name: file.name,
      file_size: file.size,
      last_modified: file.lastModified,
      width: 0,
      height: 0,
      url: objectUrl,
      objectUrl,
    };
  });
  const storageKey = storageKeyForDataset(datasetName, descriptors);
  let session = createSession(datasetName);
  let restored = false;
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      session = normalizeSession(JSON.parse(saved));
      restored = true;
    } catch (error) {
      console.warn("Could not restore saved session", error);
    }
  }
  await setDataset(descriptors, datasetName, session, { mode: "folder", storageKey });
  return { count: descriptors.length, restored };
}

async function loadFolderFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) {
    return;
  }

  const firstFullPath = files[0].webkitRelativePath || files[0].name;
  const rootName = firstFullPath.includes("/") ? firstFullPath.split("/")[0] : "Selected images";
  const fileEntries = files.map((file) => {
    const fullPath = file.webkitRelativePath || file.name;
    const pathParts = fullPath.split("/");
    const relativePath = pathParts.length > 1 && pathParts[0] === rootName
      ? pathParts.slice(1).join("/")
      : fullPath;
    return { file, relativePath };
  });
  const result = await loadSelectedFileEntries(fileEntries, rootName);
  if (result) {
    const restoredText = result.restored ? " Browser autosave restored." : "";
    showToast(`Loaded ${result.count} image${result.count === 1 ? "" : "s"}.${restoredText}`, 5000);
  }
}

async function openImageFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    elements.folderInput.click();
    return;
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({
      id: "coral-scribbler-images",
      mode: "read",
    });
    showToast("Reading the selected folder...", 30000);
    const fileEntries = await readDirectoryFiles(directoryHandle);
    const result = await loadSelectedFileEntries(fileEntries, directoryHandle.name || "Selected images");
    if (result) {
      const restoredText = result.restored ? " Browser autosave restored." : "";
      showToast(`Loaded ${result.count} image${result.count === 1 ? "" : "s"}.${restoredText}`, 5000);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      return;
    }
    console.error("Could not open image folder", error);
    showToast("The browser could not open that folder. Choose individual image files instead.", 6500);
  }
}

async function loadServerDataset(config) {
  const descriptors = (config.images || []).map((item) => ({
    relative_path: item.relative_path,
    name: item.name,
    file_size: item.file_size || 0,
    last_modified: item.last_modified || 0,
    width: item.width || 0,
    height: item.height || 0,
    url: item.url,
  }));
  let session = createSession(config.dataset_name || "Local images");
  if (config.annotations) {
    try {
      session = normalizeSession(config.annotations);
    } catch (error) {
      console.warn("Server annotation draft was invalid", error);
      showToast("The existing server draft could not be read; a fresh session was opened.", 6000);
    }
  }
  await setDataset(descriptors, config.dataset_name || "Local images", session, {
    mode: "server",
    serverSaveEnabled: Boolean(config.save_enabled),
  });
}

function createDemoDescriptor() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
      <defs>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="#0f5960"/><stop offset="1" stop-color="#183b3a"/>
        </linearGradient>
        <filter id="noise"><feTurbulence baseFrequency=".025" numOctaves="3" seed="8"/><feBlend mode="soft-light" in="SourceGraphic"/></filter>
        <pattern id="pebbles" width="46" height="34" patternUnits="userSpaceOnUse">
          <rect width="46" height="34" fill="#7b7669"/>
          <ellipse cx="10" cy="14" rx="10" ry="7" fill="#a59b82" transform="rotate(-18 10 14)"/>
          <ellipse cx="34" cy="25" rx="12" ry="6" fill="#575f58" transform="rotate(22 34 25)"/>
        </pattern>
        <pattern id="sand" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#a89c72"/>
          <circle cx="9" cy="14" r="2" fill="#776f55"/><circle cx="42" cy="31" r="1.5" fill="#c8b98a"/><circle cx="27" cy="52" r="1" fill="#655f4e"/>
        </pattern>
      </defs>
      <rect width="1200" height="720" fill="url(#water)"/>
      <path d="M0 365 C220 312 365 410 560 354 C780 291 942 345 1200 286 V720 H0Z" fill="url(#sand)" filter="url(#noise)"/>
      <path d="M80 474 C155 379 250 402 310 459 C386 531 474 433 564 468 C641 498 677 617 602 720 H60Z" fill="url(#pebbles)"/>
      <path d="M690 510 C742 431 795 445 824 508 C854 574 920 479 978 515 C1048 558 1080 642 1043 720 H665Z" fill="url(#pebbles)" opacity=".86"/>
      <g fill="#d8d1ba" stroke="#8f8c7f" stroke-width="11" stroke-linecap="round">
        <path d="M790 456 V315 M790 357 L730 295 M792 393 L856 330 M790 342 L818 257"/>
        <path d="M1005 459 V352 M1005 391 L953 331 M1006 405 L1056 354"/>
      </g>
      <g fill="#d26469" opacity=".92">
        <circle cx="812" cy="265" r="22"/><circle cx="731" cy="293" r="20"/><circle cx="861" cy="328" r="23"/>
      </g>
      <text x="35" y="55" fill="#e9f2ef" font-family="sans-serif" font-size="24" opacity=".8">DEMO IMAGE - NOT SCIENTIFIC DATA</text>
    </svg>`;
  const objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  return {
    relative_path: "demo/demo_coral_scene.svg",
    name: "demo_coral_scene.svg",
    file_size: svg.length,
    last_modified: Date.now(),
    width: 1200,
    height: 720,
    url: objectUrl,
    objectUrl,
  };
}

async function loadDemo() {
  const descriptor = createDemoDescriptor();
  await setDataset([descriptor], "Control demo - do not export for training", createSession("Control demo - do not export for training"), {
    mode: "demo",
    storageKey: null,
  });
  setSaveStatus("saved", "Demo is not saved");
}

async function loadImage(index) {
  if (index < 0 || index >= state.descriptors.length || index === state.currentIndex && state.imageElement) {
    return;
  }
  cancelPointerOperation(true);
  const token = ++state.imageLoadToken;
  state.currentIndex = index;
  elements.loadingState.hidden = false;
  updateInterface();

  const descriptor = currentDescriptor();
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Could not load ${descriptor.name}`));
      image.src = descriptor.url;
    });
    if (token !== state.imageLoadToken) {
      return;
    }
    state.imageElement = image;
    descriptor.width = image.naturalWidth;
    descriptor.height = image.naturalHeight;
    ensureImage(state.session, descriptor);
    fitImage();
  } catch (error) {
    console.error(error);
    showToast(error.message, 5000);
    state.imageElement = null;
  } finally {
    if (token === state.imageLoadToken) {
      elements.loadingState.hidden = true;
      updateInterface();
      render();
    }
  }
}

function fitImage() {
  const image = state.imageElement;
  if (!image) {
    return;
  }
  const { width, height } = state.canvasSize;
  const margin = 24;
  const scale = Math.min(
    Math.max(1, width - margin * 2) / image.naturalWidth,
    Math.max(1, height - margin * 2) / image.naturalHeight,
  );
  state.view.scale = Math.max(0.01, scale);
  state.view.offsetX = (width - image.naturalWidth * state.view.scale) / 2;
  state.view.offsetY = (height - image.naturalHeight * state.view.scale) / 2;
  updateZoomReadout();
  render();
}

function zoomAt(factor, canvasX = state.canvasSize.width / 2, canvasY = state.canvasSize.height / 2) {
  if (!state.imageElement) {
    return;
  }
  const oldScale = state.view.scale;
  const newScale = Math.max(0.03, Math.min(24, oldScale * factor));
  const imageX = (canvasX - state.view.offsetX) / oldScale;
  const imageY = (canvasY - state.view.offsetY) / oldScale;
  state.view.scale = newScale;
  state.view.offsetX = canvasX - imageX * newScale;
  state.view.offsetY = canvasY - imageY * newScale;
  updateZoomReadout();
  render();
}

function updateZoomReadout() {
  elements.zoomText.textContent = `${Math.round(state.view.scale * 100)}%`;
}

function resizeCanvas() {
  const rect = elements.stage.getBoundingClientRect();
  const oldWidth = state.canvasSize.width;
  const oldHeight = state.canvasSize.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  state.canvasSize = {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    dpr,
  };
  elements.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  elements.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  if (state.imageElement && (oldWidth <= 1 || oldHeight <= 1)) {
    fitImage();
  } else if (state.imageElement && oldWidth > 1 && oldHeight > 1) {
    state.view.offsetX += (rect.width - oldWidth) / 2;
    state.view.offsetY += (rect.height - oldHeight) / 2;
  }
  render();
}

function drawStroke(stroke, alpha = state.overlayOpacity) {
  if (!stroke.points.length) {
    return;
  }
  const definition = classById[stroke.class_id];
  if (!definition) {
    return;
  }
  const scale = state.view.scale;
  const points = stroke.points;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = definition.color;
  ctx.fillStyle = definition.color;
  ctx.lineWidth = Math.max(2, stroke.brush_diameter_px * scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.class_id === "unsure") {
    ctx.setLineDash([Math.max(4, 9 * scale), Math.max(3, 6 * scale)]);
  }
  if (points.length === 1) {
    const [x, y] = imageToCanvas(points[0][0], points[0][1]);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, stroke.brush_diameter_px * scale / 2), 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    points.forEach((point, index) => {
      const [x, y] = imageToCanvas(point[0], point[1]);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  const { width, height, dpr } = state.canvasSize;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101918";
  ctx.fillRect(0, 0, width, height);

  const image = state.imageElement;
  if (!image) {
    return;
  }
  const drawWidth = image.naturalWidth * state.view.scale;
  const drawHeight = image.naturalHeight * state.view.scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, state.view.offsetX, state.view.offsetY, drawWidth, drawHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(state.view.offsetX, state.view.offsetY, drawWidth, drawHeight);
  ctx.clip();
  if (state.showOverlay) {
    const record = currentRecord();
    for (const stroke of record?.strokes || []) {
      drawStroke(stroke);
    }
    if (state.currentStroke) {
      drawStroke(state.currentStroke, 0.92);
    }
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(235, 241, 238, 0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(state.view.offsetX + 0.5, state.view.offsetY + 0.5, drawWidth - 1, drawHeight - 1);

  if (state.cursor.visible && !state.pointer?.isPanning) {
    const definition = classById[state.activeTool];
    const radius = Math.max(3, state.brushDiameter * state.view.scale / 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(state.cursor.x, state.cursor.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.setLineDash(state.activeTool === "eraser" ? [4, 3] : []);
    ctx.strokeStyle = definition?.color || "rgba(255,255,255,.9)";
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowBlur = 3;
    ctx.stroke();
    ctx.restore();
  }
}

function canvasCoordinates(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return [event.clientX - rect.left, event.clientY - rect.top];
}

function imageToCanvas(imageX, imageY) {
  return [
    state.view.offsetX + imageX * state.view.scale,
    state.view.offsetY + imageY * state.view.scale,
  ];
}

function canvasToImage(canvasX, canvasY, clamp = false) {
  let imageX = (canvasX - state.view.offsetX) / state.view.scale;
  let imageY = (canvasY - state.view.offsetY) / state.view.scale;
  if (clamp && state.imageElement) {
    imageX = Math.max(0, Math.min(state.imageElement.naturalWidth - 1, imageX));
    imageY = Math.max(0, Math.min(state.imageElement.naturalHeight - 1, imageY));
  }
  return [imageX, imageY];
}

function insideImage(imageX, imageY) {
  return Boolean(
    state.imageElement
    && imageX >= 0
    && imageY >= 0
    && imageX < state.imageElement.naturalWidth
    && imageY < state.imageElement.naturalHeight
  );
}

function addStrokePoint(stroke, imageX, imageY, force = false) {
  const points = stroke.points;
  const elapsed = performance.now() - stroke.startedAtPerformance;
  if (points.length > 0 && !force) {
    const last = points.at(-1);
    const distance = Math.hypot(imageX - last[0], imageY - last[1]);
    if (distance < Math.max(0.8, state.brushDiameter * 0.08)) {
      return;
    }
  }
  points.push([imageX, imageY, elapsed]);
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function strokeTouches(stroke, imageX, imageY) {
  const threshold = (state.brushDiameter + stroke.brush_diameter_px) / 2;
  if (stroke.points.length === 1) {
    return Math.hypot(imageX - stroke.points[0][0], imageY - stroke.points[0][1]) <= threshold;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const current = stroke.points[index];
    if (distanceToSegment(imageX, imageY, previous[0], previous[1], current[0], current[1]) <= threshold) {
      return true;
    }
  }
  return false;
}

function eraseAt(imageX, imageY) {
  const record = currentRecord();
  if (!record) {
    return false;
  }
  const beforeCount = record.strokes.length;
  record.strokes = record.strokes.filter((stroke) => !strokeTouches(stroke, imageX, imageY));
  return record.strokes.length !== beforeCount;
}

function beginPointer(event) {
  if (!state.imageElement || state.pointer) {
    return;
  }
  const [canvasX, canvasY] = canvasCoordinates(event);
  state.cursor = { visible: true, x: canvasX, y: canvasY };
  const wantsPan = state.spaceDown || event.button === 1 || event.button === 2;
  if (wantsPan) {
    event.preventDefault();
    elements.canvas.setPointerCapture(event.pointerId);
    state.pointer = {
      id: event.pointerId,
      isPanning: true,
      lastCanvasX: canvasX,
      lastCanvasY: canvasY,
    };
    elements.stage.classList.add("is-panning");
    return;
  }
  if (event.button !== 0) {
    return;
  }

  const [imageX, imageY] = canvasToImage(canvasX, canvasY);
  if (!insideImage(imageX, imageY)) {
    return;
  }
  event.preventDefault();
  elements.canvas.setPointerCapture(event.pointerId);
  const record = currentRecord();
  const before = snapshotRecord(record);
  state.pointer = {
    id: event.pointerId,
    isPanning: false,
    before,
    changed: false,
  };

  if (state.activeTool === "eraser") {
    state.pointer.changed = eraseAt(imageX, imageY);
  } else {
    state.currentStroke = {
      id: randomId("stroke"),
      class_id: state.activeTool,
      brush_diameter_px: state.brushDiameter,
      created_at_utc: new Date().toISOString(),
      points: [],
      startedAtPerformance: performance.now(),
    };
    addStrokePoint(state.currentStroke, imageX, imageY, true);
    state.pointer.changed = true;
  }
  render();
}

function movePointer(event) {
  const [canvasX, canvasY] = canvasCoordinates(event);
  state.cursor = { visible: true, x: canvasX, y: canvasY };
  if (!state.pointer || state.pointer.id !== event.pointerId) {
    render();
    return;
  }
  event.preventDefault();
  if (state.pointer.isPanning) {
    state.view.offsetX += canvasX - state.pointer.lastCanvasX;
    state.view.offsetY += canvasY - state.pointer.lastCanvasY;
    state.pointer.lastCanvasX = canvasX;
    state.pointer.lastCanvasY = canvasY;
    render();
    return;
  }

  const [rawX, rawY] = canvasToImage(canvasX, canvasY);
  if (!insideImage(rawX, rawY)) {
    render();
    return;
  }
  const [imageX, imageY] = canvasToImage(canvasX, canvasY, true);
  if (state.activeTool === "eraser") {
    state.pointer.changed = eraseAt(imageX, imageY) || state.pointer.changed;
  } else if (state.currentStroke) {
    addStrokePoint(state.currentStroke, imageX, imageY);
  }
  render();
}

function endPointer(event, cancelled = false) {
  if (!state.pointer || state.pointer.id !== event.pointerId) {
    return;
  }
  const pointer = state.pointer;
  try {
    elements.canvas.releasePointerCapture(event.pointerId);
  } catch {
    // The browser may already have released capture after pointercancel.
  }
  elements.stage.classList.remove("is-panning");
  state.pointer = null;

  if (pointer.isPanning) {
    render();
    return;
  }
  const record = currentRecord();
  if (cancelled) {
    restoreRecord(record, pointer.before);
    state.currentStroke = null;
    render();
    return;
  }
  if (state.currentStroke) {
    const { startedAtPerformance, ...savedStroke } = state.currentStroke;
    void startedAtPerformance;
    record.strokes.push(savedStroke);
    state.currentStroke = null;
  }
  if (pointer.changed) {
    record.review_status = "in_progress";
    record.reviewed_at_utc = null;
    commitMutation(pointer.before);
  } else {
    render();
  }
}

function cancelPointerOperation(restore = false) {
  if (!state.pointer) {
    return;
  }
  const pointer = state.pointer;
  const record = currentRecord();
  if (restore && record && pointer.before) {
    restoreRecord(record, pointer.before);
  }
  state.pointer = null;
  state.currentStroke = null;
  elements.stage.classList.remove("is-panning");
}

function markReviewedAndNext() {
  const record = currentRecord();
  if (!record) {
    return;
  }
  const before = snapshotRecord(record);
  record.review_status = "reviewed";
  record.reviewed_at_utc = new Date().toISOString();
  commitMutation(before);
  if (state.currentIndex < state.descriptors.length - 1) {
    loadImage(state.currentIndex + 1);
  } else {
    showToast("All loaded images have been reached. You can export or revisit any image.");
  }
}

function toggleOverlay() {
  state.showOverlay = !state.showOverlay;
  elements.overlayButton.classList.toggle("active", state.showOverlay);
  elements.overlayButton.setAttribute("aria-pressed", String(state.showOverlay));
  render();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBaseName() {
  const safeName = state.session.dataset_name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "coral_scribbles";
  const date = new Date().toISOString().slice(0, 10);
  return `${safeName}_${date}`;
}

function exportJson() {
  const document = documentForExport(state.session);
  downloadBlob(
    new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: "application/json" }),
    `${exportBaseName()}.json`,
  );
  showToast("JSON annotation backup exported.");
}

function exportCsv() {
  downloadBlob(
    new Blob([sessionToCsv(state.session)], { type: "text/csv;charset=utf-8" }),
    `${exportBaseName()}.csv`,
  );
  showToast("CSV point and stroke table exported.");
}

async function importJsonFile(file) {
  try {
    const imported = normalizeSession(JSON.parse(await file.text()));
    state.session = imported;
    for (const descriptor of state.descriptors) {
      ensureImage(state.session, descriptor);
    }
    state.histories.clear();
    scheduleSave();
    updateInterface();
    render();
    showToast(
      state.descriptors.length
        ? "Imported annotations. Paths matching the loaded images are now visible."
        : "Imported annotations. Open the matching image folder to continue.",
      5000,
    );
  } catch (error) {
    console.error(error);
    showToast(`Could not import annotations: ${error.message}`, 6000);
  }
}

function changeImage(delta) {
  const nextIndex = state.currentIndex + delta;
  if (nextIndex >= 0 && nextIndex < state.descriptors.length) {
    loadImage(nextIndex);
  }
}

function handleKeyDown(event) {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (typing || elements.helpDialog.open) {
    return;
  }
  if (event.code === "Space") {
    state.spaceDown = true;
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  const key = event.key.toLocaleLowerCase();
  const toolKeys = { r: "rubble", s: "sediment", u: "unsure", e: "eraser" };
  if (toolKeys[key]) {
    setTool(toolKeys[key]);
    return;
  }
  if (key === "f") {
    fitImage();
  } else if (key === "o") {
    toggleOverlay();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    changeImage(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    changeImage(1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    markReviewedAndNext();
  } else if (event.key === "[") {
    setBrushDiameter(state.brushDiameter - 4);
  } else if (event.key === "]") {
    setBrushDiameter(state.brushDiameter + 4);
  }
}

function wireEvents() {
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });
  document.querySelectorAll("[data-open-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      void openImageFolder();
    });
  });
  elements.brushSize.addEventListener("input", () => setBrushDiameter(elements.brushSize.value));
  elements.folderInput.addEventListener("change", async () => {
    await loadFolderFiles(elements.folderInput.files);
    elements.folderInput.value = "";
  });
  elements.fileInput.addEventListener("change", async () => {
    await loadFolderFiles(elements.fileInput.files);
    elements.fileInput.value = "";
  });
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", async () => {
    const [file] = elements.importInput.files;
    if (file) {
      await importJsonFile(file);
    }
    elements.importInput.value = "";
  });
  elements.exportJsonButton.addEventListener("click", exportJson);
  elements.exportCsvButton.addEventListener("click", exportCsv);
  elements.helpButton.addEventListener("click", () => elements.helpDialog.showModal());
  elements.demoButton.addEventListener("click", loadDemo);
  elements.imageSearch.addEventListener("input", updateImageList);
  elements.fitButton.addEventListener("click", fitImage);
  elements.zoomOutButton.addEventListener("click", () => zoomAt(0.8));
  elements.zoomInButton.addEventListener("click", () => zoomAt(1.25));
  elements.overlayButton.addEventListener("click", toggleOverlay);
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  elements.previousButton.addEventListener("click", () => changeImage(-1));
  elements.nextButton.addEventListener("click", () => changeImage(1));
  elements.reviewNextButton.addEventListener("click", markReviewedAndNext);
  elements.annotatorInput.addEventListener("input", () => {
    state.session.annotator = elements.annotatorInput.value.trim();
    scheduleSave();
  });
  elements.imageNotes.addEventListener("input", () => {
    const record = currentRecord();
    if (record) {
      record.notes = elements.imageNotes.value;
      scheduleSave();
    }
  });

  elements.canvas.addEventListener("pointerdown", beginPointer);
  elements.canvas.addEventListener("pointermove", movePointer);
  elements.canvas.addEventListener("pointerup", (event) => endPointer(event));
  elements.canvas.addEventListener("pointercancel", (event) => endPointer(event, true));
  elements.canvas.addEventListener("pointerleave", () => {
    if (!state.pointer) {
      state.cursor.visible = false;
      render();
    }
  });
  elements.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  elements.canvas.addEventListener("wheel", (event) => {
    if (!state.imageElement) {
      return;
    }
    event.preventDefault();
    const [x, y] = canvasCoordinates(event);
    zoomAt(Math.exp(-event.deltaY * 0.0012), x, y);
  }, { passive: false });

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      state.spaceDown = false;
    }
  });
  window.addEventListener("blur", () => {
    state.spaceDown = false;
    cancelPointerOperation(true);
    render();
  });
  window.addEventListener("beforeunload", localBackup);
  new ResizeObserver(resizeCanvas).observe(elements.stage);
}

async function initialize() {
  wireEvents();
  setTool("rubble");
  setBrushDiameter(24);
  resizeCanvas();
  updateInterface();
  const localServerHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (localServerHosts.has(window.location.hostname)) {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const config = await response.json();
        if (config.mode === "local" && config.images?.length) {
          await loadServerDataset(config);
        }
      }
    } catch {
      // The standalone local server is optional; manual file selection still works.
    }
  }
}

initialize();
