/**
 * KRKAI — JS Minification Build Script
 *
 * Minifies all js/*.js files → dist/js/*.js using Terser.
 * Saves 30-50% on JS payload for slow connections.
 *
 * Usage:
 *   npm install --save-dev terser
 *   npm run build
 *
 * After running:
 *   - Serve from dist/ in production (update index.html script paths)
 *   - Keep js/ as source of truth for development
 *
 * In development, index.html can point to js/ directly.
 * For deployment, update script tags to point to dist/js/.
 */

'use strict';

const { minify } = require('terser');
const fs         = require('fs');
const path       = require('path');

const SRC_DIR  = path.join(__dirname, '..', 'js');
const DIST_DIR = path.join(__dirname, '..', 'dist', 'js');

const TERSER_OPTIONS = {
  compress: {
    drop_console: false,       // keep console.log for debugging (set true for production)
    passes: 2,
    dead_code: true,
    unused: true
  },
  mangle: true,
  format: {
    comments: false            // strip all comments
  }
};

async function main() {
  if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR).filter(function(f) {
    return f.endsWith('.js') && !f.endsWith('.min.js');
  });

  let totalOriginal = 0;
  let totalMinified = 0;

  console.log('KRKAI JS Build\n');

  for (const file of files) {
    const srcPath  = path.join(SRC_DIR, file);
    const distPath = path.join(DIST_DIR, file);
    const source   = fs.readFileSync(srcPath, 'utf8');

    try {
      const result = await minify(source, TERSER_OPTIONS);
      fs.writeFileSync(distPath, result.code, 'utf8');

      const origSize = Buffer.byteLength(source, 'utf8');
      const minSize  = Buffer.byteLength(result.code, 'utf8');
      const savings  = Math.round((1 - minSize / origSize) * 100);

      totalOriginal += origSize;
      totalMinified += minSize;

      console.log(`  ${file}: ${kb(origSize)} → ${kb(minSize)} (${savings}% saved)`);
    } catch (err) {
      console.error(`  ERROR: ${file} — ${err.message}`);
    }
  }

  const totalSavings = Math.round((1 - totalMinified / totalOriginal) * 100);
  console.log(`\nTotal: ${kb(totalOriginal)} → ${kb(totalMinified)} (${totalSavings}% saved)`);
  console.log('\nDist files written to dist/js/');
  console.log('Update index.html script paths from js/ to dist/js/ for production.');
}

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

main().catch(function(err) {
  console.error('Build failed:', err);
  process.exit(1);
});
