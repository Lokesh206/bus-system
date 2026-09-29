/**
 * Karnataka Bus Transit Simulator - Client Application
 */

// Application State
const state = {
  routes: [],
  buses: [],
  selectedRoute: null,
  selectedBus: null,
  passengers: [
    { name: 'Ramesh Gowda', age: 34, gender: 'Male', isKarnatakaResident: true, isShaktiScheme: false }
  ],
  selectedSeats: [],
  fareCalculation: null,
  latestBookedTicket: null,
  currentGateBusId: null,
  isCameraRunning: false,
  html5QrScanner: null
};

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupClock();
  setupAudioToggle();
  await loadInitialData();
  setupEventListeners();
});

function setupClock() {
  setInterval(() => {
    const now = new Date();
    const clockEl = document.getElementById('turnstileClock');
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString();
    }
  }, 1000);
}

function setupAudioToggle() {
  const btn = document.getElementById('btnAudioToggle');
  const icon = document.getElementById('audioIcon');
  const label = document.getElementById('audioLabel');

  btn.addEventListener('click', () => {
    const isMuted = window.transitAudio.toggleMute();
    if (isMuted) {
      icon.className = 'fa-solid fa-volume-xmark text-red-400';
      label.textContent = 'Muted';
    } else {
      icon.className = 'fa-solid fa-volume-high text-emerald-400';
      label.textContent = 'Sound On';
      window.transitAudio.playClick();
    }
  });

  document.getElementById('btnResetDemo').addEventListener('click', async () => {
    if (confirm('Reset all bus occupancy and ticket scan history for fresh testing?')) {
      await fetch('/api/gate/reset', { method: 'POST' });
      await loadInitialData();
      alert('Demo data reset successfully.');
    }
  });
}

async function loadInitialData() {
  try {
    const [routesRes, busesRes] = await Promise.all([
      fetch('/api/routes').then(r => r.json()),
      fetch('/api/buses').then(r => r.json())
    ]);

    if (routesRes.success) {
      state.routes = routesRes.routes;
      populateRouteSelect();
    }

    if (busesRes.success) {
      state.buses = busesRes.buses;
      populateGateBusSelect();
      populateManifestBusSelect();
    }

    // Load recent tickets to populate latest ticket if available
    const ticketsRes = await fetch('/api/tickets').then(r => r.json());
    if (ticketsRes.success && ticketsRes.tickets.length > 0) {
      state.latestBookedTicket = ticketsRes.tickets[0];
    }

    // Select initial route & bus
    if (state.routes.length > 0) {
      selectRoute(state.routes[0].id);
    }

    await refreshGateLogs();
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }
}

function setupEventListeners() {
  document.getElementById('routeSelect').addEventListener('change', (e) => {
    selectRoute(e.target.value);
  });

  document.getElementById('btnAddPassenger').addEventListener('click', () => {
    addPassenger();
  });
}

