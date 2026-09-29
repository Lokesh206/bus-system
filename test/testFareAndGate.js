const assert = require('assert');
const { calculateFare } = require('../services/fareCalculator');
const { bookTicket, getTicketById, loadTickets } = require('../services/ticketService');
const { verifyGateScan, resetDemoData } = require('../services/gateService');
const { generateTicketPdf } = require('../services/pdfGenerator');

async function runTests() {
  console.log('🧪 Starting Karnataka Bus Ticketing & Gate Scanner Verification Tests...\n');

  // Reset initial data for clean test
  resetDemoData();

  // Test 1: Standard Fare Calculation
  console.log('1. Testing Standard Fare Calculation (Airavat Club Class, 145km)...');
  const fareResult = calculateFare({
    serviceType: 'Airavat Club Class',
    distanceKm: 145,
    tollFee: 40,
    passengers: [{ name: 'Anand Rao', age: 34, gender: 'Male', isKarnatakaResident: false }]
  });

  assert(fareResult.totals.totalPayable > 0, 'Total payable should be > 0');
  assert(fareResult.totals.gst > 0, 'AC bus should have GST');
  console.log(`   ✅ Base: ₹${fareResult.totals.baseFare}, Toll: ₹${fareResult.totals.tollCharges}, GST: ₹${fareResult.totals.gst}, Total: ₹${fareResult.totals.totalPayable}`);

  // Test 2: Karnataka Shakti Scheme Free Travel
  console.log('\n2. Testing Karnataka Shakti Scheme (Karnataka Sarige, Female, Resident)...');
  const shaktiResult = calculateFare({
    serviceType: 'Karnataka Sarige',
    distanceKm: 145,
    tollFee: 40,
    passengers: [{ name: 'Kavitha Devi', age: 29, gender: 'Female', isKarnatakaResident: true, isShaktiScheme: true }]
  });

  assert.strictEqual(shaktiResult.totals.totalPayable, 0, 'Shakti scheme passenger should pay ₹0');
  assert(shaktiResult.totals.totalDiscount > 0, 'Discount should reflect state subsidy');
  console.log(`   ✅ Shakti Fare: ₹${shaktiResult.totals.totalPayable}, Subsidy Granted: ₹${shaktiResult.totals.totalDiscount}`);

  // Test 3: Ticket Booking & QR Code Generation
  console.log('\n3. Testing Ticket Booking and QR Generation...');
  const testRoute = {
    id: 'route-1',
    name: 'Bengaluru (Majestic) -> Mysuru (Suburban BS)',
    source: 'Bengaluru (Majestic)',
    destination: 'Mysuru (Suburban BS)',
    distanceKm: 145,
    tollFee: 40
  };

  const bookedTicket = await bookTicket({
    busId: 'BUS-KA-01-4821',
    route: testRoute,
    passengers: [{ name: 'Ramesh Gowda', age: 40, gender: 'Male', isKarnatakaResident: true }],
    selectedSeats: ['12W']
  });

  assert(bookedTicket.ticketId, 'Ticket should have a unique ID');
  assert(bookedTicket.qrDataUrl, 'Ticket must contain a QR data URL');
  assert(bookedTicket.qrPayload.sig, 'Ticket QR payload must have cryptographic signature');
  console.log(`   ✅ Ticket Issued: ${bookedTicket.ticketId}, PNR: ${bookedTicket.pnr}, QR Sig: ${bookedTicket.qrPayload.sig}`);

  // Test 4: PDF Generation
  console.log('\n4. Testing PDF Generation Engine...');
  const pdfBytes = await generateTicketPdf(bookedTicket);
  assert(pdfBytes && pdfBytes.length > 1000, 'PDF buffer should be non-empty and valid');
  console.log(`   ✅ PDF Generated successfully! Size: ${pdfBytes.length} bytes`);

  // Test 5: Gate Scanning - First Scan (Access Granted)
  console.log('\n5. Testing Gate Scanner - First Scan at Gate...');
  const scanResult1 = await verifyGateScan({
    qrData: bookedTicket.qrDataString,
    gateBusId: 'BUS-KA-01-4821'
  });

  assert.strictEqual(scanResult1.status, 'GRANTED', 'First scan must be GRANTED');
  console.log(`   ✅ Gate Result: ${scanResult1.status} - "${scanResult1.message}"`);

  // Test 6: Gate Scanning - Re-scan / Duplicate Entry (Access Denied)
  console.log('\n6. Testing Gate Scanner - Second Scan of Same Ticket (Passback prevention)...');
  const scanResult2 = await verifyGateScan({
    qrData: bookedTicket.qrDataString,
    gateBusId: 'BUS-KA-01-4821'
  });

  assert.strictEqual(scanResult2.status, 'DENIED', 'Second scan must be DENIED');
  assert.strictEqual(scanResult2.code, 'ALREADY_USED', 'Reason code should be ALREADY_USED');
  console.log(`   ✅ Gate Result: ${scanResult2.status} (${scanResult2.code}) - "${scanResult2.message}"`);

  // Test 7: Gate Scanning - Wrong Bus Rejection
  console.log('\n7. Testing Gate Scanner - Valid Ticket at WRONG Bus Gate...');
  // Book ticket for Bus 1
  const ticketBus1 = await bookTicket({
    busId: 'BUS-KA-01-4821',
    route: testRoute,
    passengers: [{ name: 'Suresh Kumar', age: 32, gender: 'Male', isKarnatakaResident: false }],
    selectedSeats: ['14A']
  });

  // Try to scan at Gate for Bus 2 (BUS-KA-09-7712)
  const wrongBusScan = await verifyGateScan({
    qrData: ticketBus1.qrDataString,
    gateBusId: 'BUS-KA-09-7712'
  });

  assert.strictEqual(wrongBusScan.status, 'DENIED', 'Scan at wrong bus must be DENIED');
  assert.strictEqual(wrongBusScan.code, 'WRONG_BUS', 'Reason code should be WRONG_BUS');
  console.log(`   ✅ Gate Result: ${wrongBusScan.status} (${wrongBusScan.code}) - "${wrongBusScan.message}"`);

  // Test 8: Gate Scanning - Counterfeit / Fake QR Rejection
  console.log('\n8. Testing Gate Scanner - Counterfeit / Fake QR...');
  const fakeQrPayload = JSON.stringify({
    ticketId: bookedTicket.ticketId,
    pnr: bookedTicket.pnr,
    busId: 'BUS-KA-01-4821',
    seats: ['99X'], // Tampered seat
    sig: 'fake_tampered_signature_123'
  });

  const fakeScan = await verifyGateScan({
    qrData: fakeQrPayload,
    gateBusId: 'BUS-KA-01-4821'
  });

  assert.strictEqual(fakeScan.status, 'DENIED', 'Fake QR must be DENIED');
  assert.strictEqual(fakeScan.code, 'COUNTERFEIT_DETECTED', 'Reason code should be COUNTERFEIT_DETECTED');
  console.log(`   ✅ Gate Result: ${fakeScan.status} (${fakeScan.code}) - "${fakeScan.message}"`);

  console.log('\n======================================================');
  console.log('🎉 ALL 8 AUTOMATED TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});

