"""Render the professional resume PDF from the published experience copy.

Requires ReportLab. Run: python scripts/build-resume.py
The source portrait is clipped in the PDF; its original pixels are unchanged.
"""

from html import unescape, escape
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/assets/Phelix-Estinvil-Resume.pdf"
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
for name, filename in [("ResumeSans", "DejaVuSans.ttf"),
                       ("ResumeSans-Bold", "DejaVuSans-Bold.ttf"),
                       ("ResumeSerif", "DejaVuSerif.ttf")]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
pdfmetrics.registerFontFamily("ResumeSans", normal="ResumeSans", bold="ResumeSans-Bold")
for name in ["NimbusSans-Regular", "NimbusSans-Bold"]:
    face = pdfmetrics.EmbeddedType1Face(
        f"/usr/share/fonts/type1/urw-base35/{name}.afm",
        f"/usr/share/fonts/X11/Type1/{name}.pfb",
    )
    pdfmetrics.registerTypeFace(face)
    pdfmetrics.registerFont(pdfmetrics.Font(name, face.name, "WinAnsiEncoding"))
pdfmetrics.registerFontFamily("NimbusSans-Regular", normal="NimbusSans-Regular", bold="NimbusSans-Bold")

INK = colors.HexColor("#172232")
TEXT = colors.HexColor("#334155")
COPPER = colors.HexColor("#874528")
LINE = colors.HexColor("#d7dde4")
SOFT = colors.HexColor("#f7f8fa")
PAGE_W, PAGE_H = 612, 792
LEFT, RIGHT, TOP, BOTTOM = 36, 576, 750, 56
WIDTH = RIGHT - LEFT

STYLES = {
    "body": ParagraphStyle("body", fontName="NimbusSans-Regular", fontSize=10.5,
                           leading=13.7, textColor=TEXT),
    "bullet": ParagraphStyle("bullet", fontName="NimbusSans-Regular", fontSize=10.5,
                             leading=13.7, textColor=TEXT),
    "role": ParagraphStyle("role", fontName="ResumeSans-Bold", fontSize=12,
                           leading=16, textColor=INK),
    "meta": ParagraphStyle("meta", fontName="ResumeSans-Bold", fontSize=9.3,
                           leading=13, textColor=COPPER),
    "small": ParagraphStyle("small", fontName="ResumeSans", fontSize=9.4,
                            leading=13.5, textColor=TEXT),
}


def clean(value):
    value = unescape(value)
    return value.replace("—", "-").replace("–", "-").replace("‑", "-")


def plain(value):
    return clean(re.sub(r"<[^>]+>", "", value)).strip()


def markup(value):
    value = re.sub(r"<strong>", "<b>", value)
    value = re.sub(r"</strong>", "</b>", value)
    return clean(value)


html = (ROOT / "src/resume/index.html").read_text()
experience_html = re.search(r'<section class="resume-section resume-experience".*?</section>', html, re.S).group()
roles = []
for article in re.findall(r"<article.*?</article>", experience_html, re.S):
    heading = plain(re.search(r"<h3>(.*?)</h3>", article, re.S).group(1))
    role, employer = heading.split(" - ", 1)
    meta = plain(re.search(r"<p>(.*?)</p>", article, re.S).group(1))
    roles.append((role, employer, meta, [markup(x) for x in re.findall(r"<li>(.*?)</li>", article, re.S)]))
assert [len(role[3]) for role in roles] == [5, 5, 10]
summary_section = re.search(r'<section class="resume-section" aria-labelledby="resume-summary">(.*?)</section>', html, re.S).group(1)
summary = plain(re.search(r"<p>(.*?)</p>", summary_section, re.S).group(1))

c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
c.setTitle("Phelix Estinvil | Professional Resume")
c.setAuthor("Phelix Estinvil")
c.setSubject("Marine diagnostics, remodeling, event technology, and embedded systems")
c.setCreator("Phelix Estinvil - phelixestinvil.com")