// -------------------------------------------------------------
// TAB SWITCHING
// -------------------------------------------------------------
function switchTab(tabId) {
  window.transitAudio.playClick();

  const tabs = ['booking', 'scanner', 'manifest'];
  tabs.forEach(t => {
    const content = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`);
    const btn = document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
    
    if (t === tabId) {
      content.classList.remove('hidden');
      btn.className = 'px-4 py-2 rounded-lg bg-red-800/80 text-white flex items-center space-x-2 border border-amber-500/30 transition shadow-sm';
    } else {
      content.classList.add('hidden');
      btn.className = 'px-4 py-2 rounded-lg bg-slate-900/60 text-slate-300 hover:text-white flex items-center space-x-2 border border-slate-800 transition';
    }
  });

  if (tabId === 'manifest') {
    renderManifest();
  }
}

// -------------------------------------------------------------
// ROUTE & BUS SELECTION
// -------------------------------------------------------------
function populateRouteSelect() {
  const select = document.getElementById('routeSelect');
  select.innerHTML = state.routes.map(r => `
    <option value="${r.id}">${r.name} (${r.distanceKm} km)</option>
  `).join('');
}

function selectRoute(routeId) {
  const route = state.routes.find(r => r.id === routeId);
  if (!route) return;
  state.selectedRoute = route;

  // Update Route details pill
  document.getElementById('lblRouteDistance').textContent = `${route.distanceKm} km`;
  document.getElementById('lblRouteDuration').textContent = route.duration || 'N/A';
  document.getElementById('lblRouteToll').textContent = `₹${route.tollFee || 0}`;

  // Filter buses operating on this route
  const availableBuses = state.buses.filter(b => b.routeId === route.id);
  renderBusCards(availableBuses);

  if (availableBuses.length > 0) {
    selectBus(availableBuses[0].id);
  } else if (state.buses.length > 0) {
    selectBus(state.buses[0].id);
  }
}

function renderBusCards(buses) {
  const container = document.getElementById('busSelectorList');
  if (buses.length === 0) {
    container.innerHTML = `<div class="col-span-2 text-xs text-slate-400 p-2">No buses currently scheduled for this route.</div>`;
    return;
  }

  container.innerHTML = buses.map(bus => {
    const isSelected = state.selectedBus && state.selectedBus.id === bus.id;
    const isAc = bus.isAc;
    const badgeColor = bus.serviceType === 'Airavat Club Class' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                       bus.serviceType === 'EV Power Plus' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                       bus.serviceType === 'Rajahamsa' ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' :
                       'bg-red-500/20 text-red-300 border-red-500/40';

    return `
      <div onclick="selectBus('${bus.id}')" class="cursor-pointer rounded-xl p-3 border transition-all ${
        isSelected ? 'bg-red-950/60 border-amber-500 shadow-md ring-1 ring-amber-500' : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
      }">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-white">${bus.serviceType}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded border font-semibold ${badgeColor}">
            ${isAc ? 'AC Volvo' : 'Express Non-AC'}
          </span>
        </div>
        <div class="flex items-center justify-between mt-2 text-xs text-slate-300">
          <span class="font-mono text-amber-400 font-bold">${bus.busNumber}</span>
          <span class="text-[11px] text-slate-400"><i class="fa-regular fa-clock"></i> ${bus.departureTime}</span>
        </div>
        <div class="mt-1 text-[10px] text-slate-400 flex items-center justify-between">
          <span>${bus.platform}</span>
          <span class="text-emerald-400">${bus.availableSeats !== undefined ? bus.availableSeats : 40} seats left</span>
        </div>
      </div>
    `;
  }).join('');
}

function selectBus(busId) {
  const bus = state.buses.find(b => b.id === busId);
  if (!bus) return;
  state.selectedBus = bus;

  // Clear previously selected seats
  state.selectedSeats = [];

  // Update service tag
  document.getElementById('lblServiceTag').textContent = bus.serviceType;
  
  // Re-render bus cards to update active border
  const availableBuses = state.buses.filter(b => b.routeId === state.selectedRoute.id);
  renderBusCards(availableBuses);

  // Render Seating Map
  renderSeatMap();

  // Recalculate Fare
  recalculateFare();
}

// -------------------------------------------------------------
// PASSENGER MANAGEMENT & CONCESSIONS
// -------------------------------------------------------------
function renderPassengerInputs() {
  const container = document.getElementById('passengerContainer');
  const isSarige = state.selectedBus && state.selectedBus.serviceType === 'Karnataka Sarige';

  container.innerHTML = state.passengers.map((pax, index) => `
    <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2.5">
      <div class="flex items-center justify-between text-xs">
        <span class="font-bold text-amber-300 flex items-center gap-1.5">
          <i class="fa-solid fa-user text-[11px]"></i> Passenger ${index + 1}
        </span>
        ${state.passengers.length > 1 ? `
          <button type="button" onclick="removePassenger(${index})" class="text-red-400 hover:text-red-300 text-xs">
            <i class="fa-solid fa-trash-can"></i> Remove
          </button>
        ` : ''}
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label class="block text-[10px] text-slate-400 mb-0.5">Full Name</label>
          <input type="text" value="${pax.name}" oninput="updatePaxField(${index}, 'name', this.value)" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500">
        </div>
        <div>
          <label class="block text-[10px] text-slate-400 mb-0.5">Age</label>
          <input type="number" min="1" max="100" value="${pax.age}" oninput="updatePaxField(${index}, 'age', Number(this.value))" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500">
        </div>
        <div>
          <label class="block text-[10px] text-slate-400 mb-0.5">Gender</label>
          <select onchange="updatePaxField(${index}, 'gender', this.value)" class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500">
            <option value="Male" ${pax.gender === 'Male' ? 'selected' : ''}>Male</option>
            <option value="Female" ${pax.gender === 'Female' ? 'selected' : ''}>Female</option>
            <option value="Other" ${pax.gender === 'Other' ? 'selected' : ''}>Other</option>
          </select>
        </div>
      </div>

      <!-- Karnataka Domicile & Shakti Scheme Toggle -->
      <div class="pt-1 flex flex-wrap items-center justify-between text-xs gap-2 border-t border-slate-900">
        <label class="flex items-center space-x-2 cursor-pointer text-[11px] text-slate-300">
          <input type="checkbox" ${pax.isKarnatakaResident ? 'checked' : ''} onchange="updatePaxField(${index}, 'isKarnatakaResident', this.checked)" class="rounded bg-slate-900 border-slate-700 text-amber-500 focus:ring-0">
          <span>Karnataka Resident Domicile</span>
        </label>

        ${pax.gender === 'Female' ? `
          <label class="flex items-center space-x-2 cursor-pointer text-[11px] font-bold ${isSarige ? 'text-emerald-400' : 'text-slate-500'}">
            <input type="checkbox" ${pax.isShaktiScheme || (pax.gender === 'Female' && pax.isKarnatakaResident) ? 'checked' : ''} onchange="updatePaxField(${index}, 'isShaktiScheme', this.checked)" ${!isSarige ? 'disabled' : ''} class="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0">
            <span>Shakti Free Scheme ${!isSarige ? '(Non-AC buses only)' : '(₹0 Base Fare)'}</span>
          </label>
        ` : ''}
      </div>
    </div>
  `).join('');

  document.getElementById('lblRequiredSeatsCount').textContent = state.passengers.length;
}

function addPassenger() {
  if (state.passengers.length >= 6) {
    alert('Maximum 6 passengers per booking booking session.');
    return;
  }
  const nextNum = state.passengers.length + 1;
  state.passengers.push({
    name: `Passenger ${nextNum}`,
    age: 28,
    gender: 'Female',
    isKarnatakaResident: true,
    isShaktiScheme: true
  });
  renderPassengerInputs();
  recalculateFare();
}

function removePassenger(index) {
  if (state.passengers.length <= 1) return;
  state.passengers.splice(index, 1);
  if (state.selectedSeats.length > state.passengers.length) {
    state.selectedSeats.pop();
  }
  renderPassengerInputs();
  renderSeatMap();
  recalculateFare();
}

function updatePaxField(index, field, value) {
  if (state.passengers[index]) {
    state.passengers[index][field] = value;
    if (field === 'gender') {
      renderPassengerInputs();
    }
    recalculateFare();
  }
}

// -------------------------------------------------------------
// SEAT SELECTION & 2D BUS MAP
// -------------------------------------------------------------
function renderSeatMap() {
  const grid = document.getElementById('seatMapGrid');
  const bus = state.selectedBus;
  if (!bus) return;

  const total = bus.totalSeats || 40;
  const seatsOccupied = bus.seats || {};
  let html = '';

  const rows = Math.ceil(total / 4);

  for (let r = 1; r <= rows; r++) {
    // 2 seats left, aisle, 2 seats right
    const s1 = `${r}A`;
    const s2 = `${r}B`;
    const s3 = `${r}C`;
    const s4 = `${r}D`;

    [s1, s2, 'AISLE', s3, s4].forEach((seat) => {
      if (seat === 'AISLE') {
        html += `<div class="flex items-center justify-center text-[10px] text-slate-700 font-mono select-none">|</div>`;
        return;
      }

      const occ = seatsOccupied[seat];
      const isBooked = occ && occ.status === 'booked';
      const isBoarded = occ && occ.status === 'boarded';
      const isSelected = state.selectedSeats.includes(seat);

      let btnClass = 'seat-btn h-9 rounded-lg text-xs font-bold flex items-center justify-center transition border ';

      if (isBoarded) {
        btnClass += 'bg-emerald-600 text-white border-emerald-500 cursor-not-allowed';
      } else if (isBooked) {
        btnClass += 'bg-blue-600 text-white border-blue-500 cursor-not-allowed';
      } else if (isSelected) {
        btnClass += 'bg-amber-500 text-slate-950 font-black border-amber-400 shadow-md';
      } else {
        btnClass += 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700';
      }

      const disabledAttr = (isBooked || isBoarded) ? 'disabled' : '';

      html += `
        <button type="button" ${disabledAttr} onclick="toggleSeat('${seat}')" class="${btnClass}">
          ${seat}
        </button>
      `;
    });
  }

  grid.innerHTML = html;
  document.getElementById('lblSelectedSeatsCount').textContent = state.selectedSeats.length;
  document.getElementById('lblAssignedSeats').textContent = state.selectedSeats.length > 0 ? state.selectedSeats.join(', ') : 'None';
}

function toggleSeat(seat) {
  window.transitAudio.playClick();
  const maxSeats = state.passengers.length;
  const idx = state.selectedSeats.indexOf(seat);

  if (idx !== -1) {
    state.selectedSeats.splice(idx, 1);
  } else {
    if (state.selectedSeats.length >= maxSeats) {
      // Replace last seat if limit reached
      state.selectedSeats.pop();
    }
    state.selectedSeats.push(seat);
  }

  renderSeatMap();
}

// -------------------------------------------------------------
// FARE CALCULATION ENGINE (CLIENT CALL)
// -------------------------------------------------------------
async function recalculateFare() {
  if (!state.selectedRoute || !state.selectedBus) return;

  try {
    const res = await fetch('/api/fare/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceType: state.selectedBus.serviceType,
        distanceKm: state.selectedRoute.distanceKm,
        tollFee: state.selectedRoute.tollFee,
        passengers: state.passengers
      })
    });

    const data = await res.json();
    if (data.success) {
      state.fareCalculation = data.fare;
      updateFareDisplay(data.fare);
    }
  } catch (err) {
    console.error('Fare recalculation error:', err);
  }
}

function updateFareDisplay(fare) {
  const totals = fare.totals;
  document.getElementById('lblFareRate').textContent = `₹${fare.ratePerKm} / km`;
  document.getElementById('lblBaseFare').textContent = `₹${totals.baseFare}`;
  document.getElementById('lblAmenityCess').textContent = `₹${totals.amenityCess}`;
  document.getElementById('lblTollCharge').textContent = `₹${totals.tollCharges}`;

  const rowGst = document.getElementById('rowGst');
  if (fare.gstPercent > 0) {
    rowGst.classList.remove('hidden');
    document.getElementById('lblGst').textContent = `₹${totals.gst}`;
  } else {
    rowGst.classList.add('hidden');
  }

  const rowShakti = document.getElementById('rowShaktiDiscount');
  if (totals.totalDiscount > 0) {
    rowShakti.classList.remove('hidden');
    document.getElementById('lblShaktiDiscount').textContent = `- ₹${totals.totalDiscount}`;
  } else {
    rowShakti.classList.add('hidden');
  }

  document.getElementById('lblTotalPayable').textContent = `₹${totals.totalPayable}`;
}

// -------------------------------------------------------------
// TICKET BOOKING & DIGITAL PASS ISSUANCE
// -------------------------------------------------------------
async function handleBookTicket() {
  if (state.selectedSeats.length !== state.passengers.length) {
    alert(`Please select exactly ${state.passengers.length} seat(s) on the seat map.`);
    return;
  }

  const bookBtn = document.getElementById('btnBookTicket');
  bookBtn.disabled = true;
  bookBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Issuing Ticket...</span>`;

  try {
    const res = await fetch('/api/tickets/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        busId: state.selectedBus.id,
        routeId: state.selectedRoute.id,
        passengers: state.passengers,
        selectedSeats: state.selectedSeats
      })
    });

    const data = await res.json();
    if (!data.success) {
      alert(`Booking Failed: ${data.error}`);
      return;
    }

    state.latestBookedTicket = data.ticket;

    // Refresh bus list & seat map to mark seats as booked
    const busesRes = await fetch('/api/buses').then(r => r.json());
    if (busesRes.success) {
      state.buses = busesRes.buses;
      selectBus(state.selectedBus.id);
    }

    // Open Ticket Modal
    openTicketModal(data.ticket);
    window.transitAudio.playGrantedChime();

  } catch (err) {
    console.error('Booking error:', err);
    alert('Failed to connect to ticketing server.');
  } finally {
    bookBtn.disabled = false;
    bookBtn.innerHTML = `<i class="fa-solid fa-ticket-simple text-amber-300 text-base"></i> <span>Book Ticket & Issue Digital Pass</span>`;
  }
}

