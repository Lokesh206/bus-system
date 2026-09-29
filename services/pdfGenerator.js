const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Generates an official printable Karnataka Bus E-Ticket PDF with embedded QR Code.
 * 
 * @param {Object} ticket - Full ticket details with qrDataUrl
 * @returns {Promise<Uint8Array>} Raw PDF bytes
 */
async function generateTicketPdf(ticket) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // Standard A4 (Points)
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Color Palette (KSRTC Crimson Red, Gold, Slate)
  const primaryRed = rgb(0.78, 0.12, 0.15); // Crimson
  const darkRed = rgb(0.55, 0.05, 0.08);
  const gold = rgb(0.85, 0.65, 0.13);
  const slateDark = rgb(0.12, 0.16, 0.22);
  const slateGray = rgb(0.40, 0.45, 0.50);
  const bgLight = rgb(0.96, 0.97, 0.98);
  const cardBorder = rgb(0.88, 0.90, 0.94);
  const white = rgb(1, 1, 1);
  const green = rgb(0.08, 0.60, 0.28);

  // Top Header Bar
  page.drawRectangle({
    x: 0,
    y: height - 90,
    width,
    height: 90,
    color: primaryRed
  });

  // Gold accent line
  page.drawRectangle({
    x: 0,
    y: height - 94,
    width,
    height: 4,
    color: gold
  });

  // Header Title
  page.drawText('KARNATAKA STATE ROAD TRANSPORT CORPORATION', {
    x: 40,
    y: height - 42,
    size: 16,
    font: fontBold,
    color: white
  });

  page.drawText('GOVERNMENT OF KARNATAKA | DIGITAL BOARDING PASS', {
    x: 40,
    y: height - 62,
    size: 9,
    font: fontRegular,
    color: rgb(0.95, 0.95, 0.95)
  });

  page.drawText('KSRTC / BMTC SMART TRANSIT', {
    x: width - 200,
    y: height - 52,
    size: 10,
    font: fontBold,
    color: gold
  });

  // Ticket Container Box
  const boxX = 35;
  let currentY = height - 120;

  // Primary Highlights Bar (PNR & Ticket ID)
  page.drawRectangle({
    x: boxX,
    y: currentY - 50,
    width: width - 70,
    height: 50,
    color: bgLight,
    borderColor: cardBorder,
    borderWidth: 1
  });

  page.drawText('PNR NUMBER', { x: boxX + 15, y: currentY - 20, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.pnr || 'N/A', { x: boxX + 15, y: currentY - 38, size: 14, font: fontBold, color: primaryRed });

  page.drawText('TICKET ID', { x: boxX + 160, y: currentY - 20, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.ticketId || 'N/A', { x: boxX + 160, y: currentY - 38, size: 12, font: fontBold, color: slateDark });

  page.drawText('BOOKING STATUS', { x: boxX + 340, y: currentY - 20, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.status === 'BOARDED' ? 'COMPLETED (BOARDED)' : 'CONFIRMED (ACTIVE)', {
    x: boxX + 340,
    y: currentY - 38,
    size: 11,
    font: fontBold,
    color: green
  });

  currentY -= 75;

  // Journey & Bus Details Section
  page.drawText('JOURNEY & VEHICLE DETAILS', { x: boxX, y: currentY, size: 11, font: fontBold, color: darkRed });
  currentY -= 8;
  page.drawLine({
    start: { x: boxX, y: currentY },
    end: { x: width - boxX, y: currentY },
    thickness: 1,
    color: cardBorder
  });
  currentY -= 18;

  // Route Info
  page.drawText('ROUTE:', { x: boxX, y: currentY, size: 9, font: fontBold, color: slateGray });
  page.drawText(`${ticket.routeName || ticket.source + ' to ' + ticket.destination}`, {
    x: boxX + 60,
    y: currentY,
    size: 11,
    font: fontBold,
    color: slateDark
  });
  currentY -= 20;

  const col1 = boxX;
  const col2 = boxX + 180;
  const col3 = boxX + 360;

  // Service Type, Bus Reg No, Departure
  page.drawText('SERVICE TYPE', { x: col1, y: currentY, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.serviceType || 'Karnataka Sarige', { x: col1, y: currentY - 14, size: 10, font: fontBold, color: slateDark });

  page.drawText('BUS REGISTRATION', { x: col2, y: currentY, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.busNumber || 'KA-01-F-XXXX', { x: col2, y: currentY - 14, size: 10, font: fontBold, color: primaryRed });

  page.drawText('DEPARTURE TIME', { x: col3, y: currentY, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.departureTime || 'Schedule Pending', { x: col3, y: currentY - 14, size: 10, font: fontBold, color: slateDark });

  currentY -= 36;

  page.drawText('BOARDING PLATFORM', { x: col1, y: currentY, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.platform || 'Platform Assigned on Arrival', { x: col1, y: currentY - 14, size: 10, font: fontBold, color: slateDark });

  page.drawText('GATE NUMBER', { x: col2, y: currentY, size: 8, font: fontBold, color: slateGray });
  page.drawText(ticket.gate || 'Gate G1', { x: col2, y: currentY - 14, size: 10, font: fontBold, color: slateDark });

  page.drawText('TOTAL DISTANCE', { x: col3, y: currentY, size: 8, font: fontBold, color: slateGray });
  page.drawText(`${ticket.distanceKm || 0} Kilometers`, { x: col3, y: currentY - 14, size: 10, font: fontBold, color: slateDark });

  currentY -= 40;

  // Passengers Table
  page.drawText('PASSENGER & SEAT ASSIGNMENT', { x: boxX, y: currentY, size: 11, font: fontBold, color: darkRed });
  currentY -= 8;
  page.drawLine({
    start: { x: boxX, y: currentY },
    end: { x: width - boxX, y: currentY },
    thickness: 1,
    color: cardBorder
  });
  currentY -= 18;

  // Table Header
  page.drawRectangle({
    x: boxX,
    y: currentY - 5,
    width: width - 70,
    height: 20,
    color: rgb(0.92, 0.94, 0.97)
  });

  page.drawText('No.', { x: boxX + 8, y: currentY, size: 8, font: fontBold, color: slateDark });
  page.drawText('Passenger Name', { x: boxX + 40, y: currentY, size: 8, font: fontBold, color: slateDark });
  page.drawText('Age / Gender', { x: boxX + 220, y: currentY, size: 8, font: fontBold, color: slateDark });
  page.drawText('Seat No', { x: boxX + 320, y: currentY, size: 8, font: fontBold, color: slateDark });
  page.drawText('Scheme / Concession', { x: boxX + 400, y: currentY, size: 8, font: fontBold, color: slateDark });

  currentY -= 22;

  ticket.passengers.forEach((pax, index) => {
    const seat = ticket.selectedSeats[index] || 'Auto';
    const isShakti = pax.isShaktiApproved || (pax.gender === 'Female' && pax.isKarnatakaResident);

    page.drawText(`${index + 1}`, { x: boxX + 8, y: currentY, size: 9, font: fontRegular, color: slateDark });
    page.drawText(pax.name, { x: boxX + 40, y: currentY, size: 9, font: fontBold, color: slateDark });
    page.drawText(`${pax.age} yrs / ${pax.gender}`, { x: boxX + 220, y: currentY, size: 9, font: fontRegular, color: slateDark });
    page.drawText(seat, { x: boxX + 320, y: currentY, size: 10, font: fontBold, color: primaryRed });
    page.drawText(isShakti ? 'Shakti Scheme (Free)' : 'Standard Regular', {
      x: boxX + 400,
      y: currentY,
      size: 9,
      font: fontBold,
      color: isShakti ? green : slateGray
    });

    currentY -= 18;
  });

  currentY -= 15;

  // Fare Breakdown & QR Code Section (Split Columns)
  page.drawText('FARE COMPUTATION & GATE SCANNER QR', { x: boxX, y: currentY, size: 11, font: fontBold, color: darkRed });
  currentY -= 8;
  page.drawLine({
    start: { x: boxX, y: currentY },
    end: { x: width - boxX, y: currentY },
    thickness: 1,
    color: cardBorder
  });
  currentY -= 20;

  // Left Column: Fare Table
  const totals = ticket.fareBreakdown ? ticket.fareBreakdown.totals : { totalPayable: 0 };
  const fareX = boxX;
  let fareY = currentY;

  function drawFareRow(label, amount, isTotal = false) {
    page.drawText(label, {
      x: fareX,
      y: fareY,
      size: isTotal ? 11 : 9,
      font: isTotal ? fontBold : fontRegular,
      color: isTotal ? primaryRed : slateDark
    });
    page.drawText(`INR ${amount}`, {
      x: fareX + 180,
      y: fareY,
      size: isTotal ? 12 : 9,
      font: isTotal ? fontBold : fontRegular,
      color: isTotal ? primaryRed : slateDark
    });
    fareY -= 18;
  }

  drawFareRow('Basic Distance Fare:', totals.baseFare || 0);
  drawFareRow('Passenger Amenity Cess:', totals.amenityCess || 0);
  drawFareRow('Toll Highway Surcharges:', totals.tollCharges || 0);
  if (totals.gst > 0) {
    drawFareRow('GST (5% AC Service):', totals.gst);
  }
  if (totals.totalDiscount > 0) {
    page.drawText('Karnataka Shakti Subsidy:', { x: fareX, y: fareY, size: 9, font: fontBold, color: green });
    page.drawText(`- INR ${totals.totalDiscount}`, { x: fareX + 180, y: fareY, size: 9, font: fontBold, color: green });
    fareY -= 18;
  }

  page.drawLine({
    start: { x: fareX, y: fareY + 5 },
    end: { x: fareX + 260, y: fareY + 5 },
    thickness: 1,
    color: cardBorder
  });
  fareY -= 8;
  drawFareRow('TOTAL AMOUNT PAID:', totals.totalPayable, true);

  // Right Column: Embed Scannable QR Code
  if (ticket.qrDataUrl) {
    try {
      const qrBase64 = ticket.qrDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const qrImageBytes = Buffer.from(qrBase64, 'base64');
      const embeddedQr = await pdfDoc.embedPng(qrImageBytes);

      const qrSize = 135;
      const qrX = width - boxX - qrSize - 10;
      const qrY = currentY - qrSize + 10;

      // Draw QR border frame
      page.drawRectangle({
        x: qrX - 5,
        y: qrY - 5,
        width: qrSize + 10,
        height: qrSize + 10,
        color: white,
        borderColor: primaryRed,
        borderWidth: 2
      });

      page.drawImage(embeddedQr, {
        x: qrX,
        y: qrY,
        width: qrSize,
        height: qrSize
      });

      page.drawText('SCAN AT BOARDING GATE', {
        x: qrX + 5,
        y: qrY - 18,
        size: 8,
        font: fontBold,
        color: primaryRed
      });
    } catch (e) {
      console.error('Failed to embed QR code in PDF:', e);
    }
  }

  // Bottom Security & Instructions Bar
  const footerY = 70;
  page.drawRectangle({
    x: boxX,
    y: footerY,
    width: width - 70,
    height: 55,
    color: bgLight,
    borderColor: cardBorder,
    borderWidth: 1
  });

  page.drawText('AUTOMATED GATE SCANNING INSTRUCTIONS:', {
    x: boxX + 12,
    y: footerY + 38,
    size: 8,
    font: fontBold,
    color: darkRed
  });

  page.drawText('1. Present the QR code on your mobile or printed pass directly beneath the bus turnstile scanner.', {
    x: boxX + 12,
    y: footerY + 24,
    size: 7.5,
    font: fontRegular,
    color: slateDark
  });

  page.drawText('2. A single scan admits one passenger. For group bookings, scan once per passenger until quota is checked in.', {
    x: boxX + 12,
    y: footerY + 13,
    size: 7.5,
    font: fontRegular,
    color: slateDark
  });

  page.drawText('3. Digital signature is cryptographically verified. Re-entry, screenshot sharing, or duplicate scans will be DENIED.', {
    x: boxX + 12,
    y: footerY + 2,
    size: 7.5,
    font: fontOblique,
    color: slateGray
  });

  return await pdfDoc.save();
}

module.exports = {
  generateTicketPdf
};

