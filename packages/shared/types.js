const { z } = require('zod');

// Zod Validation Schemas

const PassengerSchema = z.object({
  name: z.string().min(2, 'Passenger name must be at least 2 characters').max(60),
  age: z.number().int().min(1).max(120),
  gender: z.enum(['Male', 'Female', 'Other']),
  isKarnatakaResident: z.boolean().default(false),
  isShaktiScheme: z.boolean().default(false)
});

const BookingRequestSchema = z.object({
  busId: z.string().min(1, 'Bus identifier is required'),
  routeId: z.string().min(1, 'Route identifier is required'),
  passengers: z.array(PassengerSchema).min(1, 'At least 1 passenger is required').max(6, 'Maximum 6 passengers per booking'),
  selectedSeats: z.array(z.string()).min(1, 'At least 1 seat is required').max(6),
  idempotencyKey: z.string().uuid().optional(),
  paymentProvider: z.enum(['SANDBOX', 'UPI_DEMO']).default('SANDBOX')
}).refine(data => data.passengers.length === data.selectedSeats.length, {
  message: 'Number of passengers must match number of selected seats',
  path: ['selectedSeats']
});

const SeatHoldRequestSchema = z.object({
  tripId: z.string().min(1),
  seatNumbers: z.array(z.string()).min(1).max(6),
  sessionId: z.string().min(1)
});

const GateVerifyRequestSchema = z.object({
  qrData: z.union([z.string().min(1), z.record(z.any())]),
  gateBusId: z.string().optional(),
  gateId: z.string().optional(),
  scanInputType: z.enum(['OPTICAL_WEBCAM', 'FILE_UPLOAD', 'MANUAL', 'SIMULATOR']).default('SIMULATOR')
});

const GpsTelemetrySchema = z.object({
  busId: z.string().min(1),
  tripId: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(200),
  headingDegrees: z.number().min(0).max(360),
  nextStopName: z.string().optional(),
  delayMinutes: z.number().int().default(0),
  timestamp: z.string().datetime().optional()
});

const TariffVersionSchema = z.object({
  version: z.string(),
  name: z.string(),
  disclaimer: z.string(),
  effectiveDate: z.string(),
  serviceClasses: z.record(z.object({
    code: z.string(),
    name: z.string(),
    isAc: z.boolean(),
    ratePerKm: z.number().positive(),
    minFare: z.number().nonnegative(),
    passengerCess: z.number().nonnegative(),
    gstPercent: z.number().nonnegative(),
    shaktiEligible: z.boolean()
  }))
});

module.exports = {
  PassengerSchema,
  BookingRequestSchema,
  SeatHoldRequestSchema,
  GateVerifyRequestSchema,
  GpsTelemetrySchema,
  TariffVersionSchema
};
