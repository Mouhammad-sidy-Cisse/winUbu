const bcrypt = require('bcryptjs');
const password = process.argv[2];
if (!password) {
  console.log('Usage: node hash.js winUbu20052000');
  process.exit(1);
}
bcrypt.hash(password, 10).then(hash => console.log(hash));