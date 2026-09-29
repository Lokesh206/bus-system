# Karnataka Bus Ticketing & Turnstile Gate Access Control Simulation System
### ಕರ್ನಾಟಕ ರಾಜ್ಯ ರಸ್ತೆ ಸಾರಿಗೆ ನಿಗಮ (KSRTC / BMTC Smart Transit)

An interactive, end-to-end simulation of an automated bus ticketing, Karnataka fare calculation, pass issuance, and turnstile gate access verification system.

---

## 🌟 Key Features

1. **Karnataka Transit Fare Engine**:
   - **KSRTC & BMTC Bus Services**: *Karnataka Sarige* (Ordinary Express), *Rajahamsa* (Semi-Sleeper), *Airavat Club Class* (Volvo Multi-Axle AC), and *EV Power Plus* (Electric Intercity).
   - **Dynamic Itemized Fare Rules**:
     - Base distance fare calculated per kilometer (\(\text{Distance} \times \text{Rate/km}\)).
     - Route highway toll charges.
     - Passenger amenity cess.
     - 5% GST on AC services.
   - **Karnataka Shakti Scheme**: 100% Free Travel pass for women residents on non-AC state buses (*Karnataka Sarige*).
   - **Concessions**: Senior Citizen (25% off) and Child (50% off) fare logic.

2. **Digital Ticket & Boarding Pass Engine**:
   - Unique PNR and Ticket ID (`KA-KSRTC-YYYY-XXXXX`).
   - Cryptographic HMAC-SHA256 signature embedded into high-contrast QR codes.
   - Download as **Official Printable PDF** or **Digital Pass (PNG)**.

3. **Simulated Bus Entry Turnstile & QR Scanner**:
   - **Webcam Optical Scanner**: Live camera scan of mobile screen or printed pass.
   - **File Upload Scanner**: Upload downloaded PDF/PNG pass directly.
   - **1-Click Simulation Buttons**:
     - 🟢 **Scan Latest Ticket**: Normal successful boarding $\to$ `ACCESS GRANTED`.
     - 🔄 **Re-Scan Same Ticket**: Duplicate entry/passback $\to$ `ACCESS DENIED: ALREADY BOARDED`.
     - 🚌 **Scan at Wrong Gate**: Passenger scanning at wrong bus gate $\to$ `ACCESS DENIED: WRONG BUS`.
     - ⚠️ **Scan Tampered QR**: Altered signature $\to$ `ACCESS DENIED: COUNTERFEIT DETECTED`.
   - **Visual Motorized Flap Barrier**: Smooth 3D opening animation with Emerald Green / Crimson Red LED indicator lights.
   - **Synthesized Audio Engine**: Dual-tone chime for access granted, low buzzer alarm for access denied (using browser Web Audio API, no external mp3 files required).

4. **Conductor Seating Manifest & Live Audit Log**:
   - Real-time 2D bus seating chart: Available (White), Booked (Blue), and Boarded (Green).
   - Occupancy progress bar and live passenger check-in list.
   - Security audit trail recording all turnstile scan attempts with exact timestamps and diagnostics.

---

## 🚀 How to Run the Application

The server is currently running at:
**[http://localhost:3000](http://localhost:3000)**

To run or restart manually at any time:
```powershell
cd "c:\Users\Lenovo\Desktop\bus system"
npm start
```
Then open your web browser to:
`http://localhost:3000`

---

## 🧪 Running Automated Tests

Run the built-in test suite verifying fare calculation, Shakti scheme waiver, PDF generation, and turnstile verification:
```powershell
npm test
```

---

## 📂 Project Structure

```
bus-system/
├── package.json               # Dependencies and scripts
├── server.js                  # Express REST API & static web server
├── README.md                  # Project documentation
├── data/
│   ├── routes.json            # Karnataka routes (Majestic -> Mysuru, Mangaluru, etc.)
│   ├── buses.json             # Buses, schedules, and live seat layout
│   ├── tickets.json           # Issued transit passes
│   └── gateLogs.json          # Turnstile access audit logs
├── services/
│   ├── fareCalculator.js      # Karnataka fare formulas & Shakti scheme
│   ├── ticketService.js       # Booking, seat reservation & QR signing
│   ├── pdfGenerator.js        # High-resolution PDF boarding pass generator
│   └── gateService.js         # Turnstile access control decision engine
├── test/
│   └── testFareAndGate.js     # Comprehensive automated test suite
└── public/
    ├── index.html             # High-fidelity dashboard interface
    ├── styles.css             # Turnstile animations & ticket styling
    ├── app.js                 # Frontend interactive logic
    └── js/
        └── audio.js           # Web Audio API sound synthesizer
```

