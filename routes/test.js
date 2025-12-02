const bcrypt = require('bcryptjs')

const testPass = '12345678';

async function hashing(password) {
    
    const hashedPassword = await bcrypt.hash(password, 10);
    return hashedPassword;
}

hashing(testPass)
.then(hash => { console.log(`HASHED PASSWORD: ${hash}`) })
.catch(error => { console.log(error) });