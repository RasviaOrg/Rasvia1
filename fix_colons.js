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
    
    // Replace remaining colons in "rasvia_active_group_order:${userId}"
    content = content.replace(/rasvia_active_group_order:/g, 'rasvia_active_group_order_');
    
    fs.writeFileSync(f, content, 'utf8');
    console.log('Fixed', f);
  }
});
