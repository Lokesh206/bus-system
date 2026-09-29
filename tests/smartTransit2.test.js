const assert = require('assert');
const { defaultTariffEngine } = require('../packages/shared/tariffs');
const { createTransitToken, verifyTransitToken } = require('../packages/shared/securityToken');
const { transitRepository } = require('../apps/api/src/db/transitDb');
const { gpsSimulator } = require('../apps/api/src/services/gpsSimulator');

async function runTestSuite() {
  console.log('🧪 Running Karnataka Smart Transit 2.0 Comprehensive Test Suite...\n');

  // Reset repository state for deterministic testing
  transitRepository.resetDemo();

  // -----------------------------------------------------------
  // TEST 1: Versioned Tariff Engine & Shakti Scheme Waiver
  // -----------------------------------------------------------
  console.log('1. Testing Versioned Karnataka Tariff Engine...');
  const ordinaryFare = defaultTariffEngine.calculate({
    serviceType: 'Karnataka Sarige',
    distanceKm: 145,
    tollFee: 40,
    passengers: [{ name: 'Ananya Sharma', age: 26, gender: 'Female', isKarnatakaResident: true, isShaktiScheme: true }]
  });

  assert.strictEqual(ordinaryFare.totals.totalPayable, 0, 'Shakti scheme passenger must pay ₹0');
  assert(ordinaryFare.totals.totalDiscount > 0, 'Shakti subsidy must be recorded');
  console.log(`   ✅ Shakti Scheme verified: Total Payable: ₹${ordinaryFare.totals.totalPayable}, Subsidy Granted: ₹${ordinaryFare.totals.totalDiscount}`);

  const volvoFare = defaultTariffEngine.calculate({
    serviceType: 'Airavat Club Class',
    distanceKm: 145,
    tollFee: 40,
    passengers: [{ name: 'Vikram Gowda', age: 35, gender: 'Male', isKarnatakaResident: false }]
  });

  assert(volvoFare.totals.gst > 0, 'Airavat AC bus must include 5% GST');
  console.log(`   ✅ Airavat Club Class: Base ₹${volvoFare.totals.baseFare}, Toll ₹${volvoFare.totals.tollCharges}, GST ₹${volvoFare.totals.gst}, Total ₹${volvoFare.totals.totalPayable}`);

  // -----------------------------------------------------------
  // TEST 2: High-Concurrency Seat Collision (Atomic Race Condition)
  // -----------------------------------------------------------
  console.log('\n2. Testing Concurrent Simultaneous Seat Booking Race Condition...');
  const targetSeat = '14A';
  const busId = 'BUS-KA-01-4821';
  const routeId = 'route-1';

  let successCount = 0;
  let conflictCount = 0;

  // Simulate two users attempting to lock seat 14A at the exact same millisecond
  const concurrentAttempts = await Promise.allSettled([
    transitRepository.executeBookingTransaction({
      busId,
      routeId,
      passengers: [{ name: 'User A (First Click)', age: 30, gender: 'Male' }],
      selectedSeats: [targetSeat],
      fareResult: volvoFare
    }),
    transitRepository.executeBookingTransaction({
      busId,
      routeId,
      passengers: [{ name: 'User B (Simultaneous Click)', age: 28, gender: 'Female' }],
      selectedSeats: [targetSeat],
      fareResult: volvoFare
    })
  ]);

  concurrentAttempts.forEach((attempt, index) => {
    if (attempt.status === 'fulfilled') {
      successCount++;
      console.log(`   Attempt ${index + 1}: SUCCESSFUL (Secured Seat ${targetSeat})`);
    } else {
      conflictCount++;
      console.log(`   Attempt ${index + 1}: REJECTED WITH CONFLICT ("${attempt.reason.message}")`);
    }
  });

  assert.strictEqual(successCount, 1, 'Exactly one concurrent booking attempt must succeed');
  assert.strictEqual(conflictCount, 1, 'The competing concurrent booking attempt must be blocked');
  console.log('   ✅ Concurrency Test Passed: Zero double-booking detected under simultaneous load.');

  // -----------------------------------------------------------
  // TEST 3: Cryptographic Token Generation & Key Rotation
  // -----------------------------------------------------------
  console.log('\n3. Testing Cryptographic Transit Token Security...');
  const testToken = createTransitToken({
    ticketId: 'KA-KSRTC-2026-99999',
    pnr: 'KA882211',
    busId: 'BUS-KA-01-4821',
    routeId: 'route-1',
    seatNumber: '14A',
    passengerId: 'PAX-TEST-001'
  });

  assert(testToken.startsWith('KST2.2026-Q3-PRIMARY.'), 'Token must use active key identifier');
  const verifyValid = verifyTransitToken(testToken);
  assert.strictEqual(verifyValid.valid, true, 'Valid token must pass cryptographic verification');
  assert.strictEqual(verifyValid.payload.tid, 'KA-KSRTC-2026-99999');
  console.log(`   ✅ Token generation and verification successful! Token format: ${testToken.substring(0, 35)}...`);

  // Test Tampered Token
  const tamperedToken = testToken.substring(0, testToken.length - 4) + 'abcd';
  const verifyTampered = verifyTransitToken(tamperedToken);
  assert.strictEqual(verifyTampered.valid, false, 'Tampered token must fail');
  console.log(`   ✅ Tamper rejection confirmed: "${verifyTampered.error}"`);

  // -----------------------------------------------------------
  // TEST 4: Turnstile Gate Boarding Lifecycle (Atomic State Machine)
  // -----------------------------------------------------------
  console.log('\n4. Testing Gate Access Control: First Scan (Access Granted)...');
  // Get the successful ticket from Test 2
  const successfulBooking = concurrentAttempts.find(a => a.status === 'fulfilled').value.booking;
  const bookedTicket = successfulBooking.tickets[0];

  const firstScan = await transitRepository.executeGateVerification({
    ticketId: bookedTicket.ticketId,
    gateBusId: busId,
    gateId: 'GATE-G1'
  });

  assert.strictEqual(firstScan.decision, 'GRANTED', 'First scan must grant entry');
  console.log(`   ✅ Gate 1st Scan: ${firstScan.decision} - "${firstScan.details}"`);

  console.log('\n5. Testing Gate Passback Prevention: Re-Scan of Same Ticket...');
  const secondScan = await transitRepository.executeGateVerification({
    ticketId: bookedTicket.ticketId,
    gateBusId: busId,
    gateId: 'GATE-G1'
  });

  assert.strictEqual(secondScan.decision, 'DENIED', 'Second scan must be denied');
  assert.strictEqual(secondScan.diagnosticCode, 'ALREADY_BOARDED', 'Diagnostic must specify ALREADY_BOARDED');
  console.log(`   ✅ Gate 2nd Scan: ${secondScan.decision} (${secondScan.diagnosticCode}) - "${secondScan.details}"`);

  // -----------------------------------------------------------
  // TEST 5: Wrong Bus Gate Rejection
  // -----------------------------------------------------------
  console.log('\n6. Testing Gate Wrong Bus Rejection...');
  const newBooking = await transitRepository.executeBookingTransaction({
    busId: 'BUS-KA-01-4821', // Route 1 to Mysuru
    routeId: 'route-1',
    passengers: [{ name: 'Deepak Rao', age: 31, gender: 'Male' }],
    selectedSeats: ['16W'],
    fareResult: volvoFare
  });

  const wrongBusScan = await transitRepository.executeGateVerification({
    ticketId: newBooking.tickets[0].ticketId,
    gateBusId: 'BUS-KA-19-3305', // Route 2 to Mangaluru
    gateId: 'GATE-G3'
  });

  assert.strictEqual(wrongBusScan.decision, 'DENIED');
  assert.strictEqual(wrongBusScan.diagnosticCode, 'WRONG_BUS');
  console.log(`   ✅ Wrong Bus Scan: ${wrongBusScan.decision} (${wrongBusScan.diagnosticCode}) - "${wrongBusScan.details}"`);

  // -----------------------------------------------------------
  // TEST 6: GPS Fleet Simulator Telemetry
  // -----------------------------------------------------------
  console.log('\n7. Testing GPS Fleet Telemetry Generator...');
  gpsSimulator.tick();
  const fleetPositions = gpsSimulator.getLiveTelemetry();
  assert(fleetPositions.length > 0, 'Fleet simulator must produce active bus telemetry');
  const bus1Pos = fleetPositions.find(b => b.busId === 'BUS-KA-01-4821');
  assert(bus1Pos.latitude && bus1Pos.longitude, 'Bus must have geographic coordinates');
  assert(bus1Pos.speedKmh > 0, 'Bus speed must be positive');
  console.log(`   ✅ GPS Telemetry: Bus ${bus1Pos.busId} Lat: ${bus1Pos.latitude}, Lng: ${bus1Pos.longitude}, Speed: ${bus1Pos.speedKmh} km/h, Next: ${bus1Pos.nextStop}`);

  console.log('\n=============================================================');
  console.log('🎉 ALL KARNATAKA SMART TRANSIT 2.0 AUTOMATED TESTS PASSED! 🎉');
  console.log('=============================================================\n');
}

runTestSuite().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
