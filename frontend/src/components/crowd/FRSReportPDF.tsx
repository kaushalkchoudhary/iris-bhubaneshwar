import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import type { Person } from '@/lib/api';

interface FRSDetection {
  id: number;
  personId?: string;
  deviceId: string;
  timestamp: string;
  metadata: any;
  person?: Person;
}

interface FRSReportPDFProps {
  persons: Person[];
  detections: FRSDetection[];
  reportTitle: string;
  generatedAt: string;
  filters?: {
    watchlistFilter?: string;
    searchQuery?: string;
  };
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2 solid #000',
    paddingBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 3,
    color: '#666',
  },
  filterInfo: {
    fontSize: 8,
    marginTop: 5,
    color: '#666',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 15,
  },
  summary: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  summaryLabel: {
    width: '40%',
    fontWeight: 'bold',
    fontSize: 9,
  },
  summaryValue: {
    width: '60%',
    fontSize: 9,
  },
  table: {
    width: '100%',
    marginTop: 8,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e3a5f',
    color: 'white',
    padding: 6,
    fontWeight: 'bold',
    fontSize: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    padding: 5,
    fontSize: 8,
  },
  tableRowEven: {
    backgroundColor: '#f9f9f9',
  },
  detectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  detectionCard: {
    width: '48.5%',
    border: '1 solid #e5e7eb',
    borderRadius: 6,
    padding: 8,
    backgroundColor: '#fff',
  },
  detectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  detectionMetaText: {
    fontSize: 8,
    color: '#555',
  },
  detectionImages: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  detectionFrameImage: {
    width: '72%',
    height: 130,
    objectFit: 'cover',
    borderRadius: 4,
    backgroundColor: '#111',
  },
  detectionFaceImage: {
    width: '28%',
    height: 130,
    objectFit: 'cover',
    borderRadius: 4,
    backgroundColor: '#111',
  },
  detectionMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  detectionMetaItem: {
    width: '50%',
    marginBottom: 4,
  },
  detectionMetaLabel: {
    fontSize: 7,
    color: '#777',
  },
  detectionMetaValue: {
    fontSize: 8,
  },
  // Watchlist table columns
  wCol1: { width: '5%' },
  wCol2: { width: '20%' },
  wCol3: { width: '12%' },
  wCol4: { width: '12%' },
  wCol5: { width: '10%' },
  wCol6: { width: '8%' },
  wCol7: { width: '18%' },
  wCol8: { width: '15%' },
  // Detection table columns
  dCol1: { width: '5%' },
  dCol2: { width: '18%' },
  dCol3: { width: '15%' },
  dCol4: { width: '18%' },
  dCol5: { width: '12%' },
  dCol6: { width: '10%' },
  dCol7: { width: '12%' },
  dCol8: { width: '10%' },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: '#666',
    textAlign: 'center',
    borderTop: '1 solid #ddd',
    paddingTop: 10,
  },
});

const formatDateTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const FRSReportPDF = ({ persons, detections, reportTitle, generatedAt, filters }: FRSReportPDFProps) => {
  const highThreat = persons.filter(p => p.threatLevel?.toLowerCase() === 'high').length;
  const wanted = persons.filter(p => p.category?.toLowerCase() === 'warrant').length;

  const threatSummary: Record<string, number> = {};
  persons.forEach(p => {
    const level = p.threatLevel || 'Unknown';
    threatSummary[level] = (threatSummary[level] || 0) + 1;
  });

  const categorySummary: Record<string, number> = {};
  persons.forEach(p => {
    const cat = p.category || 'Unknown';
    categorySummary[cat] = (categorySummary[cat] || 0) + 1;
  });

  const chunk = <T,>(items: T[], size: number) => {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      result.push(items.slice(i, i + size));
    }
    return result;
  };

  const getDetectionImages = (detection: FRSDetection, matchedPerson?: Person) => {
    const images = detection.metadata?.images || {};
    return {
      frame: images['frame.jpg'] || images['face.jpg'] || detection.metadata?.fullImageUrl || matchedPerson?.faceImageUrl,
      face: images['face_crop.jpg'] || images['face.jpg'] || matchedPerson?.faceImageUrl,
    };
  };

  const detectionPages = chunk(detections, 6);

  return (
    <Document>
      {/* Page 1: Watchlist Report */}
      <Page size="A4" style={styles.page} orientation="landscape">
        <View style={styles.header}>
          <Text style={styles.title}>FACIAL RECOGNITION SYSTEM</Text>
          <Text style={styles.subtitle}>{reportTitle}</Text>
          <Text style={styles.filterInfo}>Generated on: {generatedAt}</Text>
          {filters && (
            <Text style={styles.filterInfo}>
              {filters.watchlistFilter && filters.watchlistFilter !== 'all' ? `Filter: ${filters.watchlistFilter}` : ''}
              {filters.searchQuery ? ` | Search: "${filters.searchQuery}"` : ''}
            </Text>
          )}
        </View>

        {/* Summary */}
        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Enrolled Persons:</Text>
            <Text style={styles.summaryValue}>{persons.length}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>High Threat:</Text>
            <Text style={styles.summaryValue}>{highThreat}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Wanted Persons:</Text>
            <Text style={styles.summaryValue}>{wanted}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>By Threat Level:</Text>
            <Text style={styles.summaryValue}>
              {Object.entries(threatSummary).map(([level, count]) => `${level}: ${count}`).join(' | ')}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>By Category:</Text>
            <Text style={styles.summaryValue}>
              {Object.entries(categorySummary).map(([cat, count]) => `${cat}: ${count}`).join(' | ')}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Detections:</Text>
            <Text style={styles.summaryValue}>{detections.length}</Text>
          </View>
        </View>

        {/* Watchlist Table */}
        <Text style={styles.sectionTitle}>WATCHLIST DATABASE</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.wCol1}>S.No</Text>
            <Text style={styles.wCol2}>Name</Text>
            <Text style={styles.wCol3}>Category</Text>
            <Text style={styles.wCol4}>Threat Level</Text>
            <Text style={styles.wCol5}>Age</Text>
            <Text style={styles.wCol6}>Gender</Text>
            <Text style={styles.wCol7}>Aliases</Text>
            <Text style={styles.wCol8}>Enrolled On</Text>
          </View>
          {persons.slice(0, 80).map((person, index) => (
            <View
              key={person.id}
              style={[styles.tableRow, index % 2 === 0 ? styles.tableRowEven : {}]}
            >
              <Text style={styles.wCol1}>{index + 1}</Text>
              <Text style={styles.wCol2}>{person.name}</Text>
              <Text style={styles.wCol3}>{person.category || 'N/A'}</Text>
              <Text style={styles.wCol4}>{person.threatLevel || 'N/A'}</Text>
              <Text style={styles.wCol5}>{person.age || 'N/A'}</Text>
              <Text style={styles.wCol6}>{person.gender || 'N/A'}</Text>
              <Text style={styles.wCol7}>{person.aliases || 'None'}</Text>
              <Text style={styles.wCol8}>{person.createdAt ? formatDateTime(person.createdAt) : 'N/A'}</Text>
            </View>
          ))}
        </View>

        {persons.length > 80 && (
          <Text style={{ marginTop: 8, fontSize: 8, color: '#666', fontStyle: 'italic' }}>
            Showing first 80 persons of {persons.length} total.
          </Text>
        )}

        <View style={styles.footer}>
          <Text>FRS Report - Facial Recognition System | Confidential</Text>
        </View>
      </Page>

      {/* Page 2: Detections Report */}
      {detections.length > 0 && detectionPages.map((pageItems, pageIndex) => (
        <Page key={`detections-${pageIndex}`} size="A4" style={styles.page} orientation="landscape">
          <View style={styles.header}>
            <Text style={styles.title}>FRS DETECTION LOG</Text>
            <Text style={styles.subtitle}>Face Match Events with Images & Metadata</Text>
            <Text style={styles.filterInfo}>Generated on: {generatedAt}</Text>
            <Text style={styles.filterInfo}>Page {pageIndex + 1} of {detectionPages.length}</Text>
          </View>

          <View style={styles.detectionGrid}>
            {pageItems.map((detection, index) => {
              const matchedPerson = detection.person || persons.find(p => String(p.id) === String(detection.metadata?.person_id));
              const confidence = detection.metadata?.confidence ?? detection.metadata?.match_score;
              const images = getDetectionImages(detection, matchedPerson);
              const gender = detection.metadata?.gender || matchedPerson?.gender || 'N/A';
              const age = detection.metadata?.ageGroup || matchedPerson?.age || 'N/A';
              const quality = detection.metadata?.quality_score != null ? `${Math.round(detection.metadata.quality_score * 100)}%` : 'N/A';
              return (
                <View key={detection.id} style={styles.detectionCard}>
                  <View style={styles.detectionHeader}>
                    <Text style={styles.detectionTitle}>
                      #{pageIndex * 6 + index + 1} {matchedPerson?.name || detection.metadata?.person_name || 'Unknown'}
                    </Text>
                    <Text style={styles.detectionMetaText}>{formatDateTime(detection.timestamp)}</Text>
                  </View>

                  <View style={styles.detectionImages}>
                    {images.frame ? (
                      <Image src={images.frame} style={styles.detectionFrameImage} />
                    ) : (
                      <View style={styles.detectionFrameImage} />
                    )}
                    {images.face ? (
                      <Image src={images.face} style={styles.detectionFaceImage} />
                    ) : (
                      <View style={styles.detectionFaceImage} />
                    )}
                  </View>

                  <View style={styles.detectionMetaGrid}>
                    {[
                      ['Person ID', matchedPerson?.id || detection.metadata?.person_id || 'N/A'],
                      ['Category', matchedPerson?.category || 'N/A'],
                      ['Threat', matchedPerson?.threatLevel || 'N/A'],
                      ['Confidence', confidence != null ? `${Math.round(confidence * 100)}%` : 'N/A'],
                      ['Gender', gender],
                      ['Age', typeof age === 'string' ? age.replace('age_', '') : String(age)],
                      ['Quality', quality],
                      ['Device', detection.deviceId || 'N/A'],
                      ['Track ID', detection.metadata?.track_id || 'N/A'],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.detectionMetaItem}>
                        <Text style={styles.detectionMetaLabel}>{label}</Text>
                        <Text style={styles.detectionMetaValue}>{String(value)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.footer}>
            <Text>FRS Detection Log - Facial Recognition System | Confidential</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
};
