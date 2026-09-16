import { access, readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "src");
const requiredFiles = [
  "index.html",
  "projects/index.html",
  "resume/index.html",
  "assets/styles.css",
  "assets/site.js",
  "robots.txt",
  "sitemap.xml"
];

for (const file of requiredFiles) {
  await access(resolve(source, file));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = resolve(directory, entry.name);
      return entry.isDirectory() ? collectFiles(absolute) : [absolute];
    })
  );
  return nested.flat();
}

const files = await collectFiles(source);
const htmlFiles = files.filter((file) => extname(file).toLowerCase() === ".html");
const unresolvedPattern = /\[(?:Start Date|Start Year|End Year|Dates)\]/i;
const localOrigin = "https://site-check.invalid";
const documents = new Map();

function decodeEntities(value) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (entity, code) => {
    if (code[0] !== "#") return entities[code.toLowerCase()];
    const hex = code[1].toLowerCase() === "x";
    const point = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : "\ufffd";
  });
}

function decodeUri(value, context) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid URL encoding in ${context}: ${value}`);
  }
}

function tagsIn(html) {
  // This site uses static HTML; ignore comments and raw-text element contents.
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(
    /(<(script|style|textarea)\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?<\/\2\s*>/gi,
    "$1"
  );
  return [...markup.matchAll(/<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)].map((tag) => {
    const attributes = new Map();
    for (const attribute of tag[2].matchAll(/([^\s=<>/'"]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attributes.set(attribute[1].toLowerCase(), decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""));
    }
    return { name: tag[1].toLowerCase(), attributes };
  });
}

for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, "utf8");
  const tags = tagsIn(html);
  const ids = new Set();
  const anchors = new Set();

  if (unresolvedPattern.test(html)) {
    throw new Error(`Unresolved résumé placeholder in ${htmlFile}`);
  }

  if (!/<title\b[^>]*>\s*[^<\s][^<]*<\/title\s*>/i.test(html)) {
    throw new Error(`Missing nonempty page title in ${htmlFile}`);
  }
  if (!tags.some(({ name, attributes }) => name === "meta"
    && attributes.get("name")?.toLowerCase() === "description"
    && attributes.get("content")?.trim())) {
    throw new Error(`Missing nonempty description in ${htmlFile}`);
  }
  if (!tags.some(({ name, attributes }) => name === "link"
    && attributes.get("rel")?.toLowerCase().split(/\s+/).includes("canonical")
    && /^https?:\/\/[^\s]+$/i.test(attributes.get("href") ?? ""))) {
    throw new Error(`Missing absolute canonical URL in ${htmlFile}`);
  }

  for (const { name, attributes } of tags) {
    const id = attributes.get("id");
    if (id) {
      if (ids.has(id)) throw new Error(`Duplicate id="${id}" in ${htmlFile}`);
      ids.add(id);
      anchors.add(id);
    }
    if (name === "a" && attributes.get("name")) anchors.add(attributes.get("name"));

    if (name === "a" && attributes.get("target")?.toLowerCase() === "_blank"
      && !attributes.get("rel")?.toLowerCase().split(/\s+/).includes("noopener")) {
      throw new Error(`External link missing rel=noopener in ${htmlFile}`);
    }
  }
  documents.set(htmlFile, { tags, anchors });
}

for (const [htmlFile, { tags }] of documents) {
  const pagePath = relative(source, htmlFile).split(sep).map(encodeURIComponent).join("/");
  const pageUrl = new URL(pagePath, `${localOrigin}/`);

  for (const { attributes } of tags) {
    for (const attribute of ["href", "src"]) {
      if (!attributes.has(attribute)) continue;
      const reference = attributes.get(attribute).trim();
      // External URLs and URI schemes are not fetched by this local check.
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) continue;
      if (!reference && attribute === "src") {
        throw new Error(`Empty src in ${htmlFile}`);
      }

      const url = new URL(reference, pageUrl);
      if (url.origin !== localOrigin) continue;
      const pathname = decodeUri(url.pathname, `${htmlFile} ${attribute}`);
      let target = resolve(source, `.${pathname}`);
      const withinSource = relative(source, target);
      if (withinSource === ".." || withinSource.startsWith(`..${sep}`) || isAbsolute(withinSource)) {
        throw new Error(`Local reference escapes src in ${htmlFile}: ${reference}`);
      }

      try {
        if ((await stat(target)).isDirectory()) target = resolve(target, "index.html");
        if (!(await stat(target)).isFile()) throw new Error("Target is not a file");
      } catch (error) {
        throw new Error(`Missing local ${attribute} target in ${htmlFile}: ${reference}`, { cause: error });
      }

      if (url.hash && documents.has(target)) {
        // Text fragments may optionally follow a normal element fragment.
        const fragment = decodeUri(url.hash.slice(1).split(":~:text=", 1)[0], `${htmlFile} fragment`);
        const targetAnchors = documents.get(target).anchors;
        if (fragment && !targetAnchors.has(fragment) && fragment.toLowerCase() !== "top") {
          throw new Error(`Missing fragment #${fragment} in ${target}, linked from ${htmlFile}: ${reference}`);
        }
      }
    }
  }
}

console.log(`Site checks passed (${htmlFiles.length} HTML pages, ${files.length} source files).`);

