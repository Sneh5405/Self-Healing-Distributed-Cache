#!/usr/bin/env node
/**
 * Post-build asset copy script.
 * Copies src/dashboard/dashboard.html → dist/dashboard/dashboard.html
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'dashboard', 'dashboard.html');
const destDir = path.join(__dirname, '..', 'dist', 'dashboard');
const dest = path.join(destDir, 'dashboard.html');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[build] Copied dashboard.html → ${dest}`);

