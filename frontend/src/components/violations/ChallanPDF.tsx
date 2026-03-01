import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { type TrafficViolation, type RCDetails } from '@/lib/api';

interface ChallanPDFProps {
  violation: TrafficViolation;
  rcDetails?: RCDetails | null;
}

// Fine amounts as per Karnataka Traffic Rules
const getFineAmount = (violationType: string, detectedSpeed?: number | null): number => {
  switch (violationType) {
    case 'SPEED':
      if (detectedSpeed) {
        const overLimit = detectedSpeed - 60; // Assuming 60 km/h is the base limit
        if (overLimit <= 10) return 500;
        if (overLimit <= 20) return 1000;
        if (overLimit <= 30) return 2000;
        return 3000;
      }
      return 2000;
    case 'HELMET':
      return 500;
    case 'WRONG_SIDE':
      return 1000;
    case 'RED_LIGHT':
      return 1000;
    case 'NO_SEATBELT':
      return 1000;
    case 'OVERLOADING':
      return 2000;
    case 'ILLEGAL_PARKING':
      return 500;
    default:
      return 1000;
  }
};

const getViolationDescription = (violationType: string, detectedSpeed?: number | null): string => {
  switch (violationType) {
    case 'SPEED':
      return `Overspeeding - Detected Speed: ${detectedSpeed?.toFixed(1) || 'N/A'} km/h`;
    case 'HELMET':
      return 'Not wearing helmet while driving two-wheeler';
    case 'WRONG_SIDE':
      return 'Driving on wrong side of the road';
    case 'RED_LIGHT':
      return 'Jumping red light signal';
    case 'NO_SEATBELT':
      return 'Not wearing seatbelt while driving';
    case 'OVERLOADING':
      return 'Vehicle overloaded beyond permissible limit';
    case 'ILLEGAL_PARKING':
      return 'Illegal parking in no-parking zone';
    default:
      return 'Traffic rule violation';
  }
};

// Create styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
  },
  header: {
    marginBottom: 20,
    borderBottom: '2 solid #000',
    paddingBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 3,
  },
  section: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    backgroundColor: '#f0f0f0',
    padding: 5,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 5,
    paddingVertical: 3,
  },
  label: {
    width: '40%',
    fontWeight: 'bold',
  },
  value: {
    width: '60%',
  },
  violationBox: {
    border: '1 solid #000',
    padding: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  violationTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  fineBox: {
    border: '2 solid #000',
    padding: 15,
    marginTop: 15,
    marginBottom: 15,
    backgroundColor: '#fffacd',
  },
  fineAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5,
  },
  footer: {
    marginTop: 30,
    paddingTop: 10,
    borderTop: '1 solid #000',
    fontSize: 8,
  },
  signature: {
    marginTop: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  signatureBox: {
    width: '45%',
    borderTop: '1 solid #000',
    paddingTop: 5,
    textAlign: 'center',
  },
  imageContainer: {
    marginTop: 10,
    marginBottom: 10,
    border: '1 solid #ccc',
    padding: 5,
  },
  image: {
    width: '100%',
    maxHeight: 150,
    objectFit: 'contain',
  },
  note: {
    fontSize: 8,
    fontStyle: 'italic',
    marginTop: 10,
    color: '#666',
  },
});