def para(text, y, style="body", x=LEFT, width=WIDTH):
    p = Paragraph(text, STYLES[style])
    _, height = p.wrap(width, PAGE_H)
    if y - height < BOTTOM:
        raise ValueError(f"Page {c.getPageNumber()} overflow at {plain(text)[:70]}: {y-height:.1f}")
    p.drawOn(c, x, y - height)
    return y - height


def section(title, y):
    c.setFillColor(INK)
    c.setFont("ResumeSerif", 17)
    c.drawString(LEFT, y - 17, title)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(LEFT, y - 25, RIGHT, y - 25)
    c.setStrokeColor(COPPER)
    c.setLineWidth(1.7)
    c.line(LEFT, y - 25, LEFT + 30, y - 25)
    return y - 32


def role_block(role, y):
    title, employer, meta, duties = role
    c.setFillColor(COPPER)
    c.rect(LEFT, y - 28, 2, 27, stroke=0, fill=1)
    y = para(escape(title) + " - " + escape(employer), y, "role", x=LEFT+10, width=WIDTH-10)
    y = para(escape(meta), y - 3, "meta", x=LEFT+10, width=WIDTH-10) - 10
    for duty in duties:
        c.setFillColor(COPPER)
        c.circle(LEFT+3, y - 6.5, 1.5, stroke=0, fill=1)
        y = para(duty, y, "bullet", x=LEFT+14, width=WIDTH-14) - 4
    return y


def footer(page):
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(LEFT, 38, RIGHT, 38)
    c.setFillColor(TEXT)
    c.setFont("ResumeSans", 8)
    c.drawString(LEFT, 24, "Phelix Estinvil  |  Professional Resume")
    c.drawRightString(RIGHT, 24, f"{page} / 3")
    c.linkURL("https://phelixestinvil.com/", (LEFT, 20, LEFT+205, 34), relative=0)


def continued_header(label):
    c.setFillColor(INK)
    c.setFont("ResumeSerif", 18)
    c.drawString(LEFT, TOP-18, "Phelix Estinvil")
    c.setFillColor(COPPER)
    c.setFont("ResumeSans", 8.7)
    c.drawRightString(RIGHT, TOP-16, label.upper())
    return TOP - 38


def portrait():
    # Match the website's 4:5 crop and 35% vertical object-position.
    x, y, w, h = RIGHT-88, TOP-110, 88, 110
    c.setStrokeColor(colors.HexColor("#d9c5b8"))
    c.setFillColor(colors.white)
    c.roundRect(x-4, y-4, w+8, h+8, 5, stroke=1, fill=1)
    c.saveState()
    path = c.beginPath()
    path.rect(x, y, w, h)
    c.clipPath(path, stroke=0)
    image_h = w * 1536 / 747
    c.drawImage(str(ROOT / "src/assets/phelix-estinvil.jpg"), x, y-(image_h-h)*0.65,
                width=w, height=image_h)
    c.restoreState()


# Page 1: profile and technical field experience.
portrait()
c.setFillColor(INK)
c.setFont("ResumeSerif", 29)
c.drawString(LEFT, TOP-31, "Phelix Estinvil")
y = para("Multidisciplinary Technician &amp;<br/>Technical Problem-Solver", TOP-43, "role", width=WIDTH-123)
y = para('Cape Cod, Massachusetts  |  <link href="https://phelixestinvil.com/" color="#874528">phelixestinvil.com</link>', y-8, "small", width=WIDTH-113)
y = para('<link href="tel:+17742681245" color="#334155">774-268-1245</link>  |  <link href="mailto:estinvilp3@gmail.com" color="#334155">estinvilp3@gmail.com</link>', y-3, "small", width=WIDTH-123)
y = section("Professional Summary", min(y-16, TOP-130))
y = para(escape(summary), y) - 12
y = section("Experience", y)
y = role_block(roles[0], y) - 8
y = role_block(roles[1], y)
print(f"Page 1 content bottom: {y:.1f} pt")
footer(1)
c.showPage()