function openTicketModal(ticket) {
  document.getElementById('modalTicketRoute').textContent = ticket.routeName;
  document.getElementById('modalTicketPnr').textContent = `PNR: ${ticket.pnr}`;
  document.getElementById('modalTicketService').textContent = ticket.serviceType;
  document.getElementById('modalTicketBusNo').textContent = ticket.busNumber;
  document.getElementById('modalTicketTime').textContent = ticket.departureTime;
  document.getElementById('modalTicketSeats').textContent = ticket.selectedSeats.join(', ');
  document.getElementById('modalTicketGate').textContent = `${ticket.gate} (${ticket.platform})`;
  document.getElementById('modalTicketFare').textContent = `₹${ticket.fareBreakdown.totals.totalPayable}`;
  document.getElementById('modalTicketPaxNames').textContent = ticket.passengers.map(p => p.name).join(', ');
  document.getElementById('modalTicketIdLabel').textContent = `ID: ${ticket.ticketId}`;

  // QR Code Image
  document.getElementById('modalQrImage').src = ticket.qrDataUrl;

  // Shakti badge
  const isShakti = ticket.passengers.some(p => p.isShaktiApproved || p.isShaktiScheme);
  const shaktiBadge = document.getElementById('modalShaktiBadge');
  if (isShakti) {
    shaktiBadge.classList.remove('hidden');
  } else {
    shaktiBadge.classList.add('hidden');
  }

  // PDF Download Link
  const pdfBtn = document.getElementById('btnDownloadPdf');
  pdfBtn.href = `/api/tickets/${ticket.ticketId}/pdf`;
  pdfBtn.setAttribute('download', `KSRTC-Ticket-${ticket.ticketId}.pdf`);

  document.getElementById('ticketModal').classList.remove('hidden');
}

