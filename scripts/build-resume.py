"""Build a selectable-text technical resume from src/resume/index.html.

Requires ReportLab: python scripts/build-resume.py
All copy comes from semantic HTML sections, not fixed role or bullet counts.
ReportLab's bundled Vera fonts make the script portable across operating systems.
Add data-pdf-page-start to a resume section to start it on a new PDF page.
"""

from dataclasses import dataclass, field
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re

import reportlab
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    HRFlowable, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/resume/index.html"
OUTPUT = ROOT / "src/assets/Phelix-Estinvil-Resume.pdf"
SITE_URL = "https://phelixestinvil.com/"
FONT_DIR = Path(reportlab.__file__).resolve().parent / "fonts"
PAGE_WIDTH, PAGE_HEIGHT = letter
MARGIN = 43
INK = colors.HexColor("#172232")
TEXT = colors.HexColor("#334155")
COPPER = colors.HexColor("#874528")
LINE = colors.HexColor("#d7dde4")


@dataclass
class Element:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def find_all(self, tag=None, class_name=None, attr=None):
        matches = []
        for child in self.children:
            if isinstance(child, Element):
                if ((tag is None or child.tag == tag)
                        and (class_name is None or class_name in child.attrs.get("class", "").split())
                        and (attr is None or attr in child.attrs)):
                    matches.append(child)
                matches.extend(child.find_all(tag, class_name, attr))
        return matches

    def required(self, **criteria):
        matches = self.find_all(**criteria)
        if not matches:
            raise ValueError(f"Missing resume content: {criteria}")
        return matches[0]

    def text(self):
        value = "".join(child.text() if isinstance(child, Element) else child for child in self.children)
        return re.sub(r"\s+", " ", value).strip()


