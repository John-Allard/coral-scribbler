# Coral Scribbler

Coral Scribbler is a focused browser tool for rapid 50-dot coral cover counts
and optional sparse rubble/sediment annotations in underwater images.

**Open the app:** https://john-allard.github.io/coral-scribbler/

The app runs entirely in the browser. Selected images and annotations are not
uploaded to GitHub or any other server.

## Annotate a Dataset

1. Open the app in a current desktop browser.
2. Enter your name under **Annotator**.
3. Drag the dataset folder onto the start panel, or choose **Select dataset
   folder**. Chrome may label the folder permission **Upload** even though the
   app reads the files locally and does not send them over the network. If
   folder selection is unavailable, choose **Choose individual image files**.
4. For each highlighted query dot, press `L`, `D`, `R`, `S`, or `U` to classify
   it as Live, DSC, Rubble, Sediment, or Unknown / other. The next dot appears
   immediately.
5. After all 50 dots are classified, press `Enter` to continue to the next
   image. To correct an earlier classification, click its colored dot and press
   the correct class key. Undo and redo remain available.
6. Select **Save session CSV** before closing or changing computers, then send
   that CSV file to the project team.

The **Dot diameter** slider scales to the current image dimensions. Its range
is 4-16 pixels on the 1200x720 demo and proportionally larger on larger images.
The query dot uses an exact-footprint marker that blinks discretely between
black and white. A 200 ms arrival ring identifies each newly active query dot.
Blinking can be disabled, and the query dot can be switched between a hollow
ring and a solid dot. Class hotkeys can be replaced with any five unique
letters or numbers; **Reset** restores `L/D/R/S/U`.

The Unknown / other exclusion threshold defaults to 50% and can be changed in
the left panel. When a completed image exceeds that threshold, **Re-scatter 50
dots once** replaces its sample with one new random sample. Re-scattering is
limited to one attempt per image and recorded in the CSV.

Every dot, hotkey change, marker setting, note, and image position is autosaved
in the current browser. After reloading the page, select the same dataset folder
again; the app restores the matching browser backup and returns to the last
open image. Browser security prevents the page from reopening local image files
without that folder selection.

The browser backup belongs to one browser profile on one device and can be
lost if site data is cleared or private browsing ends. **Save session CSV** is
the durable research record. To continue one, select the same folder or files
and then use **Resume session CSV**. If a selected CSV has less progress,
older timestamps, or mismatched image paths, the app keeps the current session
unless the user explicitly confirms replacement. Confirmed replacement first
downloads a timestamped backup of the current session.

## Dot Counts

| Label | Hotkey | Stored value |
| --- | --- | ---: |
| Live | `L` | `0` |
| DSC | `D` | `1` |
| Rubble | `R` | `2` |
| Sediment | `S` | `3` |
| Unknown / other | `U` | `4` |

The CSV reports percentages over the whole image and percentages over usable
area after removing Unknown / other. Completed images above the configured
Unknown / other threshold are excluded from dataset cover summaries; the
default is more than 50%, so exactly 50% remains included.

Annotators classify the category covering the majority of the visible dot
footprint. The exported coordinate is therefore a localized, noisy
majority-footprint label, not a claim that every pixel covered by the marker
belongs to that class.

Optional **Scribble** mode remains available for collecting spatial
rubble/sediment examples. Dot coordinates, stroke coordinates, and brush
diameters use original-image pixels, so zooming does not change labels. See
[docs/annotation-format.md](docs/annotation-format.md) for the export format.

## Privacy and Deployment

This repository contains only HTML, CSS, and JavaScript. The GitHub Pages site
downloads those application files, then reads selected images through the
browser's local file picker. It has no analytics, external fonts, API calls, or
upload endpoint.

To run a local copy, serve the repository with any static HTTP server, for
example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Development

There are no runtime dependencies. The data-model tests require Node.js:

```bash
npm test
```

The `Deploy Pages` workflow publishes the static site after every push to
`main`. The separate model-test workflow runs only when JavaScript, tests, or
package metadata change.

## License

[MIT](LICENSE)