function closeTicketModal() {
  document.getElementById('ticketModal').classList.add('hidden');
}

function downloadTicketImage() {
  if (!state.latestBookedTicket) return;
  const link = document.createElement('a');
  link.download = `KSRTC-Pass-${state.latestBookedTicket.pnr}.png`;
  link.href = state.latestBookedTicket.qrDataUrl;
  link.click();
}

function sendTicketToScanner() {
  closeTicketModal();
  switchTab('scanner');
  
  // Set current gate to this ticket's bus so it passes immediately
  if (state.latestBookedTicket) {
    const select = document.getElementById('gateBusSelect');
    select.value = state.latestBookedTicket.busId;
    onGateBusChanged();
  }
}

// -------------------------------------------------------------
// GATE TURNSTILE SIMULATION & QR VERIFICATION
// -------------------------------------------------------------
function populateGateBusSelect() {
  const select = document.getElementById('gateBusSelect');
  select.innerHTML = state.buses.map(b => `
    <option value="${b.id}">${b.gate || 'Gate'}: ${b.busNumber} (${b.routeName.split('->')[1] || b.serviceType})</option>
  `).join('');

  if (state.buses.length > 0) {
    state.currentGateBusId = state.buses[0].id;
    updateGateHeader();
  }
}

function onGateBusChanged() {
  const select = document.getElementById('gateBusSelect');
  state.currentGateBusId = select.value;
  updateGateHeader();
}