export const ChallanPDF = ({ violation, rcDetails }: ChallanPDFProps) => {
  const fineAmount = getFineAmount(violation.violationType, violation.detectedSpeed);
  const violationDescription = getViolationDescription(violation.violationType, violation.detectedSpeed);
  const violationIdStr = String(violation.id);
  const challanNumber = `KSP-BGM-${violationIdStr.slice(0, 8).toUpperCase()}-${Date.now().toString().slice(-6)}`;
  const issueDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const issueTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const violationDate = new Date(violation.timestamp).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const violationTime = new Date(violation.timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>KARNATAKA STATE POLICE</Text>
          <Text style={styles.subtitle}>Belgam District Traffic Police</Text>
          <Text style={styles.subtitle}>E-CHALLAN / TRAFFIC VIOLATION NOTICE</Text>
        </View>

        {/* Challan Details */}
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Challan Number:</Text>
            <Text style={styles.value}>{challanNumber}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Issue Date & Time:</Text>
            <Text style={styles.value}>{issueDate} at {issueTime}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Violation Date & Time:</Text>
            <Text style={styles.value}>{violationDate} at {violationTime}</Text>
          </View>
        </View>

        {/* Vehicle Details */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>VEHICLE DETAILS</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Vehicle Registration Number:</Text>
            <Text style={styles.value}>{violation.plateNumber || 'NOT DETECTED'}</Text>
          </View>
          {rcDetails && (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Owner Name:</Text>
                <Text style={styles.value}>{rcDetails.owner_name}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Vehicle Make & Model:</Text>
                <Text style={styles.value}>{rcDetails.maker_model} ({rcDetails.maker_description})</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Vehicle Color:</Text>
                <Text style={styles.value}>{rcDetails.color}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Body Type:</Text>
                <Text style={styles.value}>{rcDetails.body_type}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Vehicle Category:</Text>
                <Text style={styles.value}>{rcDetails.vehicle_category_description}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Fuel Type:</Text>
                <Text style={styles.value}>{rcDetails.fuel_type}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Chassis Number:</Text>
                <Text style={styles.value}>{rcDetails.vehicle_chasi_number}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Registration Date:</Text>
                <Text style={styles.value}>{rcDetails.registration_date}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>RC Status:</Text>
                <Text style={styles.value}>{rcDetails.rc_status}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Fitness Valid Until:</Text>
                <Text style={styles.value}>{rcDetails.fit_up_to}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Insurance Valid Until:</Text>
                <Text style={styles.value}>{rcDetails.insurance_upto}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Emission Norms:</Text>
                <Text style={styles.value}>{rcDetails.norms_type}</Text>
              </View>
              {rcDetails.financed && (
                <View style={styles.row}>
                  <Text style={styles.label}>Financed:</Text>
                  <Text style={styles.value}>Yes</Text>
                </View>
              )}
              {rcDetails.blacklist_status ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Blacklist Status:</Text>
                  <Text style={styles.value}>{rcDetails.blacklist_status}</Text>
                </View>
              ) : null}
            </>
          )}
          {violation.device && (
            <>
              <View style={styles.row}>
                <Text style={styles.label}>Location:</Text>
                <Text style={styles.value}>{violation.device.name || violation.device.id}</Text>
              </View>
              {violation.device.lat && violation.device.lng && (
                <View style={styles.row}>
                  <Text style={styles.label}>GPS Coordinates:</Text>
                  <Text style={styles.value}>
                    {violation.device.lat.toFixed(6)}, {violation.device.lng.toFixed(6)}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* Violation Details */}
        <View style={styles.section}>
          <View style={styles.violationBox}>
            <Text style={styles.violationTitle}>VIOLATION DETAILS</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Violation Type:</Text>
              <Text style={styles.value}>{violation.violationType}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Description:</Text>
              <Text style={styles.value}>{violationDescription}</Text>
            </View>
            {violation.detectedSpeed && (
              <View style={styles.row}>
                <Text style={styles.label}>Detected Speed:</Text>
                <Text style={styles.value}>{violation.detectedSpeed.toFixed(1)} km/h</Text>
              </View>
            )}
            {violation.speedLimit2W && (
              <View style={styles.row}>
                <Text style={styles.label}>Speed Limit (2W):</Text>
                <Text style={styles.value}>{violation.speedLimit2W.toFixed(0)} km/h</Text>
              </View>
            )}
            {violation.speedLimit4W && (
              <View style={styles.row}>
                <Text style={styles.label}>Speed Limit (4W):</Text>
                <Text style={styles.value}>{violation.speedLimit4W.toFixed(0)} km/h</Text>
              </View>
            )}
            <View style={styles.row}>
              <Text style={styles.label}>Detection Method:</Text>
              <Text style={styles.value}>{violation.detectionMethod}</Text>
            </View>
            {violation.confidence && (
              <View style={styles.row}>
                <Text style={styles.label}>Detection Confidence:</Text>
                <Text style={styles.value}>{(violation.confidence * 100).toFixed(1)}%</Text>
              </View>
            )}
          </View>
        </View>

        {/* Evidence Images */}
        {(violation.fullSnapshotUrl || violation.plateImageUrl) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>EVIDENCE</Text>
            {violation.fullSnapshotUrl && (
              <View style={styles.imageContainer}>
                <Text style={{ marginBottom: 5, fontSize: 9 }}>Full Snapshot:</Text>
                <Image
                  src={violation.fullSnapshotUrl}
                  style={styles.image}
                  cache={false}
                />
              </View>
            )}
            {violation.plateImageUrl && (
              <View style={styles.imageContainer}>
                <Text style={{ marginBottom: 5, fontSize: 9 }}>License Plate:</Text>
                <Image
                  src={violation.plateImageUrl}
                  style={styles.image}
                  cache={false}
                />
              </View>
            )}
          </View>
        )}

        {/* Fine Amount */}
        <View style={styles.fineBox}>
          <Text style={{ textAlign: 'center', fontSize: 12, fontWeight: 'bold', marginBottom: 5 }}>
            FINE AMOUNT
          </Text>
          <Text style={styles.fineAmount}>₹ {fineAmount.toLocaleString('en-IN')}</Text>
          <Text style={{ textAlign: 'center', fontSize: 9, marginTop: 5 }}>
            (Rupees {fineAmount.toLocaleString('en-IN')} Only)
          </Text>
        </View>

        {/* Payment Instructions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PAYMENT INSTRUCTIONS</Text>
          <Text style={{ marginBottom: 5 }}>
            1. Pay online at: https://ksp.gov.in/epayment
          </Text>
          <Text style={{ marginBottom: 5 }}>
            2. Use Challan Number: {challanNumber}
          </Text>
          <Text style={{ marginBottom: 5 }}>
            3. Pay within 30 days to avoid additional penalties
          </Text>
          <Text style={{ marginBottom: 5 }}>
            4. For disputes, contact: traffic.belgam@ksp.gov.in
          </Text>
        </View>

        {/* Legal Notice */}
        <View style={styles.section}>
          <Text style={styles.note}>
            This is an electronically generated challan under the Motor Vehicles Act, 1988 and
            Karnataka Motor Vehicles Rules. The violation has been recorded through automated
            traffic enforcement system. Failure to pay the fine within the specified period
            may result in additional penalties and legal action.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={{ textAlign: 'center', marginBottom: 5 }}>
            This is a system generated document. No signature required.
          </Text>
          <View style={styles.signature}>
            <View style={styles.signatureBox}>
              <Text>Issued By</Text>
              <Text>KSP Traffic Police</Text>
              <Text>Belgam District</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text>System Reference</Text>
              <Text>ITMS - {violation.id}</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
};
