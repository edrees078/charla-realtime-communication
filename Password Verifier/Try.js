const bcrypt = require('bcryptjs');

async function verifyPassword(inputPassword, storedHash) {
  try {
    const match = await bcrypt.compare(inputPassword, storedHash);
    if (match) {
      console.log('Password is correct.');
    } else {
      console.log('Password is incorrect.');
    }
  } catch (error) {
    console.error('Error verifying password:', error);
  }
}


const inputPassword = 'idris123'; 
const storedHash = '$2a$10$Oqi4Jtdz8qQZJX9BrR6siuAACySOIX4sbNRyIZ/RbZQEpTBWme7Dm'; 

verifyPassword(inputPassword, storedHash);