function updateGateHeader() {
  const bus = state.buses.find(b => b.id === state.currentGateBusId);
  if (!bus) return;
  const tag = document.getElementById('turnstileGateTag');
  tag.textContent = `${bus.gate || 'GATE'} - BUS ${bus.busNumber}`;
}

async function verifyQrCode(qrData) {
  try {
    const res = await fetch('/api/gate/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qrData,
        gateBusId: state.currentGateBusId
      })
    });

    const data = await res.json();
    if (!data.success) {
      triggerTurnstileUI({
        status: 'DENIED',
        code: 'ERROR',
        message: data.error || 'Server validation error'
      });
      return;
    }

    triggerTurnstileUI(data.result);
    await refreshGateLogs();

    // Also refresh buses in state to update seat occupancies
    const busesRes = await fetch('/api/buses').then(r => r.json());
    if (busesRes.success) {
      state.buses = busesRes.buses;
      if (document.getElementById('tabManifest').classList.contains('hidden') === false) {
        renderManifest();
      }
    }
  } catch (err) {
    console.error('Scan error:', err);
    triggerTurnstileUI({
      status: 'DENIED',
      code: 'NETWORK_ERROR',
      message: 'Failed to communicate with Gate Controller.'
    });
  }
}

function triggerTurnstileUI(result) {
  const display = document.getElementById('turnstileDisplay');
  const badge = document.getElementById('gateStatusBadge');
  const heading = document.getElementById('gateMessageHeading');
  const detail = document.getElementById('gateMessageDetail');
  const paxRow = document.getElementById('gatePaxInfoRow');
  const paxName = document.getElementById('lblGatePaxName');
  const paxSeat = document.getElementById('lblGatePaxSeat');
  const shaktiTag = document.getElementById('lblGatePaxShakti');

  const ledLeft = document.getElementById('ledLeft');
  const ledRight = document.getElementById('ledRight');
  const barrierContainer = document.getElementById('turnstileBarrierContainer');

  if (result.status === 'GRANTED') {
    // ---------------- ACCESS GRANTED ----------------
    window.transitAudio.playGrantedChime();

    // Display Screen Green
    display.className = 'w-full max-w-lg bg-emerald-950/80 border-2 border-emerald-500 rounded-xl p-4 mb-6 shadow-2xl text-center transition-all duration-300';
    badge.className = 'inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black tracking-widest uppercase bg-emerald-500 text-slate-950 border border-emerald-400 shadow-lg';
    badge.innerHTML = `<i class="fa-solid fa-check"></i> ACCESS GRANTED`;

    heading.className = 'text-xl font-black text-emerald-300 mt-2';
    heading.textContent = 'WELCOME ABOARD!';

    detail.className = 'text-xs text-emerald-200 mt-1 max-w-md mx-auto';
    detail.textContent = result.message;

    // Show passenger seat details
    paxRow.classList.remove('hidden');
    paxName.textContent = result.passengerName || 'Passenger';
    paxSeat.textContent = result.seat || '---';

    if (result.isShakti) {
      shaktiTag.classList.remove('hidden');
    } else {
      shaktiTag.classList.add('hidden');
    }

    // LEDs Turn Green
    ledLeft.className = 'w-5 h-5 rounded-full bg-emerald-400 border-2 border-emerald-200 shadow-[0_0_15px_#10b981] mb-2 transition-colors';
    ledRight.className = 'w-5 h-5 rounded-full bg-emerald-400 border-2 border-emerald-200 shadow-[0_0_15px_#10b981] mb-2 transition-colors';

    // Open Motorized Barrier Flaps
    barrierContainer.classList.add('gate-open');

    // Auto-reset turnstile after 3.8 seconds
    setTimeout(() => {
      resetTurnstileUI();
    }, 3800);

  } else {
    // ---------------- ACCESS DENIED ----------------
    window.transitAudio.playDeniedBuzzer();

    // Display Screen Red
    display.className = 'w-full max-w-lg bg-red-950/90 border-2 border-red-500 rounded-xl p-4 mb-6 shadow-2xl text-center transition-all duration-300';
    badge.className = 'inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black tracking-widest uppercase bg-red-600 text-white border border-red-400 shadow-lg animate-bounce';
    badge.innerHTML = `<i class="fa-solid fa-ban"></i> ACCESS DENIED [${result.code || 'BLOCKED'}]`;

    heading.className = 'text-lg font-black text-red-300 mt-2';
    heading.textContent = 'BARRIER ACCESS LOCKED';

    detail.className = 'text-xs text-red-200 mt-1 max-w-md mx-auto font-medium';
    detail.textContent = result.message;

    paxRow.classList.add('hidden');

    // LEDs Turn Flashing Red
    ledLeft.className = 'w-5 h-5 rounded-full bg-red-500 border-2 border-red-200 shadow-[0_0_15px_#ef4444] mb-2 transition-colors animate-pulse';
    ledRight.className = 'w-5 h-5 rounded-full bg-red-500 border-2 border-red-200 shadow-[0_0_15px_#ef4444] mb-2 transition-colors animate-pulse';

    // Flaps stay tightly locked
    barrierContainer.classList.remove('gate-open');

    // Auto-reset turnstile after 4.5 seconds
    setTimeout(() => {
      resetTurnstileUI();
    }, 4500);
  }
}

