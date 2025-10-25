import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        dialect: 'postgres',
        port: process.env.DB_PORT || 5432,
        logging: false,
        define: {
            timestamps: true
        }
    }
);

export { sequelize }; 

export async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established.');
    
    // Import models to register them
    const Chat = (await import('../models/chat.model.js')).default;
    const Document = (await import('../models/document.model.js')).default;
    const DocumentChunk = (await import('../models/documentChunk.model.js')).default;
    
    // Set up associations
    const models = { Chat, Document, DocumentChunk };
    Object.values(models).forEach(model => {
      if (model.associate) {
        model.associate(models);
      }
    });
    
    await sequelize.sync({ alter: true });
    console.log('Database synchronized.');
  } catch (err) {
    console.error('Database init error:', err);
    throw err;
  }
}


