# Karnataka Smart Transit 2.0 — API Contracts & WebSocket Specifications

## 1. REST Endpoints

### A. Transit Routes & Fleet Telemetry
- `GET /api/routes`
  - Returns: `{ success: true, routes: [ { id, name, source, destination, distanceKm, tollFee, stops } ] }`
- `GET /api/buses`
  - Returns: `{ success: true, buses: [ { id, busNumber, routeId, serviceType, totalSeats, occupiedSeats, boardedSeats } ] }`
- `GET /api/fleet/live`
  - Returns current telemetry array: `{ success: true, telemetry: [ { busId, routeId, latitude, longitude, speedKmh, headingDegrees, nextStop, delayMinutes } ] }`
- `GET /api/fleet/routes`
  - Returns geographic highway waypoints: `{ success: true, polylines: { "route-1": [...], "route-2": [...] } }`
- `POST /api/fleet/telemetry` (Authenticated real-device ingestion)
  - Headers: `x-device-token: <DEVICE_TOKEN>`
  - Body: `{ busId, latitude, longitude, speedKmh, headingDegrees, nextStopName, delayMinutes }`

### B. Versioned Tariff & Fare Engine
- `POST /api/fare/calculate`
  - Body:
    ```json
    {
      "serviceType": "Karnataka Sarige",
      "distanceKm": 145,
      "tollFee": 40,
      "passengers": [
        { "name": "Deepa Rao", "age": 28, "gender": "Female", "isKarnatakaResident": true, "isShaktiScheme": true }
      ]
    }
    ```
  - Returns: Itemized base fare, toll, cess, GST, Shakti subsidy, and net payable.
- `GET /api/fare/rates`
  - Returns active tariff schedule, rate-per-km cards, and concession rules.

### C. Atomic Booking & Ticket Issuance
- `POST /api/tickets/book`
  - Body:
    ```json
    {
      "busId": "BUS-KA-01-4821",
      "routeId": "route-1",
      "passengers": [{ "name": "Ramesh Gowda", "age": 34, "gender": "Male" }],
      "selectedSeats": ["12W"],
      "idempotencyKey": "a9b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
    ```
  - Responses:
    - `201 Created`: `{ success: true, ticket: { bookingId, pnr, ticketId, qrToken, qrDataUrl, selectedSeats } }`
    - `409 Conflict`: `{ success: false, error: "Seat 12W is already occupied or held by another passenger. Booking rejected." }`
    - `400 Bad Request`: Validation failure.

- `GET /api/tickets/:id/pdf`
  - Streams high-resolution printable PDF boarding pass with embedded vector QR code.

### D. Turnstile Gate Access Verification
- `POST /api/gate/verify`
  - Body:
    ```json
    {
      "qrData": "KST2.2026-Q3-PRIMARY.eyJ0aWQiOiJLQS1LU1JUQy0yMDI2LTE1OTU2...<signature>",
      "gateBusId": "BUS-KA-01-4821",
      "gateId": "GATE-G1",
      "scanInputType": "OPTICAL_WEBCAM"
    }
    ```
  - Responses:
    - `ACCESS_GRANTED`: `{ status: "GRANTED", code: "ACCESS_GRANTED", passengerName: "...", seat: "12W" }`
    - `ALREADY_BOARDED`: `{ status: "DENIED", code: "ALREADY_BOARDED", details: "Passback rejected" }`
    - `WRONG_BUS`: `{ status: "DENIED", code: "WRONG_BUS", details: "Ticket valid for Bus X, not Gate Bus Y" }`
    - `COUNTERFEIT_DETECTED`: `{ status: "DENIED", code: "COUNTERFEIT_DETECTED", details: "Invalid signature" }`

### E. Localization & Languages
- `GET /api/i18n/:lang` (`en`, `kn`, `hi`)
  - Returns localized dictionary strings for client UI.

---

## 2. WebSocket (Socket.IO) Event Architecture

| Event Name | Direction | Payload Description |
|---|---|---|
| `fleet:telemetry` | Server $\to$ Client | Live GPS coordinates, heading, speed, next stop, and ETA |
| `fleet:initial` | Server $\to$ Client | Snapshot of all active vehicle positions on client connection |
| `gate:decision` | Server $\to$ Client | Real-time gate scan decision broadcast to digital twin & manifest |
| `inventory:updated`| Server $\to$ Client | Real-time seat occupancy update when a reservation is placed |
| `gate:sensor_event`| Client $\to$ Server | Digital twin sensor state change (IR beam break, obstruction) |
| `system:reset` | Server $\to$ Client | Notification that demo state was reset |
