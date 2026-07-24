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
   image. Undo and redo remain available.
6. Select **Export CSV** before closing or changing computers, then send that
   CSV file to the project team.

The browser keeps a convenience autosave for the selected dataset, but that
backup belongs to one browser profile on one device. Exported CSV is the
durable research record.

To continue an exported session, select the same folder or files and then use
**Import CSV**.

## Dot Counts

| Label | Hotkey | Stored value |
| --- | --- | ---: |
| Live | `L` | `0` |
| DSC | `D` | `1` |
| Rubble | `R` | `2` |
| Sediment | `S` | `3` |
| Unknown / other | `U` | `4` |

The CSV reports percentages over the whole image and percentages over usable
area after removing Unknown / other. Completed images with more than 50%
Unknown / other are excluded from dataset cover summaries; exactly 50% remains
included.

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

GitHub Pages publishes the root of the `main` branch. Any change to the public
app should pass the tests and be checked with the demo image before release.

## License

[MIT](LICENSE)