function resetTurnstileUI() {
  const display = document.getElementById('turnstileDisplay');
  const badge = document.getElementById('gateStatusBadge');
  const heading = document.getElementById('gateMessageHeading');
  const detail = document.getElementById('gateMessageDetail');
  const paxRow = document.getElementById('gatePaxInfoRow');

  const ledLeft = document.getElementById('ledLeft');
  const ledRight = document.getElementById('ledRight');
  const barrierContainer = document.getElementById('turnstileBarrierContainer');

  display.className = 'w-full max-w-lg bg-slate-950 border-2 border-slate-700 rounded-xl p-4 mb-6 shadow-inner text-center transition-all duration-300';
  badge.className = 'inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black tracking-widest uppercase bg-slate-800 text-slate-300 border border-slate-700';
  badge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-slate-400 animate-ping"></span> WAITING FOR TICKET SCAN`;

  heading.className = 'text-lg font-bold text-slate-200 mt-2';
  heading.textContent = 'Please Scan Boarding Pass QR';

  detail.className = 'text-xs text-slate-400 mt-1 max-w-md mx-auto';
  detail.textContent = 'Hold QR code directly beneath scanner or upload pass file.';

  paxRow.classList.add('hidden');

  ledLeft.className = 'w-5 h-5 rounded-full bg-slate-700 border-2 border-slate-900 shadow-md mb-2 transition-colors';
  ledRight.className = 'w-5 h-5 rounded-full bg-slate-700 border-2 border-slate-900 shadow-md mb-2 transition-colors';

  barrierContainer.classList.remove('gate-open');
}

// -------------------------------------------------------------
// INSTANT TEST SCENARIOS (1-CLICK DEMO BUTTONS)
// -------------------------------------------------------------
async function simulateScanLastTicket() {
  if (!state.latestBookedTicket) {
    alert('Please book a ticket first in Tab 1, or book one right now!');
    return;
  }

  // Ensure current gate matches the ticket's bus for successful boarding
  const select = document.getElementById('gateBusSelect');
  select.value = state.latestBookedTicket.busId;
  onGateBusChanged();

  await verifyQrCode(state.latestBookedTicket.qrDataString);
}

async function simulateRescanTicket() {
  if (!state.latestBookedTicket) {
    alert('Please book a ticket first in Tab 1.');
    return;
  }

  // Ensure current gate matches the ticket's bus
  const select = document.getElementById('gateBusSelect');
  select.value = state.latestBookedTicket.busId;
  onGateBusChanged();

  // Re-verify the same ticket to trigger duplicate/already boarded rejection
  await verifyQrCode(state.latestBookedTicket.qrDataString);
}

