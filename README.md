# Coral Scribbler

Coral Scribbler is a focused browser tool for collecting sparse expert labels
that distinguish coral rubble from sediment in underwater images.

**Open the app:** https://john-allard.github.io/coral-scribbler/

The app runs entirely in the browser. Selected images and annotations are not
uploaded to GitHub or any other server.

## Annotate a Dataset

1. Open the app in a current desktop browser.
2. Enter your name under **Annotator**.
3. Choose **Open image folder**. If folder selection is unavailable, choose
   **Choose individual image files** instead.
4. Paint short, confident strokes inside rubble or sediment regions. Leave
   boundaries and unrelated classes unpainted.
5. Mark each completed image as reviewed.
6. Select **Export JSON** before closing or changing computers, then send that
   JSON file to the project team. CSV export is provided for inspection.

The browser keeps a convenience autosave for the selected dataset, but that
backup belongs to one browser profile on one device. Exported JSON is the
durable research record.

To continue an exported session, select the same folder or files and then use
**Import JSON**.

## Labels

| Label | Meaning | Training value |
| --- | --- | ---: |
| Rubble | Dead coral that is no longer standing | `1` |
| Sediment | Unconsolidated substrate | `2` |
| Unsure | A recorded ambiguity, excluded from supervised training | none |
| Unpainted | Unlabeled, not background and not sediment | `0` / ignore |

Coordinates and brush diameters are stored in original-image pixels, so zooming
does not change the labels. See [docs/annotation-format.md](docs/annotation-format.md)
for the export format.

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
