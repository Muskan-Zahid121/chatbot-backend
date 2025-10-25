import express from 'express';
import { 
  uploadDocument, 
  addDocument, 
  getDocuments, 
  getDocument, 
  deleteDocument,
  upload 
} from '../controllers/document.controller.js';

const router = express.Router();

// Upload document file
router.post('/upload', upload.single('document'), uploadDocument);

// Add document from text
router.post('/add', addDocument);

// Get all documents
router.get('/', getDocuments);

// Get document by ID
router.get('/:id', getDocument);

// Delete document
router.delete('/:id', deleteDocument);

export default router;
