/**
 * KRKAI — Three.js Bundle Script
 *
 * Downloads all Three.js r128 CDN scripts + GSAP to vendor/ directory,
 * then concatenates them into dist/js/three-bundle.min.js.
 *
 * This eliminates 12 separate CDN HTTP requests on page load.
 * The single local bundle is cached by the browser and service worker.
 *
 * Usage:
 *   node scripts/bundle-three.js
 *   (also called automatically by npm run build)
 */

'use strict';

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor');
const DIST_DIR   = path.join(__dirname, '..', 'dist', 'js');
const OUT_FILE   = path.join(DIST_DIR, 'three-bundle.min.js');

// All 12 scripts that were loaded via CDN in index.html (in load order)
const CDN_SCRIPTS = [
  {
    name: 'three.min.js',
    url:  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
  },
  {
    name: 'OrbitControls.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'
  },
  {
    name: 'BufferGeometryUtils.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/BufferGeometryUtils.js'
  },
  {
    name: 'EffectComposer.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js'
  },
  {
    name: 'RenderPass.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js'
  },
  {
    name: 'CopyShader.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js'
  },
  {
    name: 'LuminosityHighPassShader.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js'
  },
  {
    name: 'UnrealBloomPass.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js'
  },
  {
    name: 'BokehShader.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/BokehShader.js'
  },
  {
    name: 'BokehPass.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/BokehPass.js'
  },
  {
    name: 'FXAAShader.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/FXAAShader.js'
  },
  {
    name: 'ShaderPass.js',
    url:  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js'
  },
  {
    name: 'gsap.min.js',
    url:  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js'
  },
  {
    name: 'ScrollTrigger.min.js',
    url:  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js'
  }
];

function download(url, dest) {
  return new Promise(function(resolve, reject) {
    // If already cached, skip download
    if (fs.existsSync(dest)) {
      process.stdout.write('  [cached] ' + path.basename(dest) + '\n');
      resolve();
      return;
    }

    var file = fs.createWriteStream(dest);
    var client = url.startsWith('https') ? https : http;

    function doGet(requestUrl) {
      client.get(requestUrl, function(res) {
        // Follow redirects (301/302)
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close();
          fs.unlinkSync(dest);
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error('HTTP ' + res.statusCode + ' for ' + requestUrl));
          return;
        }
        res.pipe(file);
        file.on('finish', function() {
          file.close();
          process.stdout.write('  [downloaded] ' + path.basename(dest) + '\n');
          resolve();
        });
      }).on('error', function(err) {
        fs.unlinkSync(dest);
        reject(err);
      });
    }

    doGet(url);
  });
}

async function main() {
  // Ensure directories exist
  if (!fs.existsSync(VENDOR_DIR)) fs.mkdirSync(VENDOR_DIR, { recursive: true });
  if (!fs.existsSync(DIST_DIR))   fs.mkdirSync(DIST_DIR,   { recursive: true });

  console.log('\nKRKAI Three.js Bundle\n');
  console.log('Downloading CDN scripts to vendor/...\n');

  // Download all scripts (sequentially to avoid hammering CDNs)
  for (const script of CDN_SCRIPTS) {
    const dest = path.join(VENDOR_DIR, script.name);
    try {
      await download(script.url, dest);
    } catch (err) {
      console.error('  ERROR downloading ' + script.name + ': ' + err.message);
      console.error('  Check your internet connection and try again.');
      process.exit(1);
    }
  }

  // Concatenate into single bundle
  console.log('\nConcatenating into dist/js/three-bundle.min.js...');
  var parts = [];
  var totalSize = 0;

  for (const script of CDN_SCRIPTS) {
    const src = path.join(VENDOR_DIR, script.name);
    const content = fs.readFileSync(src, 'utf8');
    // Add a newline separator between scripts to avoid syntax errors
    parts.push('/* ' + script.name + ' */');
    parts.push(content);
    parts.push('');
    totalSize += Buffer.byteLength(content, 'utf8');
  }

  fs.writeFileSync(OUT_FILE, parts.join('\n'), 'utf8');

  const bundleSize = fs.statSync(OUT_FILE).size;
  console.log('  Total source: ' + kb(totalSize));
  console.log('  Bundle size:  ' + kb(bundleSize));
  console.log('\n  Written: dist/js/three-bundle.min.js');
  console.log('\nRemember to update index.html to use the local bundle (see Phase 1 plan).\n');
}

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

main().catch(function(err) {
  console.error('Bundle failed:', err);
  process.exit(1);
});
