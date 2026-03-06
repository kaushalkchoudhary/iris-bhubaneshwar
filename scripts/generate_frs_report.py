#!/usr/bin/env python3
"""IRIS FRS — Face Recognition Analytics Report Generator"""

from __future__ import annotations

import os, io, sys, argparse, json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict

import psycopg2
import psycopg2.extras
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether, Image as RLImage
)
from reportlab.platypus.flowables import Flowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

# ── Palette ───────────────────────────────────────────────────────────────────
NAV      = HexColor('#0B1726')
NAV_MID  = HexColor('#0F2133')
BLUE     = HexColor('#2563EB')
BLUE_LT  = HexColor('#3B82F6')
INDIGO   = HexColor('#4F46E5')
AMBER    = HexColor('#F59E0B')
RED      = HexColor('#EF4444')
GREEN    = HexColor('#10B981')
SILVER   = HexColor('#94A3B8')
LGREY    = HexColor('#CBD5E1')
VLIGHT   = HexColor('#F1F5F9')
WHITE    = HexColor('#FFFFFF')
DARK_TXT = HexColor('#1E293B')
MED_TXT  = HexColor('#334155')

PAGE_W, PAGE_H = A4          # 595 × 842 pt
MARGIN    = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
FOOTER_H  = 26
BOT_MARGIN = 72
TOP_MARGIN = 36

# ── Path helpers ──────────────────────────────────────────────────────────────
def url_to_filepath(url: str | None) -> str | None:
    """Convert /uploads/... URL to local filesystem path."""
    if not url:
        return None
    if url.startswith('/uploads/'):
        rel = url[len('/uploads/'):]
    else:
        return None
    upload_dir = os.environ.get('UPLOAD_DIR', '')
    if not upload_dir:
        home = Path.home()
        upload_dir = str(home / 'itms' / 'data')
    path = os.path.join(upload_dir, rel)
    return path if os.path.exists(path) else None


# ── Image helpers ─────────────────────────────────────────────────────────────
def fit_image(path: str, max_w: float, max_h: float = 9999.0):
    img = Image.open(path)
    iw, ih = img.size
    r = min(max_w / iw, max_h / ih)
    return iw * r, ih * r


