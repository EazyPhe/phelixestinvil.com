import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
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
const htmlFiles = files.filter((file) => extname(file) === ".html");
const unresolvedPattern = /\[(?:Start Date|Start Year|End Year|Dates)\]/i;
const linkPattern = /(?:href|src)=["']([^"']+)["']/g;

for (const htmlFile of htmlFiles) {
  const html = await readFile(htmlFile, "utf8");

  if (unresolvedPattern.test(html)) {
    throw new Error(`Unresolved résumé placeholder in ${htmlFile}`);
  }

  for (const match of html.matchAll(linkPattern)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:|data:|#)/.test(reference)) continue;

    const withoutFragment = reference.split(/[?#]/, 1)[0];
    if (!withoutFragment) continue;

    let target = resolve(dirname(htmlFile), withoutFragment);
    if (withoutFragment.endsWith("/")) target = resolve(target, "index.html");
    await access(target);
  }

  const externalBlankLinks = [
    ...html.matchAll(/<a\b(?=[^>]*target=["']_blank["'])[^>]*>/gi)
  ];
  for (const link of externalBlankLinks) {
    if (!/rel=["'][^"']*noopener[^"']*["']/i.test(link[0])) {
      throw new Error(`External link missing rel=noopener in ${htmlFile}`);
    }
  }
}

console.log(`Site checks passed (${htmlFiles.length} HTML pages, ${files.length} source files).`);

