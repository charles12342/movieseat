import React from 'react';
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

export interface TicketPdfProps {
  ticket: {
    referenceCode: string;
    customerName: string;
    customerEmail: string;
    movieTitle: string;
    auditoriumName: string;
    screenType: string;
    soundSystem: string;
    showtimeDate: string;
    showtimeClock: string;
    seats: string;
    seatsCount: number;
    totalAmount: string;
    status: string;
  };
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#0B0B0D',
    color: '#F3F4F6',
    padding: 36,
    fontFamily: 'Helvetica',
  },
  header: {
    borderBottomWidth: 1.5,
    borderBottomColor: '#F59E0B',
    paddingBottom: 16,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 24,
    fontWeight: 'black',
    color: '#F59E0B',
    letterSpacing: 1,
  },
  logoSubtitle: {
    fontSize: 9,
    color: '#9CA3AF',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  passBadge: {
    backgroundColor: '#15161B',
    borderWidth: 1,
    borderColor: '#23252E',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
  passBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: '#15161B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#23252E',
    padding: 20,
    marginBottom: 16,
  },
  movieTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  cinemaSpecs: {
    fontSize: 11,
    color: '#38BDF8',
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  gridCol: {
    width: '50%',
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 8.5,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  fieldValue: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  fieldValueGold: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: 'bold',
  },
  stubSection: {
    borderTopWidth: 1.5,
    borderTopColor: '#2A2C35',
    borderTopStyle: 'dashed',
    paddingTop: 16,
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refLabel: {
    fontSize: 8.5,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  refCode: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F59E0B',
    letterSpacing: 2,
    fontFamily: 'Courier-Bold',
  },
  barcodeContainer: {
    alignItems: 'center',
  },
  barcodeBars: {
    flexDirection: 'row',
    height: 36,
    alignItems: 'stretch',
    marginBottom: 4,
  },
  barcodeText: {
    fontSize: 7.5,
    color: '#9CA3AF',
    letterSpacing: 1,
  },
  guidelinesCard: {
    backgroundColor: '#101115',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E2027',
    padding: 12,
    marginTop: 8,
  },
  guidelinesTitle: {
    fontSize: 9.5,
    fontWeight: 'bold',
    color: '#F3F4F6',
    marginBottom: 4,
  },
  guidelinesBody: {
    fontSize: 8,
    color: '#9CA3AF',
    lineHeight: 1.4,
  },
  footer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#1E2027',
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: '#6B7280',
  },
});

export default function TicketPdfDocument({ ticket }: TicketPdfProps) {
  // Generate decorative barcode lines
  const barcodePattern = [
    3, 1, 2, 1, 4, 1, 2, 3, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 2, 3, 1, 2, 4,
    1, 3, 2, 1, 4, 1, 2, 3, 1, 3, 2, 1, 4, 2, 1, 3,
  ];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logoText}>MovieSeat</Text>
            <Text style={styles.logoSubtitle}>Cinema City Hall \u2022 Digital Admission Pass</Text>
          </View>
          <View style={styles.passBadge}>
            <Text style={styles.passBadgeText}>{ticket.status || 'CONFIRMED'}</Text>
          </View>
        </View>

        {/* Main Ticket Card */}
        <View style={styles.card}>
          <Text style={styles.movieTitle}>{ticket.movieTitle}</Text>
          <Text style={styles.cinemaSpecs}>
            {ticket.auditoriumName} \u2022 {ticket.screenType} \u2022 {ticket.soundSystem}
          </Text>

          <View style={styles.grid}>
            <View style={styles.gridCol}>
              <Text style={styles.fieldLabel}>Date & Time</Text>
              <Text style={styles.fieldValue}>{ticket.showtimeDate} at {ticket.showtimeClock}</Text>
            </View>

            <View style={styles.gridCol}>
              <Text style={styles.fieldLabel}>Reserved Seats ({ticket.seatsCount})</Text>
              <Text style={styles.fieldValueGold}>{ticket.seats}</Text>
            </View>

            <View style={styles.gridCol}>
              <Text style={styles.fieldLabel}>Ticket Holder</Text>
              <Text style={styles.fieldValue}>{ticket.customerName}</Text>
            </View>

            <View style={styles.gridCol}>
              <Text style={styles.fieldLabel}>Total Paid</Text>
              <Text style={styles.fieldValue}>{ticket.totalAmount}</Text>
            </View>
          </View>

          {/* Stub / Barcode section */}
          <View style={styles.stubSection}>
            <View>
              <Text style={styles.refLabel}>Booking Reference Code</Text>
              <Text style={styles.refCode}>{ticket.referenceCode}</Text>
            </View>

            <View style={styles.barcodeContainer}>
              <View style={styles.barcodeBars}>
                {barcodePattern.map((width, idx) => (
                  <View
                    key={idx}
                    style={{
                      width,
                      backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#0B0B0D',
                      marginRight: 1,
                    }}
                  />
                ))}
              </View>
              <Text style={styles.barcodeText}>TURNSTILE 1-3 DIRECT ENTRY</Text>
            </View>
          </View>
        </View>

        {/* Guidelines Card */}
        <View style={styles.guidelinesCard}>
          <Text style={styles.guidelinesTitle}>Concession & Admission Guidelines</Text>
          <Text style={styles.guidelinesBody}>
            \u2022 Present this digital ticket or barcode at Turnstiles 1-3 for direct theater access.{'\n'}
            \u2022 Outside hot meals and pungent food items are strictly prohibited inside the auditorium.{'\n'}
            \u2022 Cinema snacks, popcorn, and beverages are available at Concessions Level 2.{'\n'}
            \u2022 Please arrive 15 minutes before showtime. Latecomers may be seated during pauses.
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text>Issued by MovieSeat \u2022 Manila Timezone (PST / UTC+8)</Text>
          <Text>Support: bookings@movieseat.test</Text>
        </View>
      </Page>
    </Document>
  );
}
