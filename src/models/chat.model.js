import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const Chat = sequelize.define('chat', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  role: {
    type: DataTypes.STRING, // 'user' or 'assistant'
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  topic: {
    type: DataTypes.STRING,
    allowNull: true,
  },
});

export default Chat;