# XAS Workbench

A static, browser-only XAFS analysis workbench for education and preliminary analysis.

## Features

- Load DAT, XMU, CSV, and TXT files with column mapping.
- Use a direct mu(E) column or calculate transmission data with `ln(I0 / I1)`.
- Detect E0 from the maximum derivative.
- Run pre-edge removal, post-edge polynomial normalization, and flattening.
- Extract chi(k) with a smoothing background approximation.
- View Hanning / Kaiser-Bessel windows and k-weighted Fourier transforms.
- Overlay multiple datasets, zoom plots, edit legends, and export CSV output.

## Local Development

```bash
npm start
```

Open `http://localhost:8080` in a browser. The app does not require a backend API.

## Tests

```bash
npm test
```

## Vercel Deployment

This project is a static HTML/CSS/JavaScript app. Configure Vercel as:

- Framework Preset: `Other`
- Build Command: empty
- Output Directory: `.`
- Root Directory: `XAS-Viewer` if this folder is deployed from a larger repository

The repository includes `vercel.json` for static output and security headers. It also includes `.vercelignore` so local measurement files under `data/` are not uploaded by Vercel CLI deployments.

Do not commit private measurement files. Keep real datasets outside Git, or place them under `data/`, which is ignored.

The UI uses local system font fallbacks and does not depend on external font requests.

Vercel Web Analytics is included with the plain HTML script at `/_vercel/insights/script.js`. Enable Web Analytics in the Vercel project dashboard for page views to appear.

## Browser Limits

Analysis runs entirely in the user's browser. To avoid freezing low-memory devices, the importer rejects files larger than 25 MB or parsed datasets above 200,000 rows.

## Note

The background removal is a browser-friendly smoothing approximation, not a full Autobk port. For quantitative analysis, compare results against tools such as Athena or Larch.
