import { DataTypes } from 'sequelize';
import { sequelize } from '../config/database.js';

const DocumentChunk = sequelize.define('documentChunk', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  documentId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'documents',
      key: 'id',
    },
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  chunkIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  embedding: {
    type: DataTypes.TEXT, // Store as JSON string
    allowNull: true,
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true,
  },
}, {
  tableName: 'document_chunks',
  timestamps: true,
});

// Define associations
DocumentChunk.associate = (models) => {
  DocumentChunk.belongsTo(models.Document, {
    foreignKey: 'documentId',
    as: 'document',
  });
};

export default DocumentChunk;
