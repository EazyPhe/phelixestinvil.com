# phelixestinvil.com

Source for Phelix Estinvil's professional résumé and technical portfolio.

## Current foundation

- One-page professional overview
- Experience and core-capabilities sections
- Selected-project index with expandable case-study structure
- Web résumé page and downloadable three-page PDF with portrait
- Responsive navigation and accessible focus states
- Dependency-free static build
- Non-deploying GitHub Actions verification

Unverified employment dates and unsupported performance claims are omitted. The PDF includes the professional contact details from the original résumé and the updated experience content from the website.

## Local commands

```bash
npm ci
npm run check
npm run build
```

The production-ready static output is written to `dist/`.

## Updating the résumé PDF

The PDF is checked in at `src/assets/Phelix-Estinvil-Resume.pdf`, so the static build needs no PDF dependencies. To regenerate it, run `python scripts/build-resume.py` in an environment with ReportLab, DejaVu TrueType fonts, and Nimbus Sans Type 1 fonts installed at the paths declared in the script.

The generator reads the summary and all 20 experience bullets from `src/resume/index.html` and uses the original portrait. Its contact details, capabilities, and project descriptions are maintained in the script. Render and inspect all pages after changes before committing the PDF.

## Publication status

Published through GitHub Pages at https://phelixestinvil.com/ with HTTPS. The homepage and online résumé both link to the PDF download.
