// GS1 reserves the "20"-"29" EAN-13 prefix range for internal/in-store use
// (the same range supermarket scales use for weight-embedded barcodes), so
// codes generated here can never collide with a real manufacturer barcode.
const INTERNAL_PREFIX = '20';

function checkDigit(twelveDigits) {
  const sum = twelveDigits
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

function randomEan13() {
  const body = INTERNAL_PREFIX + String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
  return body + checkDigit(body);
}

module.exports = { randomEan13 };
