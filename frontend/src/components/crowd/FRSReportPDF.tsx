import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';
import type { Person } from '@/lib/api';

Font.register({
  family: 'Roboto',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf', fontWeight: 'normal' },
    { src: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc9.ttf', fontWeight: 'bold' },
  ],
});

interface FRSDetection {
  id: number;
  personId?: string;
  deviceId: string;
  timestamp: string;
  confidence?: number;
  metadata?: any;
  person?: Person;
  faceSnapshotUrl?: string;
  fullSnapshotUrl?: string;
}

interface FRSReportPDFProps {
  persons: Person[];
  detections: FRSDetection[];
  reportTitle: string;
  generatedAt: string;
  filters?: {
    watchlistFilter?: string;
    searchQuery?: string;
    timeRange?: string;
  };
}

const C = {
  navy:    '#0f172a',
  indigo:  '#4f46e5',
  indigoL: '#818cf8',
  green:   '#16a34a',
  amber:   '#d97706',
  red:     '#dc2626',
  white:   '#ffffff',
  offWhite:'#f8fafc',
  gray50:  '#f1f5f9',
  gray100: '#e2e8f0',
  gray400: '#94a3b8',
  gray600: '#475569',
  gray800: '#1e293b',
};

const s = StyleSheet.create({
  page: { backgroundColor: C.white, fontFamily: 'Roboto', paddingBottom: 50 },

  // ── Header ──
  header: {
    backgroundColor: C.navy,
    paddingHorizontal: 36,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logoBox: {
    width: 38, height: 38, borderRadius: 6,
    backgroundColor: C.indigo,
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { color: C.white, fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5 },
  sysName:  { color: C.indigoL, fontSize: 9, fontWeight: 'bold', letterSpacing: 1.5, marginBottom: 2 },
  sysDesc:  { color: C.gray400, fontSize: 7.5 },
  reportTitle: { color: C.white, fontSize: 16, fontWeight: 'bold', letterSpacing: 0.3 },
  reportMeta:  { color: C.gray400, fontSize: 7.5, marginTop: 3 },
  confiBadge: {
    backgroundColor: C.red, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 3,
  },
  confiText: { color: C.white, fontSize: 6.5, fontWeight: 'bold', letterSpacing: 1 },

  // ── Body ──
  body: { paddingHorizontal: 36, paddingTop: 20 },

  // ── Section header ──
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginTop: 18 },
  sectionLabel: { fontSize: 8.5, fontWeight: 'bold', color: C.indigo, letterSpacing: 1, textTransform: 'uppercase' },
  sectionLine: { flex: 1, height: 1, backgroundColor: C.gray100, marginLeft: 10 },

  // ── Stat cards ──
  statGrid: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  statCard: {
    flex: 1, backgroundColor: C.gray50, borderRadius: 8,
    padding: 12, borderWidth: 1, borderColor: C.gray100,
  },
  statLabel: { fontSize: 6.5, color: C.gray400, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: 'bold', color: C.navy },
  statSub:   { fontSize: 7.5, color: C.gray600, marginTop: 2 },

  // ── Watchlist table ──
  table: { width: '100%', marginTop: 6 },
  tHead: {
    flexDirection: 'row', backgroundColor: C.navy,
    borderRadius: 5, paddingHorizontal: 10, paddingVertical: 8,
  },
  tRow: {
    flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: C.gray100, alignItems: 'center',
  },
  tRowAlt: { backgroundColor: C.gray50 },
  thText: { fontSize: 7, color: C.indigoL, fontWeight: 'bold', letterSpacing: 0.5 },
  tdText: { fontSize: 7.5, color: C.gray800 },
  tdMuted:{ fontSize: 7.5, color: C.gray400 },

  cNum:  { width: '5%' },
  cName: { width: '22%' },
  cCat:  { width: '18%' },
  cThr:  { width: '13%' },
  cAge:  { width: '7%' },
  cGen:  { width: '8%' },
  cDate: { width: '13%' },
  cNotes:{ width: '14%' },

  threatHigh:   { color: C.red,   fontWeight: 'bold' },
  threatMed:    { color: C.amber, fontWeight: 'bold' },
  threatLow:    { color: C.green },

  // ── Detection cards (2-column grid) ──
  detGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  detCard: {
    width: '48%', backgroundColor: C.white, borderRadius: 8,
    borderWidth: 1, borderColor: C.gray100, overflow: 'hidden',
  },
  detCardKnown:   { borderColor: '#bbf7d0', borderWidth: 1.5 },
  detCardUnknown: { borderColor: '#fde68a', borderWidth: 1 },

  detCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 7,
    backgroundColor: C.gray50, borderBottomWidth: 1, borderBottomColor: C.gray100,
  },
  detCardName: { fontSize: 9, fontWeight: 'bold', color: C.navy, flex: 1 },
  detCardNum:  { fontSize: 8, color: C.gray400 },

  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  badgeKnown:   { backgroundColor: '#dcfce7' },
  badgeUnknown: { backgroundColor: '#fef9c3' },
  badgeTextKnown:   { fontSize: 6, fontWeight: 'bold', color: '#166534' },
  badgeTextUnknown: { fontSize: 6, fontWeight: 'bold', color: '#78350f' },

  // Images inside detection card
  imgRow: { flexDirection: 'row', height: 120 },
  imgBox: { flex: 1, backgroundColor: C.gray50, position: 'relative' },
  imgBoxBorder: { borderRightWidth: 1, borderRightColor: C.gray100 },
  imgFull: { width: '100%', height: '100%', objectFit: 'cover' },
  imgLabel: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3,
  },
  imgLabelText: { fontSize: 5.5, color: C.white, fontWeight: 'bold' },

  // Meta inside detection card
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
  metaItem: { width: '48%' },
  metaLabel:{ fontSize: 6, color: C.gray400, textTransform: 'uppercase', letterSpacing: 0.3 },
  metaValue:{ fontSize: 7.5, color: C.navy, fontWeight: 'bold', marginTop: 1 },
  confHigh: { color: C.green },
  confMid:  { color: C.amber },
  confLow:  { color: C.red },

  // ── Footer ──
  footer: {
    position: 'absolute', bottom: 16, left: 36, right: 36,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: C.gray100, paddingTop: 8,
  },
  footerText: { fontSize: 7, color: C.gray400 },

  noData: { textAlign: 'center', marginTop: 60, fontSize: 11, color: C.gray400 },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtDateTime = (ts: string) =>
  new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const fmtDate = (ts: string) =>
  new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

const confStyle = (v: number) => v >= 0.7 ? s.confHigh : v >= 0.4 ? s.confMid : s.confLow;
const thrStyle  = (lv?: string) => {
  const l = (lv || '').toLowerCase();
  if (l === 'high') return s.threatHigh;
  if (l === 'medium') return s.threatMed;
  return s.threatLow;
};

const getImgUrls = (det: FRSDetection) => {
  const imgs = det.metadata?.images || {};
  const base = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3002`
    : 'http://localhost:3002';
  const abs = (u?: string) => !u ? undefined : u.startsWith('http') ? u : `${base}${u}`;
  return {
    face:  abs(imgs['face_crop.jpg'] || imgs['face.jpg'] || det.faceSnapshotUrl),
    frame: abs(imgs['frame.jpg'] || det.fullSnapshotUrl),
  };
};

// ── Sub-components ────────────────────────────────────────────────────────────

const PageHeader = ({ subtitle }: { subtitle: string }) => (
  <View style={s.header}>
    <View style={s.headerLeft}>
      <View style={s.logoBox}>
        <Text style={s.logoText}>IRIS</Text>
      </View>
      <View>
        <Text style={s.sysName}>IRIS SURVEILLANCE SYSTEM</Text>
        <Text style={s.sysDesc}>Facial Recognition Analytics</Text>
      </View>
    </View>
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      <Text style={s.reportTitle}>{subtitle}</Text>
      <View style={s.confiBadge}>
        <Text style={s.confiText}>CONFIDENTIAL</Text>
      </View>
    </View>
  </View>
);

const SectionHeader = ({ label }: { label: string }) => (
  <View style={s.sectionRow}>
    <Text style={s.sectionLabel}>{label}</Text>
    <View style={s.sectionLine} />
  </View>
);

const PageFooter = ({ left }: { left: string }) => (
  <View style={s.footer} fixed>
    <Text style={s.footerText}>{left}</Text>
    <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
  </View>
);

const DetectionCard = ({ det, idx, persons }: { det: FRSDetection; idx: number; persons: Person[] }) => {
  const isKnown = !!(det.personId || det.metadata?.person_id);
  const person = det.person || persons.find(p => String(p.id) === String(det.personId || det.metadata?.person_id));
  const confidence = det.confidence ?? det.metadata?.confidence ?? det.metadata?.match_score ?? 0;
  const imgs = getImgUrls(det);

  return (
    <View style={[s.detCard, isKnown ? s.detCardKnown : s.detCardUnknown]}>
      <View style={s.detCardHeader}>
        <View style={[s.badge, isKnown ? s.badgeKnown : s.badgeUnknown]}>
          <Text style={isKnown ? s.badgeTextKnown : s.badgeTextUnknown}>{isKnown ? 'IDENTIFIED' : 'UNKNOWN'}</Text>
        </View>
        <Text style={[s.detCardName, { textAlign: 'center', flex: 1, marginHorizontal: 6 }]}>
          {isKnown ? (person?.name || 'Known') : `Face #${idx + 1}`}
        </Text>
        <Text style={s.detCardNum}>#{idx + 1}</Text>
      </View>

      {/* Images: face crop (left) + full scene (right) */}
      <View style={s.imgRow}>
        <View style={[s.imgBox, s.imgBoxBorder]}>
          {imgs.face
            ? <Image src={imgs.face} style={s.imgFull} />
            : <Text style={{ textAlign: 'center', marginTop: 50, fontSize: 7, color: C.gray400 }}>No Face</Text>
          }
          <View style={s.imgLabel}><Text style={s.imgLabelText}>FACE</Text></View>
        </View>
        <View style={s.imgBox}>
          {imgs.frame
            ? <Image src={imgs.frame} style={s.imgFull} />
            : <Text style={{ textAlign: 'center', marginTop: 50, fontSize: 7, color: C.gray400 }}>No Scene</Text>
          }
          <View style={s.imgLabel}><Text style={s.imgLabelText}>SCENE</Text></View>
        </View>
      </View>

      {/* Metadata */}
      <View style={s.metaGrid}>
        {isKnown && (
          <>
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>Category</Text>
              <Text style={s.metaValue}>{person?.category || 'N/A'}</Text>
            </View>
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>Threat Level</Text>
              <Text style={[s.metaValue, thrStyle(person?.threatLevel)]}>{person?.threatLevel || 'N/A'}</Text>
            </View>
          </>
        )}
        <View style={s.metaItem}>
          <Text style={s.metaLabel}>Confidence</Text>
          <Text style={[s.metaValue, confStyle(confidence)]}>{(confidence * 100).toFixed(1)}%</Text>
        </View>
        <View style={s.metaItem}>
          <Text style={s.metaLabel}>Device</Text>
          <Text style={s.metaValue}>{det.deviceId || 'N/A'}</Text>
        </View>
        <View style={{ width: '100%' }}>
          <Text style={s.metaLabel}>Timestamp</Text>
          <Text style={s.metaValue}>{fmtDateTime(det.timestamp)}</Text>
        </View>
      </View>
    </View>
  );
};

