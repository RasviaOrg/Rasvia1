const fs = require('fs');

const filesToFix = [
  'app/waitlist/[id].tsx',
  'app/index.tsx',
  'app/restaurant/[id].tsx',
  'app/my-orders.tsx',
  'app/join/[id].tsx',
  'app/host_party.tsx',
];

filesToFix.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    
    // Replace "rasvia:something:something" -> "rasvia_something_something" selectively
    // we only want to replace `:` with `_`, but avoid doing it randomly in the code.
    // It's easy: just replace `rasvia:` with `rasvia_`
    content = content.replace(/rasvia:/g, 'rasvia_');
    
    // Fix `v1` colons: `mode:v1` -> `mode_v1`
    content = content.replace(/:v1"/g, '_v1"');
    
    // Also `rasvia_//` should be returned back to `rasvia://`
    content = content.replace(/rasvia_\/\//g, 'rasvia://');

    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed', f);
  }
});
