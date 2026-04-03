/**
 * KRKAI — Room Image Thumbnail Generator
 *
 * Generates three sets of thumbnails per room:
 *   images/rooms/{room}/thumbs/{n}.avif     — 600px wide, desktop (primary)
 *   images/rooms/{room}/thumbs/{n}.webp     — 600px wide, desktop (fallback)
 *   images/rooms/{room}/thumbs-sm/{n}.avif  — 360px wide, mobile (primary)
 *   images/rooms/{room}/thumbs-sm/{n}.webp  — 360px wide, mobile (fallback)
 *   images/rooms/{room}/lqip.json           — tiny 20px base64 placeholders
 *
 * Skips files that already exist (safe to re-run).
 * Pass --force to regenerate all files regardless.
 *
 * Usage:
 *   npm install sharp --save-dev
 *   node scripts/resize-images.js
 *   node scripts/resize-images.js --force
 */

'use strict';

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');

const FORCE     = process.argv.includes('--force');
const ROOMS_DIR = path.join(__dirname, '..', 'images', 'rooms');

const SIZES = [
  { dir: 'thumbs',    width: 600, avifQuality: 70, webpQuality: 80 },
  { dir: 'thumbs-sm', width: 360, avifQuality: 65, webpQuality: 75 }
];

const LQIP_WIDTH   = 20;
const LQIP_QUALITY = 40;

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
  const lqipData = {};

  for (const num of [...numbers].sort((a, b) => a - b)) {
    // Pick best source: prefer .webp (already compressed), fall back to .jpg
    let src = null;
    for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
      const candidate = path.join(roomPath, `${num}.${ext}`);
      if (fs.existsSync(candidate)) { src = candidate; break; }
    }
    if (!src) continue;

    for (const size of SIZES) {
      // AVIF (primary — smaller files, better quality at same size)
      const destAvif = path.join(roomPath, size.dir, `${num}.avif`);
      if (FORCE || !fs.existsSync(destAvif)) {
        try {
          await sharp(src)
            .rotate()
            .resize({ width: size.width, withoutEnlargement: true })
            .avif({ quality: size.avifQuality, effort: 4 })
            .toFile(destAvif);
          processed++;
        } catch (err) {
          console.error(`  [${roomName}] AVIF ERROR on ${num} (${size.dir}):`, err.message);
        }
      } else {
        skipped++;
      }

      // WebP (fallback — for browsers without AVIF support, ~97% have WebP)
      const destWebp = path.join(roomPath, size.dir, `${num}.webp`);
      if (FORCE || !fs.existsSync(destWebp)) {
        try {
          await sharp(src)
            .rotate()
            .resize({ width: size.width, withoutEnlargement: true })
            .webp({ quality: size.webpQuality, effort: 4 })
            .toFile(destWebp);
          processed++;
        } catch (err) {
          console.error(`  [${roomName}] WebP ERROR on ${num} (${size.dir}):`, err.message);
        }
      } else {
        skipped++;
      }
    }

    // LQIP — tiny 20px WebP encoded as base64, used as blur-up placeholder in Three.js
    const lqipPath = path.join(roomPath, 'lqip', `${num}.webp`);
    const lqipDir  = path.join(roomPath, 'lqip');
    if (!fs.existsSync(lqipDir)) fs.mkdirSync(lqipDir, { recursive: true });

    if (FORCE || !fs.existsSync(lqipPath)) {
      try {
        await sharp(src)
          .rotate()
          .resize({ width: LQIP_WIDTH, withoutEnlargement: true })
          .blur(2)
          .webp({ quality: LQIP_QUALITY })
          .toFile(lqipPath);
      } catch (err) {
        console.error(`  [${roomName}] LQIP ERROR on ${num}:`, err.message);
      }
    }

    // Read LQIP as base64 for the JSON manifest
    if (fs.existsSync(lqipPath)) {
      const buf = fs.readFileSync(lqipPath);
      lqipData[String(num)] = 'data:image/webp;base64,' + buf.toString('base64');
    }
  }

  // Write lqip.json — used by rooms.js to show blurry placeholder before full thumb loads
  const lqipJsonPath = path.join(roomPath, 'lqip.json');
  fs.writeFileSync(lqipJsonPath, JSON.stringify(lqipData));
  console.log(`  [${roomName}] ${[...numbers].length} photos — ${processed} generated, ${skipped} skipped, lqip.json written`);
}

async function main() {
  console.log('KRKAI thumbnail generator (AVIF + WebP + LQIP)');
  console.log('Rooms dir:', ROOMS_DIR);
  if (FORCE) console.log('Mode: --force (regenerating all files)');
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
  console.log('Done. Deploy the images/rooms/*/thumbs/ and */lqip.json files with your site.');
}

main().catch(function(err) {
  console.error('Fatal:', err);
  process.exit(1);
});
