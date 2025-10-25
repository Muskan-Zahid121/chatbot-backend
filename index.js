import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './src/config/database.js';
import chatRoutes from './src/routes/chat.routes.js';
import historyRoutes from './src/routes/history.routes.js';
import documentRoutes from './src/routes/document.routes.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json());
app.use(express.static('public'));
app.use(cors({ origin: ['http://localhost:5173'] }));

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Backend server is running', status: 'OK', timestamp: new Date().toISOString() });
});

app.use('/api/chat', chatRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/documents', documentRoutes);

async function start() {
  await initDatabase();
  app.listen(port, () => console.log(`Server iss running on port ${port}`));
}

start();



