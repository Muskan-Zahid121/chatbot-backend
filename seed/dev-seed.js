import bcrypt from 'bcryptjs';
import { sequelize } from '../config/database.js';
import User from '../models/user.model.js';

async function seed() {
  await sequelize.sync();
  const hashed = await bcrypt.hash('password123', 10);
  const [user, created] = await User.findOrCreate({
    where: { email: 'test@example.com' },
    defaults: { name: 'Test User', password: hashed, verified: true },
  });
  console.log('Seed user:', user.email, 'created:', created);
}

seed()
  .then(() => {
    console.log('Seeding complete.');
  })
  .catch((err) => {
    console.error('Seed error:', err);
  });