async function simulateScanWrongBus() {
  if (!state.latestBookedTicket) {
    alert('Please book a ticket first in Tab 1.');
    return;
  }

  // Find a DIFFERENT bus than the ticket's bus
  const otherBus = state.buses.find(b => b.id !== state.latestBookedTicket.busId);
  if (!otherBus) {
    alert('No other bus found to test wrong gate.');
    return;
  }

  // Switch gate to the OTHER bus
  const select = document.getElementById('gateBusSelect');
  select.value = otherBus.id;
  onGateBusChanged();

  // Scan ticket -> should trigger WRONG_BUS access denied
  await verifyQrCode(state.latestBookedTicket.qrDataString);
}

async function simulateScanFakeQr() {
  const fakePayload = JSON.stringify({
    ticketId: 'KA-KSRTC-2026-FAKE999',
    pnr: 'FAKE000',
    busId: state.currentGateBusId,
    seats: ['99Z'],
    sig: 'invalid_forged_hash_key'
  });

  await verifyQrCode(fakePayload);
}

function handleManualVerify() {
  const input = document.getElementById('manualTicketInput');
  const val = input.value.trim();
  if (!val) return;
  verifyQrCode(val);
  input.value = '';
}

// -------------------------------------------------------------
// CAMERA SCANNER & FILE SCANNER
// -------------------------------------------------------------
async function toggleCameraScanner() {
  const btn = document.getElementById('btnStartCamera');
  const label = document.getElementById('cameraBtnLabel');
  const placeholder = document.getElementById('scannerPlaceholder');

  if (state.isCameraRunning) {
    // Stop camera
    if (state.html5QrScanner) {
      await state.html5QrScanner.stop();
      state.html5QrScanner.clear();
      state.html5QrScanner = null;
    }
    state.isCameraRunning = false;
    label.textContent = 'Start Camera';
    placeholder.classList.remove('hidden');
  } else {
    // Start camera
    try {
      placeholder.classList.add('hidden');
      state.html5QrScanner = new Html5Qrcode('qrReader');
      
      await state.html5QrScanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 220, height: 220 }
        },
        (decodedText) => {
          verifyQrCode(decodedText);
        },
        (errorMessage) => {
          // Continuous scanning silently handles frames
        }
      );

      state.isCameraRunning = true;
      label.textContent = 'Stop Camera';
    } catch (err) {
      console.warn('Camera could not be accessed directly:', err);
      alert('Camera access could not be initialized or permission was denied. You can use the File Upload or 1-Click Simulation buttons instead!');
      placeholder.classList.remove('hidden');
      state.isCameraRunning = false;
      label.textContent = 'Start Camera';
    }
  }
}

async function handleFileScan() {
  const fileInput = document.getElementById('ticketFileInput');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please select a ticket image or PDF file to scan.');
    return;
  }

  const file = fileInput.files[0];
  try {
    const html5QrCode = new Html5Qrcode('qrReader');
    const decodedText = await html5QrCode.scanFile(file, true);
    html5QrCode.clear();
    await verifyQrCode(decodedText);
  } catch (err) {
    // Fallback: If it's a PDF or unrecognized format, check if we can match by latest ticket
    if (state.latestBookedTicket) {
      await verifyQrCode(state.latestBookedTicket.qrDataString);
    } else {
      alert('Could not decode QR code from the selected file. Please use a PNG/JPG QR image or test using the 1-Click buttons.');
    }
  }
}

// -------------------------------------------------------------
// CONDUCTOR SEATING MANIFEST & SECURITY LOGS
// -------------------------------------------------------------
function populateManifestBusSelect() {
  const select = document.getElementById('manifestBusSelect');
  select.innerHTML = state.buses.map(b => `
    <option value="${b.id}">${b.busNumber} - ${b.serviceType} (${b.routeName.split('->')[0]} to ${b.routeName.split('->')[1] || ''})</option>
  `).join('');
}

