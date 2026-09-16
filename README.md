# phelixestinvil.com

Source for Phelix Estinvil's professional résumé and technical portfolio.

## Current foundation

- Employer-focused overview for technician roles across Cape Cod, the South Shore, and Boston
- Career story, professional experience, and technical capabilities
- Technical portfolio with real project imagery and a secondary design and marketing section
- Web résumé and matching, selectable-text two-page PDF
- Responsive navigation and accessible focus states
- Dependency-free static build
- GitHub Actions verification and automatic GitHub Pages deployment on `main`

Unverified employment dates and unsupported performance claims are omitted. Personal automotive work and independent electronics projects are distinguished from professional experience. Simulator imagery is identified in its caption. Employer contact is `estinvilp3@gmail.com`.

## Local commands

```bash
npm ci
npm run check
npm run build
```

The production-ready static output is written to `dist/`.

## Updating the résumé PDF

The PDF is checked in at `src/assets/Phelix-Estinvil-Resume.pdf`, so the static build needs no PDF dependencies. To regenerate it, run `python scripts/build-resume.py` in an environment with ReportLab installed. The generator embeds ReportLab's bundled Vera fonts and works across operating systems.

Maintain résumé copy in `src/resume/index.html`. The generator reads the profile and semantic résumé sections directly; there are no fixed role or bullet counts. A `data-pdf-page-start` section starts a new PDF page, and the generator fails if the result exceeds two pages. Render and inspect both pages after changes before committing the PDF.

`npm run check` validates local pages, assets, link fragments, duplicate IDs, required metadata, and JavaScript syntax. Before release, also check desktop and mobile navigation, project anchors, the PDF download, and browser console output.

## Publication status

Published through GitHub Pages at https://phelixestinvil.com/ with HTTPS. The homepage and online résumé both link to the PDF download.
