/**
 * Node.js Icon Generator - Wallapop Tools v3.0
 *
 * Generates 16x16, 48x48, and 128x128 PNG icons using the canvas package.
 * Replicates the drawing logic from scripts/generate-icons.html.
 *
 * Usage: node scripts/generate-icons.js
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 48, 128];
const BG_COLOR = '#6366F1';
const ROCKET_COLOR = '#ffffff';
const FLAME_COLOR = '#FBBF24';
const CORNER_RATIO = 0.22;
const ICONS_DIR = path.resolve(__dirname, '..', 'icons');

function drawSquircle(ctx, size) {
  const r = size * CORNER_RATIO;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = BG_COLOR;
  ctx.fill();
}

function drawRocket16(ctx) {
  ctx.save();
  ctx.translate(8, 8);
  ctx.rotate(-Math.PI / 4);

  // Body
  ctx.fillStyle = ROCKET_COLOR;
  ctx.beginPath();
  ctx.ellipse(0, -1, 2.2, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose cone
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(-1.5, -3.5);
  ctx.lineTo(1.5, -3.5);
  ctx.closePath();
  ctx.fill();

  // Flame
  ctx.fillStyle = FLAME_COLOR;
  ctx.beginPath();
  ctx.moveTo(-1.2, 3.5);
  ctx.quadraticCurveTo(0, 6.5, 1.2, 3.5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawRocket(ctx, size) {
  const s = size / 128;
  ctx.save();
  ctx.translate(size * 0.48, size * 0.52);
  ctx.rotate(-Math.PI / 4);

  // Rocket body
  ctx.fillStyle = ROCKET_COLOR;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16 * s, 36 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nose cone
  ctx.beginPath();
  ctx.moveTo(0, -42 * s);
  ctx.bezierCurveTo(-10 * s, -32 * s, -14 * s, -22 * s, -14 * s, -12 * s);
  ctx.lineTo(14 * s, -12 * s);
  ctx.bezierCurveTo(14 * s, -22 * s, 10 * s, -32 * s, 0, -42 * s);
  ctx.closePath();
  ctx.fill();

  // Window (porthole)
  ctx.fillStyle = BG_COLOR;
  ctx.beginPath();
  ctx.arc(0, -10 * s, 6 * s, 0, Math.PI * 2);
  ctx.fill();

  // Window highlight
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(-1.5 * s, -12 * s, 2.5 * s, 0, Math.PI * 2);
  ctx.fill();

  // Fins
  ctx.fillStyle = ROCKET_COLOR;

  // Left fin
  ctx.beginPath();
  ctx.moveTo(-14 * s, 18 * s);
  ctx.quadraticCurveTo(-28 * s, 28 * s, -24 * s, 38 * s);
  ctx.lineTo(-12 * s, 30 * s);
  ctx.closePath();
  ctx.fill();

  // Right fin
  ctx.beginPath();
  ctx.moveTo(14 * s, 18 * s);
  ctx.quadraticCurveTo(28 * s, 28 * s, 24 * s, 38 * s);
  ctx.lineTo(12 * s, 30 * s);
  ctx.closePath();
  ctx.fill();

  // Flame / exhaust
  const flameGrad = ctx.createLinearGradient(0, 30 * s, 0, 52 * s);
  flameGrad.addColorStop(0, FLAME_COLOR);
  flameGrad.addColorStop(0.6, '#F59E0B');
  flameGrad.addColorStop(1, 'rgba(245,158,11,0)');
  ctx.fillStyle = flameGrad;

  // Center flame
  ctx.beginPath();
  ctx.moveTo(-8 * s, 30 * s);
  ctx.quadraticCurveTo(0, 55 * s, 8 * s, 30 * s);
  ctx.closePath();
  ctx.fill();

  // Outer flame glow
  ctx.fillStyle = 'rgba(251,191,36,0.3)';
  ctx.beginPath();
  ctx.moveTo(-12 * s, 28 * s);
  ctx.quadraticCurveTo(0, 60 * s, 12 * s, 28 * s);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Background squircle
  drawSquircle(ctx, size);

  // Clip to squircle
  ctx.save();
  const r = size * CORNER_RATIO;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();

  if (size <= 16) {
    drawRocket16(ctx);
  } else {
    drawRocket(ctx, size);
  }

  ctx.restore();
  return canvas;
}

// Ensure icons directory exists
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

for (const size of SIZES) {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer('image/png');
  const filePath = path.join(ICONS_DIR, `icon${size}.png`);
  fs.writeFileSync(filePath, buffer);
  console.log(`Generated ${filePath} (${buffer.length} bytes)`);
}

console.log('Done! All icons generated.');
