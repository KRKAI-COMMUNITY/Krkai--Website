/**
 * KRKAI — Room Image Thumbnail Generator
 *
 * Generates two sets of resized WebP thumbnails for each room:
 *   images/rooms/{room}/thumbs/{n}.webp     — 800px wide, desktop
 *   images/rooms/{room}/thumbs-sm/{n}.webp  — 480px wide, mobile
 *
 * Skips files that already exist (safe to re-run).
 *
 * Usage:
 *   npm install sharp --save-dev
 *   node scripts/resize-images.js
 */

'use strict';

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

const ROOMS_DIR = path.join(__dirname, '..', 'images', 'rooms');

const SIZES = [
  { dir: 'thumbs',    width: 800, quality: 82 },
  { dir: 'thumbs-sm', width: 480, quality: 75 }
];

async function processRoom(roomPath, roomName) {
  const entries = fs.readdirSync(roomPath);

  // Collect unique photo numbers that have a source image (prefer .webp over .jpg)
  const numbers = new Set();
  for (const f of entries) {
    const m = f.match(/^(\d+)\.(jpg|jpeg|webp|png)$/i);
    if (m) numbers.add(parseInt(m[1], 10));
  }

  if (numbers.size === 0) {
    console.log(`  [${roomName}] No images found — skipping`);
    return;
  }

  for (const size of SIZES) {
    const outDir = path.join(roomPath, size.dir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  }

  let processed = 0;
  let skipped   = 0;

  for (const num of [...numbers].sort((a, b) => a - b)) {
    // Pick best source: prefer .webp (already compressed), fall back to .jpg
    let src = null;
    for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
      const candidate = path.join(roomPath, `${num}.${ext}`);
      if (fs.existsSync(candidate)) { src = candidate; break; }
    }
    if (!src) continue;

    for (const size of SIZES) {
      const dest = path.join(roomPath, size.dir, `${num}.webp`);
      if (fs.existsSync(dest)) { skipped++; continue; }

      try {
        await sharp(src)
          .rotate()                          // auto-rotate from EXIF (phone photos)
          .resize({ width: size.width, withoutEnlargement: true })
          .webp({ quality: size.quality, effort: 4 })
          .toFile(dest);
        processed++;
      } catch (err) {
        console.error(`  [${roomName}] ERROR on ${num}.webp (${size.dir}):`, err.message);
      }
    }
  }

  console.log(`  [${roomName}] ${[...numbers].length} photos — ${processed} generated, ${skipped} already existed`);
}

async function main() {
  console.log('KRKAI thumbnail generator');
  console.log('Rooms dir:', ROOMS_DIR);
  console.log('');

  const rooms = fs.readdirSync(ROOMS_DIR).filter(function(name) {
    return fs.statSync(path.join(ROOMS_DIR, name)).isDirectory();
  });

  for (const room of rooms) {
    const roomPath = path.join(ROOMS_DIR, room);
    console.log(`Processing: ${room}`);
    await processRoom(roomPath, room);
  }

  console.log('');
  console.log('Done. Deploy the images/rooms/*/thumbs/ folders with your site.');
}

main().catch(function(err) {
  console.error('Fatal:', err);
  process.exit(1);
});