// ── Main document ─────────────────────────────────────────────────────────────

export const FRSReportPDF = ({ persons, detections, reportTitle, generatedAt, filters }: FRSReportPDFProps) => {
  const knownDetections   = detections.filter(d => d.personId || d.metadata?.person_id);
  const unknownDetections = detections.filter(d => !d.personId && !d.metadata?.person_id);
  const highThreat = persons.filter(p => p.threatLevel?.toLowerCase() === 'high').length;
  const matchRate  = detections.length > 0 ? ((knownDetections.length / detections.length) * 100).toFixed(1) : '0.0';

  // Chunk helper: split known detections into pages of 6 (2-col × 3-row)
  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const knownPages   = chunk(knownDetections,   6);
  const unknownPages = chunk(unknownDetections, 6);

  const footerLeft = `${reportTitle} • ${generatedAt}`;

  return (
    <Document>
      {/* ── Page 1: Summary + Watchlist ───────────────────────────────── */}
      <Page size="A4" orientation="portrait" style={s.page}>
        <PageHeader subtitle={reportTitle} />

        <View style={s.body}>
          {/* Report metadata */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 4, marginTop: 4, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 7.5, color: C.gray600 }}>Generated: {generatedAt}</Text>
            {filters?.searchQuery && <Text style={{ fontSize: 7.5, color: C.gray600 }}>· {filters.searchQuery}</Text>}
            {filters?.watchlistFilter && filters.watchlistFilter !== 'all' && (
              <Text style={{ fontSize: 7.5, color: C.gray600 }}>· Filter: {filters.watchlistFilter}</Text>
            )}
          </View>

          {/* Stats */}
          <SectionHeader label="Executive Summary" />
          <View style={s.statGrid}>
            <View style={s.statCard}>
              <Text style={s.statLabel}>Watchlist Persons</Text>
              <Text style={s.statValue}>{persons.length}</Text>
              <Text style={s.statSub}>enrolled</Text>
            </View>
            <View style={[s.statCard, { borderColor: '#fecaca' }]}>
              <Text style={s.statLabel}>High Threat</Text>
              <Text style={[s.statValue, { color: C.red }]}>{highThreat}</Text>
              <Text style={s.statSub}>priority</Text>
            </View>
            <View style={[s.statCard, { borderColor: '#c7d2fe' }]}>
              <Text style={s.statLabel}>Total Detections</Text>
              <Text style={[s.statValue, { color: C.indigo }]}>{detections.length}</Text>
              <Text style={s.statSub}>in report</Text>
            </View>
            <View style={[s.statCard, { borderColor: '#bbf7d0' }]}>
              <Text style={s.statLabel}>Known Matches</Text>
              <Text style={[s.statValue, { color: C.green }]}>{knownDetections.length}</Text>
              <Text style={s.statSub}>{matchRate}% match rate</Text>
            </View>
          </View>

          {/* Watchlist table */}
          <SectionHeader label={`Watchlist Database (${persons.length} persons)`} />
          <View style={s.table}>
            <View style={s.tHead}>
              <Text style={[s.thText, s.cNum]}>#</Text>
              <Text style={[s.thText, s.cName]}>Name</Text>
              <Text style={[s.thText, s.cCat]}>Category</Text>
              <Text style={[s.thText, s.cThr]}>Threat</Text>
              <Text style={[s.thText, s.cAge]}>Age</Text>
              <Text style={[s.thText, s.cGen]}>Gender</Text>
              <Text style={[s.thText, s.cDate]}>Enrolled</Text>
              <Text style={[s.thText, s.cNotes]}>Notes</Text>
            </View>
            {persons.slice(0, 40).map((p, i) => (
              <View key={p.id} style={[s.tRow, i % 2 === 1 ? s.tRowAlt : {}]}>
                <Text style={[s.tdMuted, s.cNum]}>{i + 1}</Text>
                <Text style={[s.tdText, s.cName, { fontWeight: 'bold' }]}>{p.name}</Text>
                <Text style={[s.tdText, s.cCat]}>{p.category || '—'}</Text>
                <Text style={[s.tdText, s.cThr, thrStyle(p.threatLevel)]}>{p.threatLevel || '—'}</Text>
                <Text style={[s.tdMuted, s.cAge]}>{p.age || '—'}</Text>
                <Text style={[s.tdMuted, s.cGen]}>{p.gender || '—'}</Text>
                <Text style={[s.tdMuted, s.cDate]}>{p.createdAt ? fmtDate(p.createdAt) : '—'}</Text>
                <Text style={[s.tdMuted, s.cNotes]}>{p.notes || '—'}</Text>
              </View>
            ))}
          </View>
          {persons.length > 40 && (
            <Text style={{ fontSize: 7, color: C.gray400, marginTop: 5, fontStyle: 'italic' }}>
              Showing first 40 of {persons.length} persons.
            </Text>
          )}
        </View>

        <PageFooter left={footerLeft} />
      </Page>

      {/* ── Known detection pages (6 per page) ───────────────────────── */}
      {knownPages.map((pageDetections, pageIdx) => (
        <Page key={`known-${pageIdx}`} size="A4" orientation="portrait" style={s.page}>
          <PageHeader subtitle="Identified Persons" />
          <View style={s.body}>
            <SectionHeader label={`Known Detections (${knownDetections.length} total) — Page ${pageIdx + 1}/${knownPages.length}`} />
            <View style={s.detGrid}>
              {pageDetections.map((det, idx) => (
                <DetectionCard
                  key={det.id}
                  det={det}
                  idx={pageIdx * 6 + idx}
                  persons={persons}
                />
              ))}
            </View>
          </View>
          <PageFooter left={footerLeft} />
        </Page>
      ))}

      {/* ── Unknown detection pages (6 per page) ─────────────────────── */}
      {unknownPages.map((pageDetections, pageIdx) => (
        <Page key={`unknown-${pageIdx}`} size="A4" orientation="portrait" style={s.page}>
          <PageHeader subtitle="Unidentified Faces" />
          <View style={s.body}>
            <SectionHeader label={`Unknown Detections (${unknownDetections.length} total) — Page ${pageIdx + 1}/${unknownPages.length}`} />
            <View style={s.detGrid}>
              {pageDetections.map((det, idx) => (
                <DetectionCard
                  key={det.id}
                  det={det}
                  idx={pageIdx * 6 + idx}
                  persons={persons}
                />
              ))}
            </View>
          </View>
          <PageFooter left={footerLeft} />
        </Page>
      ))}

      {/* ── Fallback: no detections ───────────────────────────────────── */}
      {detections.length === 0 && (
        <Page size="A4" orientation="portrait" style={s.page}>
          <PageHeader subtitle={reportTitle} />
          <View style={s.body}>
            <Text style={s.noData}>No detections found for the selected filters.</Text>
          </View>
          <PageFooter left={footerLeft} />
        </Page>
      )}
    </Document>
  );
};
