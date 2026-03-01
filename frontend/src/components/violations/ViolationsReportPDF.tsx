import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import { type TrafficViolation } from '@/lib/api';

interface ViolationsReportPDFProps {
    violations: TrafficViolation[];
    reportTitle: string;
    generatedAt: string;
    filters?: {
        status?: string;
        violationType?: string;
        dateRange?: string;
    };
}

// Create styles
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
    table: {
        width: '100%',
        marginTop: 10,
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: '#1e3a5f',
        color: 'white',
        padding: 8,
        fontWeight: 'bold',
        fontSize: 8,
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: '#ddd',
        padding: 6,
        fontSize: 8,
    },
    tableRowEven: {
        backgroundColor: '#f9f9f9',
    },
    col1: { width: '8%' },
    col2: { width: '15%' },
    col3: { width: '12%' },
    col4: { width: '15%' },
    col5: { width: '15%' },
    col6: { width: '12%' },
    col7: { width: '13%' },
    col8: { width: '10%' },
    summary: {
        marginTop: 20,
        padding: 15,
        backgroundColor: '#f0f0f0',
        borderRadius: 5,
    },
    summaryTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 5,
    },
    summaryLabel: {
        width: '50%',
        fontWeight: 'bold',
    },
    summaryValue: {
        width: '50%',
    },
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
    pageNumber: {
        textAlign: 'right',
        fontSize: 8,
        color: '#666',
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

const getViolationTypeSummary = (violations: TrafficViolation[]) => {
    const summary: Record<string, number> = {};
    violations.forEach((v) => {
        summary[v.violationType] = (summary[v.violationType] || 0) + 1;
    });
    return summary;
};

const getStatusSummary = (violations: TrafficViolation[]) => {
    const summary: Record<string, number> = {};
    violations.forEach((v) => {
        summary[v.status] = (summary[v.status] || 0) + 1;
    });
    return summary;
};

export const ViolationsReportPDF = ({ violations, reportTitle, generatedAt, filters }: ViolationsReportPDFProps) => {
    const typeSummary = getViolationTypeSummary(violations);
    const statusSummary = getStatusSummary(violations);

    return (
        <Document>
            <Page size="A4" style={styles.page} orientation="landscape">
                {/* Header */}
                <View style={styles.header}>
                    <Text style={styles.title}>KARNATAKA STATE POLICE</Text>
                    <Text style={styles.subtitle}>Belgam District Traffic Police - ITMS</Text>
                    <Text style={styles.subtitle}>{reportTitle}</Text>
                    <Text style={styles.filterInfo}>Generated on: {generatedAt}</Text>
                    {filters && (
                        <Text style={styles.filterInfo}>
                            Filters: {filters.status ? `Status: ${filters.status}` : ''}
                            {filters.violationType ? ` | Type: ${filters.violationType}` : ''}
                            {filters.dateRange ? ` | Date: ${filters.dateRange}` : ''}
                        </Text>
                    )}
                </View>

                {/* Summary */}
                <View style={styles.summary}>
                    <Text style={styles.summaryTitle}>SUMMARY</Text>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Total Violations:</Text>
                        <Text style={styles.summaryValue}>{violations.length}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>By Status:</Text>
                        <Text style={styles.summaryValue}>
                            {Object.entries(statusSummary).map(([status, count]) => `${status}: ${count}`).join(' | ')}
                        </Text>
                    </View>
                    <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>By Type:</Text>
                        <Text style={styles.summaryValue}>
                            {Object.entries(typeSummary).map(([type, count]) => `${type}: ${count}`).join(' | ')}
                        </Text>
                    </View>
                </View>

                {/* Table */}
                <View style={styles.table}>
                    {/* Table Header */}
                    <View style={styles.tableHeader}>
                        <Text style={styles.col1}>S.No</Text>
                        <Text style={styles.col2}>Plate Number</Text>
                        <Text style={styles.col3}>Type</Text>
                        <Text style={styles.col4}>Date/Time</Text>
                        <Text style={styles.col5}>Location</Text>
                        <Text style={styles.col6}>Speed</Text>
                        <Text style={styles.col7}>Detection</Text>
                        <Text style={styles.col8}>Status</Text>
                    </View>

                    {/* Table Rows */}
                    {violations.slice(0, 50).map((violation, index) => (
                        <View
                            key={violation.id}
                            style={[styles.tableRow, index % 2 === 0 ? styles.tableRowEven : {}]}
                        >
                            <Text style={styles.col1}>{index + 1}</Text>
                            <Text style={styles.col2}>{violation.plateNumber || 'N/A'}</Text>
                            <Text style={styles.col3}>{violation.violationType}</Text>
                            <Text style={styles.col4}>{formatDateTime(violation.timestamp)}</Text>
                            <Text style={styles.col5}>{violation.device?.name || violation.device?.id || 'N/A'}</Text>
                            <Text style={styles.col6}>
                                {violation.detectedSpeed ? `${violation.detectedSpeed.toFixed(1)} km/h` : '-'}
                            </Text>
                            <Text style={styles.col7}>{violation.detectionMethod}</Text>
                            <Text style={styles.col8}>{violation.status}</Text>
                        </View>
                    ))}
                </View>

                {violations.length > 50 && (
                    <Text style={{ marginTop: 10, fontSize: 8, color: '#666', fontStyle: 'italic' }}>
                        Showing first 50 violations of {violations.length} total.
                    </Text>
                )}

                {/* Footer */}
                <View style={styles.footer}>
                    <Text>This is a system generated report from ITMS - Intelligent Traffic Management System</Text>
                    <Text>Karnataka State Police, Belgam District</Text>
                </View>
            </Page>
        </Document>
    );
};
