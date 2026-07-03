const sharp = require('sharp');
sharp('media/icon.svg', { density: 300 })
  .resize(256, 256)
  .png()
  .toFile('media/icon.png')
  .then(info => console.log('icon.png written:', info.width + 'x' + info.height, info.size + ' bytes'))
  .catch(err => { console.error(err); process.exit(1); });
