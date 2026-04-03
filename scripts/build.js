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

const SRC_DIR      = path.join(__dirname, '..', 'js');
const DIST_DIR     = path.join(__dirname, '..', 'dist', 'js');
const CSS_SRC_DIR  = path.join(__dirname, '..', 'css');
const CSS_DIST_DIR = path.join(__dirname, '..', 'dist', 'css');

const TERSER_OPTIONS = {
  compress: {
    drop_console: true,        // strip console.log in production (saves ~2KB + eval overhead)
    passes: 2,
    dead_code: true,
    unused: true
  },
  mangle: true,
  format: {
    comments: false            // strip all comments
  }
};

// Lightweight CSS minifier — removes comments and collapses whitespace
function minifyCSS(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // strip block comments
    .replace(/\s*([{};:,>~+])\s*/g, '$1') // collapse whitespace around punctuation
    .replace(/;\s*}/g, '}')             // remove last semicolon before }
    .replace(/\s+/g, ' ')              // collapse remaining runs of whitespace
    .trim();
}

async function main() {
  if (!fs.existsSync(DIST_DIR))     fs.mkdirSync(DIST_DIR,     { recursive: true });
  if (!fs.existsSync(CSS_DIST_DIR)) fs.mkdirSync(CSS_DIST_DIR, { recursive: true });

  // === JS MINIFICATION ===
  const files = fs.readdirSync(SRC_DIR).filter(function(f) {
    return f.endsWith('.js') && !f.endsWith('.min.js');
  });

  let totalOriginal = 0;
  let totalMinified = 0;

  console.log('KRKAI Build\n');
  console.log('── JS ──────────────────────────────────────');

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
  console.log(`\n  Total JS: ${kb(totalOriginal)} → ${kb(totalMinified)} (${totalSavings}% saved)`);

  // === CSS MINIFICATION ===
  console.log('\n── CSS ─────────────────────────────────────');
  const cssFiles = fs.readdirSync(CSS_SRC_DIR).filter(function(f) { return f.endsWith('.css'); });

  let cssTotalOrig = 0;
  let cssTotalMin  = 0;

  for (const file of cssFiles) {
    const srcPath  = path.join(CSS_SRC_DIR, file);
    const distPath = path.join(CSS_DIST_DIR, file);
    const source   = fs.readFileSync(srcPath, 'utf8');
    const minified = minifyCSS(source);

    fs.writeFileSync(distPath, minified, 'utf8');

    const origSize = Buffer.byteLength(source, 'utf8');
    const minSize  = Buffer.byteLength(minified, 'utf8');
    const savings  = Math.round((1 - minSize / origSize) * 100);

    cssTotalOrig += origSize;
    cssTotalMin  += minSize;

    console.log(`  ${file}: ${kb(origSize)} → ${kb(minSize)} (${savings}% saved)`);
  }

  const cssTotalSavings = Math.round((1 - cssTotalMin / cssTotalOrig) * 100);
  console.log(`\n  Total CSS: ${kb(cssTotalOrig)} → ${kb(cssTotalMin)} (${cssTotalSavings}% saved)`);
  console.log('\nDist written to dist/js/ and dist/css/');
}

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

main().catch(function(err) {
  console.error('Build failed:', err);
  process.exit(1);
});
