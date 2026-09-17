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
Floating Bed Builds leads the Projects page as the featured project, before
the grouped project sections, and has the first project navigation link.
The entry includes the reviewed 1 minute 41 second
construction video and its poster. This edit is intentionally silent, with
interview footage and all original audio removed. Its native player preserves
the original framing, requires the visitor to start playback, and uses
`preload="none"`; an ordinary MP4 link remains available below the player.
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

## Marine and automotive photographs

The marine and independent automotive sections each include three selected
photographs in `src/projects/index.html`. They reuse the accessible project
viewer as separate gallery groups. Captions describe visible components and
disassembly without claiming a particular fault, repair outcome, or shared
before-and-after sequence.

Responsive WebP/JPEG derivatives live in `src/assets/projects/marine/` and
`src/assets/projects/automotive/`. They preserve the full framing and orientation,
contain no source EXIF or location metadata, and use neutral filenames. The
phone originals and private review mapping are not part of the published site.

## M5Stack interactive demo and walkthrough

The M5Stack project entry links to `/demos/m5stack/`, a beginner-friendly browser
tour using a versioned copy of the project's behavior simulator models. Four lessons
teach brightness, lighting patterns and a silent demo beat, connection interruption,
and local lights-off/restore. Each lesson explains what to try and what to watch for,
then verifies the model result before enabling Next. Free exploration, a glossary,
and a compact mobile stage are also available. This is a software demonstration; LVGL rendering,
radio timing, and physical DMX output require separate verification.

Demo source, provenance, and its optional rebuild instructions live in
`tools/m5-demo/`. The checked-in static export lives in `src/demos/m5stack/`, so
the normal website check/build/deployment continues to require no frontend build
dependencies. The public demo has no live hardware connection or audio-input access.

The Projects page includes an explained recording of the same browser demo at
`src/assets/projects/m5stack/m5-demo-walkthrough-v2.mp4`, its poster, an English
WebVTT caption track, and a narration/visual transcript. AI-generated narration,
chapter labels, control highlights, and permanently visible captions explain the
actions. The caption band sits below the browser recording and does not cover
controls. Playback is user initiated and uses `preload="none"`. The on-screen
demo beat is silent generated data; the video's voice is explanatory narration.
Recordings and the interactive model must stay labeled as simulations. Keep raw
voice clips, signed generation URLs, browser captures, and QA evidence outside the
repository. The original silent walkthrough remains available at its existing URL.

Before changing this demo, check keyboard and touch controls, mobile overflow,
pause/reset, reduced motion, simulated command delivery across a link interruption,
and Controller blackout. Verify the video plays and does not download on page load.

## Publication status

Published through GitHub Pages at https://phelixestinvil.com/ with HTTPS. The homepage and online résumé both link to the PDF download.
