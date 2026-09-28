'use strict';
const fs = require('fs');
const lines = fs.readFileSync('src/js/ui.js','utf8').split('\n');
for (let i = 1162; i < 1196 && i < lines.length; i++) console.log((i+1) + '|' + lines[i]);