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

The PDF is checked in at `src/assets/Phelix-Estinvil-Resume.pdf`. CI and deployment regenerate it from the résumé HTML using Python 3.11 and ReportLab 4.4.9 before the static build. To regenerate it locally, run `python scripts/build-resume.py` in an environment with ReportLab installed. The generator embeds ReportLab's bundled Vera fonts and works across operating systems.

Maintain résumé copy in `src/resume/index.html`. The generator reads the profile and semantic résumé sections directly; there are no fixed role or bullet counts. A `data-pdf-page-start` section starts a new PDF page, and the generator fails if the result exceeds two pages. Render and inspect both pages after changes before committing the PDF.

`npm run check` validates local pages, assets, link fragments, duplicate IDs, required metadata, and JavaScript syntax. Before release, also check desktop and mobile navigation, project anchors, the PDF download, and browser console output.

## Remodeling photo galleries

The Projects page contains a static, locally hosted photo selection at
`/projects/#remodeling-custom-builds`. Each project keeps its title, description,
image order, alt text, captions, and supplemental Google Photos links together in
`src/projects/index.html`. Public album copies contain only the approved, metadata-stripped
selection and use neutral project titles; the original source albums remain private
review references and must not be linked from the site. The two floating-bed albums have distinct links within
one project entry; do not infer a shared chronology from their album order.

Website derivatives belong in `src/assets/projects/remodeling/<project>/`.
Keep original downloads, album ZIPs, private source mappings, and review contact
sheets outside the repository and `src/`. Only reviewed selections belong in the
site. Use neutral filenames without client names or addresses, apply source
orientation before export, strip identifying metadata, and do not upscale.

Each photo uses responsive WebP sources with JPEG fallbacks and an ordinary link
to a larger local JPEG. The shared script progressively enhances those links
with a native dialog: close or Escape, previous/next buttons or arrow keys, an
image counter, captions, and focus return. Without JavaScript, the image links
still work. Each `article[data-gallery]` defines a separate image group.

After changing a gallery, run both existing package scripts and check the built
site at desktop, tablet, and approximately 390px mobile width. Exercise every
gallery, keyboard controls, focus return, the mobile menu, no-JavaScript image
links, the five album links, and existing résumé downloads. Review the public
build for unselected originals or private material. Album links can reveal names
or other information on Google Photos even when the website copies are clean;
review those destinations separately before publication.

## Publication status

Published through GitHub Pages at https://phelixestinvil.com/ with HTTPS. The homepage and online résumé both link to the PDF download.
