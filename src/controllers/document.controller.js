import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import Document from '../models/document.model.js';
import DocumentChunk from '../models/documentChunk.model.js';
import ragService from '../services/ragService.js';
import { parsePDF } from '../utils/pdfParser.js';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join('uploads', 'documents');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.txt', '.md', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .md, and .pdf files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Upload and process document
export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { title, docRefId, status = 'active', userId } = req.body;
    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    // Read file content
    let content = '';
    let metadata = {
      fileSize: req.file.size,
      uploadDate: new Date().toISOString(),
      status,
      docRefId: docRefId || null,
      userId: userId || null,
      fileName: req.file.originalname,
    };
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.txt' || ext === '.md') {
      content = fs.readFileSync(filePath, 'utf8');
    } else if (ext === '.pdf') {
      try {
        // Parse PDF file using utility function
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await parsePDF(dataBuffer);
        content = pdfData.text;
        
        // Add PDF metadata
        metadata = {
          ...metadata,
          pages: pdfData.numpages,
          info: pdfData.info,
          version: pdfData.version,
        };
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        fs.unlinkSync(filePath); // Clean up uploaded file
        return res.status(400).json({ 
          message: 'Error parsing PDF file. Please ensure it\'s a valid PDF.',
          error: pdfError.message 
        });
      }
    }

    // Process document with RAG service
    const document = await ragService.processDocument(
      title,
      content,
      req.file.originalname,
      ext,
      metadata
    );

    // Update additional fields on Document for convenience
    await document.update({
      fileSize: req.file.size,
      status,
      docRefId: docRefId || document.id,
      userId: userId || null,
      fileLink: `/uploads/documents/${req.file.filename}`,
    });

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        fileName: document.fileName,
        fileType: document.fileType,
        chunkCount: document.chunkCount,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error('Error uploading document:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing document',
      error: error.message 
    });
  }
};

// Add document from text
export const addDocument = async (req, res) => {
  try {
    const { title, content, metadata = {} } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    const document = await ragService.processDocument(
      title,
      content,
      null,
      'text',
      metadata
    );

    res.json({
      success: true,
      document: {
        id: document.id,
        title: document.title,
        chunkCount: document.chunkCount,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error('Error adding document:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error adding document',
      error: error.message 
    });
  }
};

// Get all documents
export const getDocuments = async (req, res) => {
  try {
    const documents = await Document.findAll({
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'title', 'fileName', 'fileType', 'chunkCount', 'createdAt'],
    });

    res.json({
      success: true,
      documents,
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching documents',
      error: error.message 
    });
  }
};

// Get document by ID
export const getDocument = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }
    
    const document = await Document.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json({
      success: true,
      document,
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching document',
      error: error.message 
    });
  }
};

// Delete document
export const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ message: 'Invalid document ID format' });
    }
    
    const document = await Document.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Delete associated chunks first
    await DocumentChunk.destroy({ where: { documentId: id } });
    
    // Delete document
    await document.destroy();

    res.json({
      success: true,
      message: 'Document deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error deleting document',
      error: error.message 
    });
  }
};