def pil_draw(c, path: str, x: float, y: float, w: float, h: float, quality: int = 72):
    img = Image.open(path).convert("RGB")
    # Downsample to at most 2× the display resolution (72 dpi → 144 dpi max)
    max_px_w = int(w * 2)
    max_px_h = int(h * 2)
    if img.width > max_px_w or img.height > max_px_h:
        img.thumbnail((max_px_w, max_px_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    buf.seek(0)
    c.drawImage(ImageReader(buf), x, y, width=w, height=h, mask='auto')


def rl_image_from_path(path: str, max_w: float, max_h: float = 9999.0):
    """Return an RLImage flowable scaled to fit within max_w × max_h."""
    w, h = fit_image(path, max_w, max_h)
    img = Image.open(path).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    buf.seek(0)
    return RLImage(buf, width=w, height=h)


# ── Custom Flowables ──────────────────────────────────────────────────────────
class SectionHeader(Flowable):
    def __init__(self, number: str, title: str, width: float):
        super().__init__()
        self.number = number
        self.title = title
        self.width = width
        self.height = 48

    def draw(self):
        c = self.canv
        c.setFillColor(NAV)
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=0)
        c.setFillColor(INDIGO)
        c.roundRect(0, 0, 10, self.height, 5, fill=1, stroke=0)
        c.rect(5, 0, 5, self.height, fill=1, stroke=0)
        bx, by = 22, self.height / 2
        c.setFillColor(INDIGO)
        c.circle(bx, by, 14, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 12)
        c.drawCentredString(bx, by - 4.5, str(self.number))
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(46, self.height / 2 - 6, self.title.upper())


class PersonSectionHeader(Flowable):
    """A section header for a known person with name, category, threat level."""
    def __init__(self, name: str, category: str | None, threat: str | None, count: int, width: float):
        super().__init__()
        self.name = name
        self.category = category or ''
        self.threat = (threat or '').upper()
        self.count = count
        self.width = width
        self.height = 44

    def draw(self):
        c = self.canv
        threat_colors = {'HIGH': RED, 'MEDIUM': AMBER, 'LOW': GREEN}
        t_color = threat_colors.get(self.threat, BLUE_LT)

        c.setFillColor(NAV_MID)
        c.roundRect(0, 0, self.width, self.height, 5, fill=1, stroke=0)
        # Left accent bar
        c.setFillColor(t_color)
        c.rect(0, 0, 5, self.height, fill=1, stroke=0)

        # Name
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(16, self.height / 2 + 2, self.name)

        # Detection count badge
        badge_txt = f"{self.count} detection{'s' if self.count != 1 else ''}"
        bw = c.stringWidth(badge_txt, "Helvetica", 8) + 16
        bx = self.width - bw - 4
        by = (self.height - 16) / 2
        c.setFillColor(HexColor('#1E3A5F'))
        c.roundRect(bx, by, bw, 16, 4, fill=1, stroke=0)
        c.setFillColor(BLUE_LT)
        c.setFont("Helvetica", 8)
        c.drawCentredString(bx + bw / 2, by + 4, badge_txt)

        # Threat badge
        if self.threat:
            threat_txt = f"THREAT: {self.threat}"
            tw = c.stringWidth(threat_txt, "Helvetica-Bold", 7.5) + 14
            tx = bx - tw - 8
            c.setFillColor(t_color)
            c.roundRect(tx, by, tw, 16, 4, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont("Helvetica-Bold", 7.5)
            c.drawCentredString(tx + tw / 2, by + 4, threat_txt)

        # Category
        if self.category:
            c.setFillColor(SILVER)
            c.setFont("Helvetica", 8)
            c.drawString(16, self.height / 2 - 11, self.category)


class TwoImageCard(Flowable):
    """Face crop (left) + full scene (right) detection card."""
    def __init__(self, face_path: str | None, scene_path: str | None,
                 caption: str, confidence: float, timestamp: str, width: float):
        super().__init__()
        self.face_path = face_path
        self.scene_path = scene_path
        self.caption = caption
        self.confidence = confidence
        self.timestamp = timestamp
        self.width = width
        # Layout: face takes 30% of width, scene takes 70%, with gap
        self.face_w = width * 0.30
        self.scene_w = width * 0.68
        self.img_h = 110
        self.height = self.img_h + 30  # image + caption strip

    def draw(self):
        c = self.canv
        # Card background
        c.setFillColor(HexColor('#F8FAFC'))
        c.roundRect(0, 0, self.width, self.height, 5, fill=1, stroke=0)
        c.setStrokeColor(LGREY)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, self.width, self.height, 5, fill=0, stroke=1)

        img_top = self.height - 4
        img_bottom = 26

        # Face crop (left panel)
        face_bg_w = self.face_w + 4
        c.setFillColor(HexColor('#0F172A'))
        c.roundRect(2, img_bottom - 2, face_bg_w, self.img_h + 4, 4, fill=1, stroke=0)
        if self.face_path:
            try:
                fw, fh = fit_image(self.face_path, self.face_w - 4, self.img_h - 4)
                x_off = 4 + (self.face_w - fw) / 2
                y_off = img_bottom + (self.img_h - fh) / 2
                pil_draw(c, self.face_path, x_off, y_off, fw, fh)
            except Exception:
                pass
        else:
            c.setFillColor(HexColor('#1E293B'))
            c.rect(4, img_bottom, self.face_w - 4, self.img_h, fill=1, stroke=0)
            c.setFillColor(SILVER)
            c.setFont("Helvetica", 7)
            c.drawCentredString(4 + (self.face_w - 4) / 2, img_bottom + self.img_h / 2 - 4, "NO FACE")

        # Scene (right panel)
        scene_x = self.face_w + 10
        c.setFillColor(HexColor('#0F172A'))
        c.roundRect(scene_x - 2, img_bottom - 2, self.scene_w + 4, self.img_h + 4, 4, fill=1, stroke=0)
        if self.scene_path:
            try:
                sw, sh = fit_image(self.scene_path, self.scene_w - 4, self.img_h - 4)
                x_off = scene_x + (self.scene_w - sw) / 2
                y_off = img_bottom + (self.img_h - sh) / 2
                pil_draw(c, self.scene_path, x_off, y_off, sw, sh)
            except Exception:
                pass
        else:
            c.setFillColor(HexColor('#1E293B'))
            c.rect(scene_x, img_bottom, self.scene_w, self.img_h, fill=1, stroke=0)
            c.setFillColor(SILVER)
            c.setFont("Helvetica", 7)
            c.drawCentredString(scene_x + self.scene_w / 2, img_bottom + self.img_h / 2 - 4, "NO SCENE")

        # Label strip at bottom
        c.setFillColor(HexColor('#0F172A'))
        c.roundRect(2, 2, self.width - 4, 20, 3, fill=1, stroke=0)
        # Timestamp
        c.setFillColor(SILVER)
        c.setFont("Helvetica", 7.5)
        c.drawString(8, 7.5, self.timestamp)
        # Confidence
        if self.confidence > 0:
            conf_txt = f"Conf: {self.confidence:.1%}"
            c.setFillColor(GREEN if self.confidence >= 0.7 else AMBER)
            c.setFont("Helvetica-Bold", 7.5)
            c.drawRightString(self.width - 8, 7.5, conf_txt)
        # Camera caption
        c.setFillColor(HexColor('#93C5FD'))
        c.setFont("Helvetica", 7)
        # truncate if too long
        cap = self.caption[:50] + '…' if len(self.caption) > 50 else self.caption
        c.drawCentredString(self.width / 2, 7.5, cap)


class UnknownCard(Flowable):
    """Full scene card for unknown detection."""
    def __init__(self, scene_path: str | None, caption: str, timestamp: str, width: float):
        super().__init__()
        self.scene_path = scene_path
        self.caption = caption
        self.timestamp = timestamp
        self.width = width
        self.img_h = 95
        self.height = self.img_h + 28

    def draw(self):
        c = self.canv
        c.setFillColor(HexColor('#F8FAFC'))
        c.roundRect(0, 0, self.width, self.height, 5, fill=1, stroke=0)
        c.setStrokeColor(LGREY)
        c.setLineWidth(0.5)
        c.roundRect(0, 0, self.width, self.height, 5, fill=0, stroke=1)

        img_bottom = 26
        c.setFillColor(HexColor('#0F172A'))
        c.roundRect(2, img_bottom - 2, self.width - 4, self.img_h + 4, 4, fill=1, stroke=0)
        if self.scene_path:
            try:
                sw, sh = fit_image(self.scene_path, self.width - 8, self.img_h - 4)
                x_off = 4 + (self.width - 8 - sw) / 2
                y_off = img_bottom + (self.img_h - sh) / 2
                pil_draw(c, self.scene_path, x_off, y_off, sw, sh)
            except Exception:
                pass
        else:
            c.setFillColor(HexColor('#1E293B'))
            c.rect(4, img_bottom, self.width - 8, self.img_h, fill=1, stroke=0)
            c.setFillColor(SILVER)
            c.setFont("Helvetica", 7)
            c.drawCentredString(self.width / 2, img_bottom + self.img_h / 2 - 4, "NO IMAGE")

        # Label strip
        c.setFillColor(HexColor('#0F172A'))
        c.roundRect(2, 2, self.width - 4, 20, 3, fill=1, stroke=0)
        c.setFillColor(SILVER)
        c.setFont("Helvetica", 7.5)
        c.drawString(8, 7.5, self.timestamp)
        c.setFillColor(HexColor('#93C5FD'))
        c.setFont("Helvetica", 7)
        cap = self.caption[:50] + '…' if len(self.caption) > 50 else self.caption
        c.drawCentredString(self.width / 2, 7.5, cap)


class InfoBox(Flowable):
    def __init__(self, text: str, width: float, icon: str = "i", color=None):
        super().__init__()
        self.text = text
        self.icon = icon
        self.color = color or BLUE
        self.width = width
        lines = max(2, len(text) // 80 + 1)
        self.height = lines * 14 + 20

    def draw(self):
        c = self.canv
        c.setFillColor(HexColor('#EEF2FF'))
        c.roundRect(0, 0, self.width, self.height, 6, fill=1, stroke=0)
        c.setFillColor(self.color)
        c.rect(0, 0, 4, self.height, fill=1, stroke=0)
        c.circle(16, self.height / 2, 8, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(16, self.height / 2 - 3.5, self.icon)
        c.setFillColor(DARK_TXT)
        c.setFont("Helvetica", 9)
        words = self.text.split()
        lines_list, cur = [], ""
        for w in words:
            test = (cur + " " + w).strip()
            if c.stringWidth(test, "Helvetica", 9) < self.width - 42:
                cur = test
            else:
                if cur: lines_list.append(cur)
                cur = w
        if cur: lines_list.append(cur)
        sy = self.height / 2 + len(lines_list) * 6.5 - 4
        for line in lines_list:
            c.drawString(30, sy, line)
            sy -= 13


# ── Page templates ────────────────────────────────────────────────────────────
def make_cover_drawer(title: str, time_range: str, generated_at: str):
    def draw_cover(c, doc):
        w, h = A4
        # Dark background
        c.setFillColor(NAV)
        c.rect(0, 0, w, h, fill=1, stroke=0)
        # Diagonal band
        c.setFillColor(HexColor('#0D2040'))
        p = c.beginPath()
        p.moveTo(0, h * 0.55); p.lineTo(w, h * 0.35)
        p.lineTo(w, h * 0.60); p.lineTo(0, h * 0.80); p.close()
        c.drawPath(p, fill=1, stroke=0)
        # Grid dots
        c.setFillColor(HexColor('#1A2E48'))
        for gx in range(0, int(w) + 20, 20):
            for gy in range(0, int(h) + 20, 20):
                c.circle(gx, gy, 1.0, fill=1, stroke=0)
        # Glowing circles (top-right corner decoration)
        c.setStrokeColor(HexColor('#3730A3'))
        c.setFillColor(HexColor('#00000000'))
        c.setLineWidth(28)
        c.circle(w * 0.85, h * 0.72, 110, fill=0, stroke=1)
        c.setLineWidth(14)
        c.circle(w * 0.85, h * 0.72, 70, fill=0, stroke=1)
        # Blueprint grid
        c.setStrokeColor(HexColor('#0D1F30'))
        c.setLineWidth(0.4)
        for gx in range(0, int(w), 40): c.line(gx, 0, gx, h)
        for gy in range(0, int(h), 40): c.line(0, gy, w, gy)
        # Top accent — indigo
        c.setFillColor(INDIGO); c.rect(0, h - 5, w, 5, fill=1, stroke=0)
        # Bottom accent — amber
        c.setFillColor(AMBER);  c.rect(0, 0, w, 4, fill=1, stroke=0)

        # ── Cover content ──────────────────────────────────────────────────
        # System name
        c.setFillColor(WHITE)
        c.setFont("Helvetica-Bold", 44)
        c.drawString(MARGIN, 290, "IRIS FRS")

        # Divider
        div_y = 272
        c.setStrokeColor(INDIGO)
        c.setLineWidth(1.0)
        c.line(MARGIN, div_y, MARGIN + 300, div_y)

        # Sub-label
        c.setFillColor(HexColor('#A5B4FC'))
        c.setFont("Helvetica", 14)
        c.drawString(MARGIN, div_y - 22, "Face Recognition Analytics Report")

        # Tags
        c.setFillColor(HexColor('#475569'))
        c.setFont("Helvetica", 9)
        c.drawString(MARGIN, div_y - 42, "Intelligent Recognition & Identification System  ·  Bhubaneswar")

        # Report title box
        title_y = 220
        c.setFillColor(HexColor('#0F2133'))
        c.roundRect(MARGIN, title_y - 10, CONTENT_W, 36, 4, fill=1, stroke=0)
        c.setFillColor(HexColor('#93C5FD'))
        c.setFont("Helvetica-Bold", 13)
        c.drawString(MARGIN + 12, title_y + 4, title)

        # Meta info box
        meta_y = 165
        meta_rows = [
            ("Time Range",    time_range),
            ("Generated",     generated_at),
            ("Classification","CONFIDENTIAL — LAW ENFORCEMENT USE ONLY"),
        ]
        row_h = 22
        box_h = len(meta_rows) * row_h + 10
        c.setFillColor(HexColor('#091520'))
        c.roundRect(MARGIN, meta_y - box_h + 10, CONTENT_W, box_h, 4, fill=1, stroke=0)
        for i, (key, val) in enumerate(meta_rows):
            y = meta_y - i * row_h + 2
            c.setFillColor(HexColor('#4F46E5'))
            c.setFont("Helvetica-Bold", 8.5)
            c.drawString(MARGIN + 12, y, key.upper())
            c.setFillColor(HexColor('#CBD5E1'))
            c.setFont("Helvetica", 8.5)
            c.drawString(MARGIN + 100, y, val)

        # Footer — organisation
        c.setFillColor(HexColor('#94A3B8'))
        c.setFont("Helvetica-Bold", 10)
        c.drawRightString(w - MARGIN, 12, "Bhubaneswar Police — IRIS Surveillance Division")

    return draw_cover


def draw_header_footer(c, doc):
    w, h = A4
    # Header bar
    c.setFillColor(NAV)
    c.rect(0, h - 28, w, 28, fill=1, stroke=0)
    c.setFillColor(INDIGO)
    c.rect(0, h - 28, w, 3, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN, h - 18, "IRIS FRS — Face Recognition Analytics")
    c.setFillColor(SILVER)
    c.setFont("Helvetica", 8)
    c.drawRightString(w - MARGIN, h - 18, "Intelligent Recognition & Identification System")
    # Footer
    c.setFillColor(NAV)
    c.rect(0, 0, w, FOOTER_H, fill=1, stroke=0)
    c.setFillColor(INDIGO)
    c.rect(0, FOOTER_H, w, 2, fill=1, stroke=0)
    c.setFillColor(HexColor('#475569'))
    c.setFont("Helvetica", 7)
    c.drawString(MARGIN, 9, "CONFIDENTIAL — Law Enforcement Use Only  ·  IRIS Bhubaneswar")
    c.setFillColor(SILVER)
    c.setFont("Helvetica", 7)
    c.drawRightString(w - MARGIN, 9, f"Page {doc.page}")


class HeaderFooterCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self._cover_drawer = None

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_page_states)
        for i, state in enumerate(self._saved_page_states):
            self.__dict__.update(state)
            if i == 0:
                if self._cover_drawer:
                    self._cover_drawer(self, self)
            else:
                draw_header_footer(self, self)
            super().showPage()
        super().save()


# ── Styles ────────────────────────────────────────────────────────────────────
def make_styles():
    S = getSampleStyleSheet()

    def add(name, **kw):
        S.add(ParagraphStyle(name, **kw))

    add('Body',      fontName='Helvetica', fontSize=10, textColor=MED_TXT,
        leading=16, alignment=TA_JUSTIFY, spaceAfter=6, spaceBefore=4)
    add('BodyLeft',  fontName='Helvetica', fontSize=9.5, textColor=MED_TXT,
        leading=15, alignment=TA_LEFT, spaceAfter=4)
    add('BulletItem', fontName='Helvetica', fontSize=9.5, textColor=MED_TXT,
        leading=15, leftIndent=18, spaceAfter=3, bulletIndent=6,
        bulletFontName='Helvetica-Bold', bulletFontSize=10, bulletColor=INDIGO)
    add('FeatLabel', fontName='Helvetica-Bold', fontSize=9, textColor=INDIGO,
        leading=13, spaceAfter=2)
    add('StatNum',   fontName='Helvetica-Bold', fontSize=20, textColor=INDIGO,
        leading=24, alignment=TA_CENTER)
    add('StatLabel', fontName='Helvetica', fontSize=8, textColor=SILVER,
        leading=11, alignment=TA_CENTER)
    add('TableHdr',  fontName='Helvetica-Bold', fontSize=9, textColor=WHITE,
        leading=13, alignment=TA_LEFT)
    add('TableCell', fontName='Helvetica', fontSize=9, textColor=DARK_TXT,
        leading=13, alignment=TA_LEFT)
    add('SectionTitle', fontName='Helvetica-Bold', fontSize=11, textColor=INDIGO,
        leading=14, spaceAfter=4, spaceBefore=8)
    return S


# ── Database ─────────────────────────────────────────────────────────────────
def get_db_conn(frs_db_url: str):
    return psycopg2.connect(frs_db_url, cursor_factory=psycopg2.extras.RealDictCursor)


def fetch_report_data(conn, start_time: str | None, end_time: str | None,
                      filter_type: str, limit_known: int = 200, limit_unknown: int = 200):
    """Fetch all data needed for the report."""
    where_parts = []
    params = []

    if start_time:
        where_parts.append("d.timestamp >= %s")
        params.append(start_time)
    if end_time:
        where_parts.append("d.timestamp <= %s")
        params.append(end_time)

    where_clause = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    with conn.cursor() as cur:
        # Summary stats
        cur.execute(f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN person_id IS NOT NULL THEN 1 ELSE 0 END) AS known,
                SUM(CASE WHEN person_id IS NULL THEN 1 ELSE 0 END) AS unknown,
                AVG(confidence) AS avg_confidence
            FROM frs_detections d
            {where_clause}
        """, params)
        stats = dict(cur.fetchone())

        # Per-device breakdown (join devices from main DB is not available here;
        # use device_id string from the detection itself)
        cur.execute(f"""
            SELECT device_id, COUNT(*) AS cnt
            FROM frs_detections d
            {where_clause}
            GROUP BY device_id
            ORDER BY cnt DESC
        """, params)
        by_device = [dict(r) for r in cur.fetchall()]

        # Watchlist persons
        cur.execute("SELECT id, name, category, threat_level, face_image_url FROM frs_persons ORDER BY name")
        persons = [dict(r) for r in cur.fetchall()]

        # Per-person counts in range
        person_parts = where_parts + ["person_id IS NOT NULL"]
        person_where = "WHERE " + " AND ".join(person_parts)
        cur.execute(f"""
            SELECT person_id, COUNT(*) AS cnt, MAX(timestamp) AS last_seen, AVG(confidence) AS avg_conf
            FROM frs_detections d
            {person_where}
            GROUP BY person_id
        """, params)
        person_counts = {str(r['person_id']): dict(r) for r in cur.fetchall()}

        # Known detections (with person info)
        known_where = where_parts + ["d.person_id IS NOT NULL"]
        if filter_type == 'high_threat':
            known_where.append("p.threat_level = 'high'")
        known_where_str = "WHERE " + " AND ".join(known_where) if known_where else ""
        known_params = params.copy()

        cur.execute(f"""
            SELECT d.id, d.timestamp, d.confidence, d.device_id,
                   d.face_snapshot_url, d.full_snapshot_url,
                   d.person_id, p.name AS person_name,
                   p.category, p.threat_level
            FROM frs_detections d
            JOIN frs_persons p ON p.id = d.person_id
            {known_where_str}
            ORDER BY d.timestamp DESC
            LIMIT %s
        """, known_params + [limit_known])
        known_detections = [dict(r) for r in cur.fetchall()]

        # Unknown detections
        unknown_where = where_parts + ["d.person_id IS NULL"]
        unknown_where_str = "WHERE " + " AND ".join(unknown_where) if unknown_where else ""

        cur.execute(f"""
            SELECT id, timestamp, confidence, device_id,
                   face_snapshot_url, full_snapshot_url
            FROM frs_detections d
            {unknown_where_str}
            ORDER BY timestamp DESC
            LIMIT %s
        """, params + [limit_unknown])
        unknown_detections = [dict(r) for r in cur.fetchall()]

    return {
        'stats': stats,
        'by_device': by_device,
        'persons': persons,
        'person_counts': person_counts,
        'known_detections': known_detections,
        'unknown_detections': unknown_detections if filter_type in ('all', 'unknown') else [],
    }


# ── PDF build ─────────────────────────────────────────────────────────────────
def format_dt(dt) -> str:
    if dt is None:
        return ''
    if hasattr(dt, 'strftime'):
        return dt.strftime('%d/%m/%Y %H:%M:%S')
    return str(dt)


def chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def build_pdf(data: dict, output_path: str, title: str,
              time_range: str, generated_at: str):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=TOP_MARGIN, bottomMargin=BOT_MARGIN,
        title=title,
        author="IRIS FRS — Bhubaneswar Police",
        subject="Face Recognition Analytics Report",
    )

    S = make_styles()
    story = []

    # ── Page 1: Cover (blank flowable placeholder) ─────────────────────────
    story.append(PageBreak())

    # ── Page 2: Executive Summary ─────────────────────────────────────────
    stats = data['stats']
    total = stats.get('total', 0) or 0
    known = stats.get('known', 0) or 0
    unknown = stats.get('unknown', 0) or 0
    avg_conf = float(stats.get('avg_confidence') or 0)

    story.append(SectionHeader("01", "Executive Summary", CONTENT_W))
    story.append(Spacer(1, 14))

    # Stats row — 4 big numbers
    match_rate = (known / total * 100) if total > 0 else 0
    stat_data = [
        [Paragraph(str(total), S['StatNum']),
         Paragraph(str(known), S['StatNum']),
         Paragraph(str(unknown), S['StatNum']),
         Paragraph(f"{match_rate:.1f}%", S['StatNum'])],
        [Paragraph("Total Detections", S['StatLabel']),
         Paragraph("Known Matches", S['StatLabel']),
         Paragraph("Unknown Faces", S['StatLabel']),
         Paragraph("Match Rate", S['StatLabel'])],
    ]
    col_w = CONTENT_W / 4
    stat_tbl = Table(stat_data, colWidths=[col_w] * 4)
    stat_tbl.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), VLIGHT),
        ('TOPPADDING',    (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('GRID',          (0, 0), (-1, -1), 0.5, LGREY),
        ('ALIGN',         (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(stat_tbl)
    story.append(Spacer(1, 16))

    # Average confidence
    if avg_conf > 0:
        story.append(InfoBox(
            f"Average detection confidence: {avg_conf:.1%}  ·  "
            f"Time range: {time_range}  ·  "
            f"Report generated: {generated_at}",
            CONTENT_W, icon="i", color=INDIGO))
        story.append(Spacer(1, 12))

    # By-device table
    by_device = data.get('by_device', [])
    if by_device:
        story.append(Paragraph("Detections by Camera / Device", S['SectionTitle']))
        dev_rows = [
            [Paragraph("Device ID", S['FeatLabel']),
             Paragraph("Detections", S['FeatLabel'])]
        ]
        for d in by_device:
            dev_rows.append([
                Paragraph(str(d.get('device_id', '')), S['TableCell']),
                Paragraph(str(d.get('cnt', 0)), S['TableCell']),
            ])
        dev_tbl = Table(dev_rows, colWidths=[CONTENT_W * 0.7, CONTENT_W * 0.3])
        dev_tbl.setStyle(TableStyle([
            ('BACKGROUND',    (0, 0), (-1, 0), NAV),
            ('TEXTCOLOR',     (0, 0), (-1, 0), WHITE),
            ('FONTNAME',      (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9),
            ('ROWBACKGROUNDS',(0, 1), (-1, -1), [VLIGHT, WHITE]),
            ('GRID',          (0, 0), (-1, -1), 0.4, LGREY),
            ('TOPPADDING',    (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ]))
        story.append(dev_tbl)

    story.append(PageBreak())

    # ── Page 3: Watchlist ──────────────────────────────────────────────────
    story.append(SectionHeader("02", "Watchlist Persons", CONTENT_W))
    story.append(Spacer(1, 14))

    persons = data.get('persons', [])
    person_counts = data.get('person_counts', {})

    if persons:
        tbl_rows = [[
            Paragraph("Name", S['FeatLabel']),
            Paragraph("Category", S['FeatLabel']),
            Paragraph("Threat", S['FeatLabel']),
            Paragraph("Detections", S['FeatLabel']),
            Paragraph("Last Seen", S['FeatLabel']),
        ]]
        for p in persons:
            pid = str(p.get('id', ''))
            pc = person_counts.get(pid, {})
            threat = (p.get('threat_level') or '').upper()
            threat_color = {'HIGH': RED, 'MEDIUM': AMBER, 'LOW': GREEN}.get(threat, MED_TXT)
            cnt = pc.get('cnt', 0)
            last_seen = format_dt(pc.get('last_seen')) if pc else ''
            tbl_rows.append([
                Paragraph(str(p.get('name', '')), S['TableCell']),
                Paragraph(str(p.get('category', '') or '—'), S['TableCell']),
                Paragraph(threat or '—', ParagraphStyle('t', parent=S['TableCell'],
                                                         textColor=threat_color,
                                                         fontName='Helvetica-Bold')),
                Paragraph(str(cnt) if cnt else '0', S['TableCell']),
                Paragraph(last_seen or '—', S['TableCell']),
            ])

        col_widths = [CONTENT_W * 0.28, CONTENT_W * 0.22, CONTENT_W * 0.14,
                      CONTENT_W * 0.14, CONTENT_W * 0.22]
        w_tbl = Table(tbl_rows, colWidths=col_widths)
        w_tbl.setStyle(TableStyle([
            ('BACKGROUND',    (0, 0), (-1, 0), NAV),
            ('TEXTCOLOR',     (0, 0), (-1, 0), WHITE),
            ('FONTNAME',      (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE',      (0, 0), (-1, -1), 9),
            ('ROWBACKGROUNDS',(0, 1), (-1, -1), [VLIGHT, WHITE]),
            ('GRID',          (0, 0), (-1, -1), 0.4, LGREY),
            ('TOPPADDING',    (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING',   (0, 0), (-1, -1), 8),
            ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(w_tbl)
    else:
        story.append(InfoBox("No persons enrolled in watchlist.", CONTENT_W, icon="!", color=AMBER))

    story.append(PageBreak())

    # ── Known Detections (by person, paginated) ────────────────────────────
    known_detections = data.get('known_detections', [])
    if known_detections:
        story.append(SectionHeader("03", f"Known Person Detections ({len(known_detections)})", CONTENT_W))
        story.append(Spacer(1, 10))

        # Group by person
        from collections import defaultdict
        by_person: dict[str, list] = defaultdict(list)
        person_meta: dict[str, dict] = {}
        for det in known_detections:
            pid = str(det.get('person_id', ''))
            by_person[pid].append(det)
            if pid not in person_meta:
                person_meta[pid] = {
                    'name': det.get('person_name', 'Unknown'),
                    'category': det.get('category'),
                    'threat_level': det.get('threat_level'),
                }

        for pid, dets in by_person.items():
            meta = person_meta[pid]
            story.append(PersonSectionHeader(
                meta['name'],
                meta['category'],
                meta['threat_level'],
                len(dets),
                CONTENT_W,
            ))
            story.append(Spacer(1, 8))

            # 2 cards per row, each card takes full content width
            card_w = CONTENT_W
            for det in dets:
                face_path = url_to_filepath(det.get('face_snapshot_url'))
                scene_path = url_to_filepath(det.get('full_snapshot_url'))
                ts = format_dt(det.get('timestamp'))
                camera = str(det.get('device_id', ''))
                conf = float(det.get('confidence') or 0)
                card = TwoImageCard(face_path, scene_path, f"Camera: {camera}", conf, ts, card_w)
                story.append(card)
                story.append(Spacer(1, 6))

            story.append(Spacer(1, 10))

        story.append(PageBreak())

    # ── Unknown Detections (grid) ──────────────────────────────────────────
    unknown_detections = data.get('unknown_detections', [])
    if unknown_detections:
        story.append(SectionHeader("04", f"Unknown Faces ({len(unknown_detections)})", CONTENT_W))
        story.append(Spacer(1, 10))
        story.append(InfoBox(
            "These faces were detected but did not match any enrolled watchlist person. "
            "Consider enrolling any person of interest for future identification.",
            CONTENT_W, icon="!", color=AMBER))
        story.append(Spacer(1, 10))

        # 3 cards per row
        GAP = 6
        card_w = (CONTENT_W - GAP * 2) / 3

        for row_dets in chunk(unknown_detections, 3):
            row_cells = []
            for det in row_dets:
                scene_path = url_to_filepath(det.get('full_snapshot_url'))
                ts = format_dt(det.get('timestamp'))
                camera = str(det.get('device_id', ''))
                row_cells.append(UnknownCard(scene_path, f"Cam: {camera}", ts, card_w))
            # Pad to 3
            while len(row_cells) < 3:
                row_cells.append('')
            tbl = Table([row_cells], colWidths=[card_w, card_w, card_w],
                        rowHeights=[row_cells[0].height if hasattr(row_cells[0], 'height') else 123])
            tbl.setStyle(TableStyle([
                ('LEFTPADDING',   (0, 0), (-1, -1), GAP // 2),
                ('RIGHTPADDING',  (0, 0), (-1, -1), GAP // 2),
                ('TOPPADDING',    (0, 0), (-1, -1), 0),
                ('BOTTOMPADDING', (0, 0), (-1, -1), GAP),
                ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
            ]))
            story.append(tbl)

    doc.build(
        story,
        onFirstPage=make_cover_drawer(title, time_range, generated_at),
        onLaterPages=draw_header_footer,
    )
    print(f"Report saved: {output_path}", file=sys.stderr)


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Generate IRIS FRS Analytics Report')
    parser.add_argument('--title',      default='FRS Analytics Report')
    parser.add_argument('--start-time', default=None, help='ISO8601 start time')
    parser.add_argument('--end-time',   default=None, help='ISO8601 end time')
    parser.add_argument('--filter',     default='all',
                        choices=['all', 'known', 'unknown', 'high_threat'])
    parser.add_argument('--time-range', default='All Time', help='Human-readable time range label')
    parser.add_argument('--output',     required=True, help='Output PDF path')
    parser.add_argument('--frs-db-url', default=None, help='FRS DB URL (overrides env var)')
    args = parser.parse_args()

    frs_db_url = args.frs_db_url or os.environ.get('FRS_DATABASE_URL', '')
    if not frs_db_url:
        print("ERROR: FRS_DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    generated_at = datetime.now().strftime('%d/%m/%Y %H:%M:%S')

    conn = get_db_conn(frs_db_url)
    try:
        data = fetch_report_data(
            conn,
            start_time=args.start_time,
            end_time=args.end_time,
            filter_type=args.filter,
        )
    finally:
        conn.close()

    build_pdf(
        data,
        output_path=args.output,
        title=args.title,
        time_range=args.time_range,
        generated_at=generated_at,
    )


if __name__ == '__main__':
    main()