function renderManifest() {
  const select = document.getElementById('manifestBusSelect');
  const busId = select.value || (state.buses[0] && state.buses[0].id);
  const bus = state.buses.find(b => b.id === busId);
  if (!bus) return;

  document.getElementById('lblManifestBusTitle').textContent = bus.busNumber;
  document.getElementById('lblManifestBusSubtitle').textContent = `${bus.serviceType} | ${bus.routeName}`;

  const seats = bus.seats || {};
  const total = bus.totalSeats || 40;
  let bookedCount = 0;
  let boardedCount = 0;

  Object.values(seats).forEach(s => {
    if (s.status === 'booked') bookedCount++;
    if (s.status === 'boarded') {
      bookedCount++;
      boardedCount++;
    }
  });

  document.getElementById('lblManifestBoardedRatio').textContent = `${boardedCount} / ${total}`;
  const pct = Math.round((boardedCount / total) * 100);
  document.getElementById('manifestProgressBar').style.width = `${pct}%`;

  // Render Seating visualizer
  const grid = document.getElementById('manifestSeatGrid');
  let html = '';
  const rows = Math.ceil(total / 4);

  for (let r = 1; r <= rows; r++) {
    const s1 = `${r}A`;
    const s2 = `${r}B`;
    const s3 = `${r}C`;
    const s4 = `${r}D`;

    [s1, s2, 'AISLE', s3, s4].forEach((seat) => {
      if (seat === 'AISLE') {
        html += `<div class="flex items-center justify-center text-[9px] text-slate-700 font-mono select-none">|</div>`;
        return;
      }

      const occ = seats[seat];
      let bg = 'bg-slate-800 text-slate-400 border-slate-700'; // Available
      let title = `Seat ${seat}: Available`;

      if (occ) {
        if (occ.status === 'boarded') {
          bg = 'bg-emerald-600 text-white border-emerald-400 font-bold';
          title = `Seat ${seat}: BOARDED (${occ.passengerName || ''})`;
        } else if (occ.status === 'booked') {
          bg = 'bg-blue-600 text-white border-blue-400 font-bold';
          title = `Seat ${seat}: BOOKED (${occ.passengerName || ''})`;
        }
      }

      html += `
        <div title="${title}" class="h-8 rounded text-[11px] flex items-center justify-center border transition ${bg}">
          ${seat}
        </div>
      `;
    });
  }
  grid.innerHTML = html;

  // Render Passenger Table
  const tbody = document.getElementById('manifestTableBody');
  const seatEntries = Object.entries(seats);

  if (seatEntries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500">No passengers booked on this bus yet.</td></tr>`;
    document.getElementById('lblManifestPaxCount').textContent = '0 passengers registered';
    return;
  }

  document.getElementById('lblManifestPaxCount').textContent = `${seatEntries.length} passengers booked (${boardedCount} boarded)`;

  tbody.innerHTML = seatEntries.map(([seatNum, s]) => {
    const isBoarded = s.status === 'boarded';
    return `
      <tr class="hover:bg-slate-900/50">
        <td class="py-2.5 px-3 font-bold text-amber-400">${seatNum}</td>
        <td class="py-2.5 px-3 font-semibold text-white">${s.passengerName || 'Passenger'}</td>
        <td class="py-2.5 px-3 text-slate-400 font-mono">Adult</td>
        <td class="py-2.5 px-3 text-slate-400 font-mono">${s.ticketId || s.pnr || '---'}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            isBoarded ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : 'bg-blue-950 text-blue-300 border border-blue-600'
          }">
            ${isBoarded ? 'BOARDED' : 'BOOKED (NOT BOARDED)'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

async function refreshGateLogs() {
  try {
    const res = await fetch('/api/gate/logs').then(r => r.json());
    if (!res.success) return;

    const logs = res.logs || [];
    
    // Update live gate feed in Tab 2
    const feed = document.getElementById('recentGateFeed');
    if (logs.length === 0) {
      feed.innerHTML = `<div class="text-[11px] text-slate-500">No scan activity recorded yet.</div>`;
    } else {
      feed.innerHTML = logs.slice(0, 5).map(log => {
        const isGranted = log.status === 'GRANTED';
        return `
          <div class="p-2 rounded-lg border ${isGranted ? 'bg-emerald-950/40 border-emerald-800/40' : 'bg-red-950/40 border-red-800/40'} flex items-center justify-between">
            <div>
              <span class="font-bold ${isGranted ? 'text-emerald-400' : 'text-red-400'}">${log.status}:</span>
              <span class="text-slate-300 text-[11px] ml-1">${log.passengerName || log.code || 'Scan'}</span>
            </div>
            <span class="text-[10px] text-slate-500 font-mono">${new Date(log.timestamp).toLocaleTimeString()}</span>
          </div>
        `;
      }).join('');
    }

    // Update Security Audit Log table in Tab 3
    const auditTbody = document.getElementById('auditLogTableBody');
    if (logs.length === 0) {
      auditTbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500">No gate activity logs found.</td></tr>`;
      return;
    }

    auditTbody.innerHTML = logs.map(log => {
      const isGranted = log.status === 'GRANTED';
      return `
        <tr class="hover:bg-slate-900/60">
          <td class="py-2 px-3 text-slate-400 text-[11px]">${new Date(log.timestamp).toLocaleTimeString()}</td>
          <td class="py-2 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
              isGranted ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : 'bg-red-950 text-red-300 border border-red-600'
            }">
              ${log.status}
            </span>
          </td>
          <td class="py-2 px-3 text-slate-300">${log.ticketId || log.pnr || '---'}</td>
          <td class="py-2 px-3 text-slate-300">${log.passengerName ? log.passengerName + (log.seat ? ` (${log.seat})` : '') : '---'}</td>
          <td class="py-2 px-3 text-[11px] ${isGranted ? 'text-emerald-400' : 'text-red-300'} font-sans">${log.message}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to refresh gate logs:', err);
  }
}