# Page 2: keep all ten current event-production duties together.
y = section("Experience", continued_header("Live events & technical operations"))
y = role_block(roles[2], y) - 12
y = section("Technical Capabilities", y)
capabilities = [
    ("Marine & mechanical", "Diesel and gasoline diagnostics; fuel, starting, charging, trim, and vessel-control systems; multimeter testing; preventive maintenance."),
    ("Electronics & embedded", "ESP32 / ESP32-S3; LVGL; PCB prototyping; sensors and battery monitoring; CAN bus; RS-485 / DMX512; Wi-Fi, BLE, and ESP-NOW."),
    ("Software & fabrication", "Python; C/C++; Git / GitHub; Linux and Windows; PlatformIO, Arduino, ESP-IDF, and KiCad; technical documentation; 3D printing; carpentry and remodeling."),
]
for label, text in capabilities:
    y = para(f"<b>{label}:</b> {text}", y, "small") - 7
print(f"Page 2 content bottom: {y:.1f} pt")
footer(2)
c.showPage()

# Page 3: latest projects, plus relevant technical work from the original PDF.
y = section("Selected Technical Projects", continued_header("Projects & education"))
projects = [
    ("M5Stack DJ Smart Hub", "Distributed lighting control",
     "Distributed ESP32-S3 lighting-control system combining live audio analysis, scene logic, low-latency wireless transport, interface controls, and DMX output. Develop LVGL touchscreen interfaces and diagnostic, configuration, firmware-update, and field-service concepts; maintain source code, architecture documentation, and revision history in Git."),
    ("ESP32 Smart-Light Retrofit", "Embedded hardware & fixture integration",
     "Rechargeable RGB-fixture retrofit with internal DMX injection, wired fallback, ESP-NOW control, fixture profiles, and safety states. Evaluate control electronics, communications, USB-C power, battery management, and LED-control architectures for distributed fixtures."),
    ("PhelixSlicer", "Software development & build workflows",
     "Orca-based slicer fork focused on Flashforge Adventurer 3 Pro support, reproducible Windows builds, and production profile validation."),
    ("Embedded Electronics & Power-System Development", "Independent technical projects",
     "Prototype ESP32-based monitoring and control systems using voltage, current, and sensor measurements. Work with ADCs, shunts, battery systems, CAN transceivers, motor drivers, and RS-485 interfaces; troubleshoot hardware/software integration and perform bench diagnostics using multimeters and laboratory power supplies."),
    ("Computer & Server Systems", "Development infrastructure & troubleshooting",
     "Configure Windows and Linux systems for development, networking, storage, and remote access. Work with Git workflows, local servers, SSH, and computer hardware; diagnose GPU, network, storage, driver, and operating-system problems."),
]
for title, meta, description in projects:
    y = para(escape(title), y, "role")
    y = para(escape(meta), y-2, "meta")
    y = para(escape(description), y-6) - 16
y = section("Education & Training", y)
y = para("Cape Cod Regional Technical High School", y, "role")
y = para("Carpentry Program · Harwich, Massachusetts", y-3, "meta")
y = para("Vocational training in carpentry, construction practices, tools, measurements, jobsite procedures, and residential building methods.", y-7) - 17
y = para('<link href="https://phelixestinvil.com/projects/" color="#874528">Project portfolio: phelixestinvil.com/projects/</link><br/><link href="https://djphelix.com/" color="#874528">DJ Phelix: djphelix.com</link>  |  <link href="https://clevercatcompany.com/" color="#874528">Clever Cat Company: clevercatcompany.com</link>', y, "small")
print(f"Page 3 content bottom: {y:.1f} pt")
footer(3)
c.save()
print(OUTPUT)