class ResumeParser(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Element(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def normalized(text):
    return text.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")


def inline(node):
    """Retain emphasis and safe, absolute hyperlinks in ReportLab markup."""
    if not isinstance(node, Element):
        return escape(normalized(node))
    content = "".join(inline(child) for child in node.children)
    if node.tag in {"strong", "b"}:
        return f"<b>{content}</b>"
    if node.tag in {"em", "i"}:
        return f"<i>{content}</i>"
    if node.tag == "br":
        return "<br/>"
    if node.tag == "a":
        from urllib.parse import urljoin
        href = urljoin(SITE_URL + "resume/", node.attrs.get("href", ""))
        if href.startswith(("https://", "mailto:")):
            return f'<link href="{escape(href, quote=True)}" color="#874528">{content}</link>'
    return content


def register_fonts():
    for name, filename in (("Resume", "Vera.ttf"), ("Resume-Bold", "VeraBd.ttf"),
                           ("Resume-Italic", "VeraIt.ttf"), ("Resume-BoldItalic", "VeraBI.ttf")):
        pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
    pdfmetrics.registerFontFamily("Resume", normal="Resume", bold="Resume-Bold",
                                  italic="Resume-Italic", boldItalic="Resume-BoldItalic")


def make_styles():
    base = dict(fontName="Resume", textColor=TEXT, alignment=TA_LEFT,
                fontSize=10, leading=14.1, spaceAfter=5)
    styles = {"body": ParagraphStyle("body", **base)}
    styles["name"] = ParagraphStyle("name", parent=styles["body"], fontName="Resume-Bold",
                                   fontSize=27, leading=32, textColor=INK, spaceAfter=5)
    styles["title"] = ParagraphStyle("title", parent=styles["body"], fontName="Resume-Bold",
                                    fontSize=11, leading=15, textColor=COPPER, spaceAfter=7)
    styles["contact"] = ParagraphStyle("contact", parent=styles["body"], fontSize=9, leading=12)
    styles["section"] = ParagraphStyle("section", parent=styles["body"], fontName="Resume-Bold",
                                      fontSize=11, leading=14.5, textColor=INK,
                                      spaceBefore=13, spaceAfter=8, keepWithNext=True)
    styles["entry"] = ParagraphStyle("entry", parent=styles["body"], fontName="Resume-Bold",
                                    fontSize=10.3, leading=14, textColor=INK,
                                    spaceBefore=5, spaceAfter=3, keepWithNext=True)
    styles["meta"] = ParagraphStyle("meta", parent=styles["body"], fontSize=8.8,
                                   leading=11.5, textColor=COPPER, keepWithNext=True, spaceAfter=5)
    styles["bullet"] = ParagraphStyle("bullet", parent=styles["body"], leftIndent=10,
                                     firstLineIndent=0, bulletIndent=0,
                                     bulletFontName="Resume", bulletFontSize=8, spaceAfter=3.7)
    return styles


class NumberedCanvas(canvas.Canvas):
    """Replay pages once their total is known; retain link annotations."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.saved_pages = []

    def showPage(self):
        self.linkURL(SITE_URL, (MARGIN, 21, MARGIN + 202, 33), relative=0)
        self.saved_pages.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        count = len(self.saved_pages)
        if count > 2:
            raise ValueError(f"Resume exceeds two pages ({count}); tighten content or adjust page breaks.")
        for state in self.saved_pages:
            self.__dict__.update(state)
            self.setStrokeColor(LINE)
            self.setLineWidth(0.5)
            self.line(MARGIN, 37, PAGE_WIDTH - MARGIN, 37)
            self.setFillColor(TEXT)
            self.setFont("Resume", 7.4)
            self.drawString(MARGIN, 24, "Phelix Estinvil  |  phelixestinvil.com")
            self.drawRightString(PAGE_WIDTH - MARGIN, 24, f"{self._pageNumber} / {count}")
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)


def section_flowables(section, styles):
    flowables = []
    if "data-pdf-page-start" in section.attrs:
        flowables.append(PageBreak())
    for child in section.children:
        if not isinstance(child, Element):
            continue
        if child.tag == "h2":
            flowables.append(Paragraph(inline(child), styles["section"]))
        elif child.tag == "p":
            flowables.append(Paragraph(inline(child), styles["body"]))
        elif child.tag == "article":
            entry = []
            for item in child.children:
                if not isinstance(item, Element):
                    continue
                if item.tag == "h3":
                    entry.append(Paragraph(inline(item), styles["entry"]))
                elif item.tag == "p":
                    style = "meta" if "role-meta" in item.attrs.get("class", "").split() else "body"
                    entry.append(Paragraph(inline(item), styles[style]))
                elif item.tag in {"ul", "ol"}:
                    entry.extend(Paragraph(inline(bullet), styles["bullet"], bulletText="-")
                                 for bullet in item.find_all(tag="li"))
            flowables.append(KeepTogether(entry))
            flowables.append(Spacer(1, 4))
        elif child.tag in {"ul", "ol"}:
            flowables.extend(Paragraph(inline(bullet), styles["bullet"], bulletText="-")
                             for bullet in child.find_all(tag="li"))
    return flowables


def build():
    parser = ResumeParser()
    parser.feed(SOURCE.read_text(encoding="utf-8"))
    sidebar = parser.root.required(tag="aside", class_name="resume-sidebar")
    name = sidebar.required(tag="h2").text()
    title = sidebar.required(attr="data-resume-title").text()
    location = sidebar.required(attr="data-resume-location").text()
    region = sidebar.required(attr="data-resume-region").text()
    email = next((node for node in sidebar.find_all(tag="a")
                  if node.attrs.get("href", "").startswith("mailto:")), None)
    if email is None:
        raise ValueError("Resume profile must include an email link.")
    website = sidebar.required(tag="a", attr="data-resume-website")
    sections = parser.root.find_all(tag="section", class_name="resume-section")
    if not sections:
        raise ValueError("No semantic resume sections found.")

    register_fonts()
    styles = make_styles()
    story = [
        Paragraph(escape(name), styles["name"]),
        Paragraph(escape(title), styles["title"]),
        Paragraph(escape(location) + "  |  " + inline(email), styles["contact"]),
        Paragraph(inline(website), styles["contact"]),
        Paragraph(escape(region), styles["contact"]),
        Spacer(1, 4),
        HRFlowable(width="100%", thickness=1.3, color=COPPER, spaceAfter=0),
    ]
    for section in sections:
        story.extend(section_flowables(section, styles))

    def continuation_header(pdf, document):
        if document.page > 1:
            pdf.saveState()
            pdf.setFont("Resume-Bold", 10)
            pdf.setFillColor(INK)
            pdf.drawString(MARGIN, PAGE_HEIGHT - 32, name)
            pdf.setFont("Resume", 8)
            pdf.setFillColor(COPPER)
            pdf.drawRightString(PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 32, "TECHNICAL RESUME")
            pdf.restoreState()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(str(OUTPUT), pagesize=letter,
                                 leftMargin=MARGIN, rightMargin=MARGIN,
                                 topMargin=43, bottomMargin=48,
                                 title=f"{name} | Technical Resume", author=name,
                                 subject="Marine diagnostics, carpentry, independent automotive repair, and embedded systems")
    document.build(story, onFirstPage=continuation_header,
                   onLaterPages=continuation_header, canvasmaker=NumberedCanvas)
    print(f"Built {OUTPUT}")
    print(f"Source: {SOURCE} ({len(sections)} semantic sections)")


if __name__ == "__main__":
    build()
