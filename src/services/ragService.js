import { ChatOpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import Document from '../models/document.model.js';
import DocumentChunk from '../models/documentChunk.model.js';

class RAGService {
  constructor() {
    // Use consistent embedding model for both document processing and search
    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: 'text-embedding-3-small', // Consistent model for all embeddings
    });
    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
    });
    
    console.log('RAG Service initialized with embedding model: text-embedding-3-small');
  }

  // Split text into chunks
  chunkText(text, chunkSize = 1000, overlap = 200) {
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      let chunk = text.slice(start, end);
      
      // Try to break at sentence boundary
      if (end < text.length) {
        const lastPeriod = chunk.lastIndexOf('.');
        const lastNewline = chunk.lastIndexOf('\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);
        
        if (breakPoint > start + chunkSize * 0.5) {
          chunk = text.slice(start, start + breakPoint + 1);
          start = start + breakPoint + 1;
        } else {
          start = end;
        }
      } else {
        start = end;
      }
      
      if (chunk.trim().length > 0) {
        chunks.push(chunk.trim());
      }
    }
    
    return chunks;
  }

  // Process and store document
  async processDocument(title, content, fileName = null, fileType = null, metadata = {}) {
    try {
      // Create document record
      const document = await Document.create({
        title,
        content,
        fileName,
        fileType,
        metadata,
      });

      // Split content into chunks
      const chunks = this.chunkText(content);
      
      // Generate embeddings for each chunk using the same model
      const chunkPromises = chunks.map(async (chunk, index) => {
        console.log(`Generating embedding for chunk ${index + 1}/${chunks.length} using text-embedding-3-small`);
        const embedding = await this.embeddings.embedQuery(chunk);
        console.log(`Generated embedding with ${embedding.length} dimensions`);
        
        return DocumentChunk.create({
          documentId: document.id,
          content: chunk,
          chunkIndex: index,
          embedding: JSON.stringify(embedding),
          metadata: {
            ...metadata,
            chunkLength: chunk.length,
            embeddingModel: 'text-embedding-3-small', // Store model info
          },
        });
      });

      await Promise.all(chunkPromises);

      // Update document with chunk count
      await document.update({ chunkCount: chunks.length });

      console.log(`Processed document: ${title} with ${chunks.length} chunks`);
      return document;
    } catch (error) {
      console.error('Error processing document:', error);
      throw error;
    }
  }

  // Search for relevant chunks
  async searchRelevantChunks(query, limit = 8, filters = {}) {
    try {
      console.log(`Searching for query: "${query}"`);
      
      // Generate embeddings for query using the same model as document processing
      console.log('Generating query embedding using text-embedding-3-small');
      const queryEmbedding = await this.embeddings.embedQuery(query);
      console.log('Query embedding generated, length:', queryEmbedding.length);
      
      // Also try a simplified version of the query for better matching
      const simplifiedQuery = query.toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
      
      let simplifiedEmbedding = null;
      if (simplifiedQuery !== query.toLowerCase()) {
        try {
          console.log('Generating simplified query embedding using text-embedding-3-small');
          simplifiedEmbedding = await this.embeddings.embedQuery(simplifiedQuery);
          console.log('Simplified query embedding generated, length:', simplifiedEmbedding.length);
        } catch (e) {
          console.log('Could not generate simplified embedding, using original');
        }
      }
      
      // Get all chunks with their embeddings using raw SQL to avoid association issues
      let whereClause = '';
      let params = [];
      
      if (filters.docRefId) {
        whereClause = 'WHERE d.docRefId = $1';
        params.push(filters.docRefId);
      } else if (filters.userId) {
        whereClause = 'WHERE d.userId = $1';
        params.push(filters.userId);
      }

      const querySQL = `
        SELECT dc.*, d.title, d."fileName", d."fileType"
        FROM document_chunks dc
        JOIN documents d ON dc."documentId" = d.id
        ${whereClause}
        ORDER BY dc."createdAt" DESC
      `;

      const result = await DocumentChunk.sequelize.query(querySQL, {
        replacements: params,
        type: DocumentChunk.sequelize.QueryTypes.SELECT
      });

      console.log(`Found ${result.length} chunks in database`);

      // Calculate similarity scores (cosine similarity)
      const chunksWithScores = result
        .map(chunk => {
          let embeddingArray = [];
          try {
            embeddingArray = Array.isArray(chunk.embedding)
              ? chunk.embedding
              : JSON.parse(chunk.embedding || '[]');
          } catch (e) {
            console.error('Error parsing embedding:', e.message);
            return null;
          }
          
          if (!embeddingArray.length) {
            console.log('Empty embedding for chunk:', chunk.id);
            return null;
          }
          
          const similarity = this.cosineSimilarity(queryEmbedding, embeddingArray);
          
          // If we have a simplified embedding, also calculate similarity with that
          let maxSimilarity = similarity;
          if (simplifiedEmbedding) {
            const simplifiedSimilarity = this.cosineSimilarity(simplifiedEmbedding, embeddingArray);
            maxSimilarity = Math.max(similarity, simplifiedSimilarity);
          }
          
          return {
            ...chunk,
            document: {
              title: chunk.title,
              fileName: chunk.fileName,
              fileType: chunk.fileType
            },
            similarity: maxSimilarity,
          };
        })
        .filter(Boolean);

      console.log(`Processed ${chunksWithScores.length} chunks with embeddings`);

      // Sort by similarity and return top results
      const ranked = chunksWithScores
        .sort((a, b) => b.similarity - a.similarity)
        .filter(chunk => Number.isFinite(chunk.similarity));

      console.log(`Top similarities:`, ranked.slice(0, 5).map(c => c.similarity.toFixed(3)));

      // Smart thresholding: Use dynamic threshold based on results
      let results = [];
      if (ranked.length > 0) {
        const topSimilarity = ranked[0].similarity;
        
        // If we have very high similarity results, use a higher threshold
        // If we have lower similarity results, use a more permissive threshold
        let threshold = 0.05; // Very permissive default
        
        if (topSimilarity > 0.5) {
          threshold = 0.2; // High quality results, be more selective
        } else if (topSimilarity > 0.3) {
          threshold = 0.15; // Medium quality results
        } else if (topSimilarity > 0.1) {
          threshold = 0.05; // Low quality results, be very permissive
        }
        
        console.log(`Using dynamic threshold: ${threshold} (top similarity: ${topSimilarity.toFixed(3)})`);
        
        // Filter by threshold
        const filteredResults = ranked.filter(chunk => chunk.similarity >= threshold);
        
        // If we have very few results after filtering, be more permissive
        if (filteredResults.length < 3 && ranked.length >= 3) {
          console.log('Too few results after threshold, using top 3 results');
          results = ranked.slice(0, Math.max(3, limit));
        } else {
          results = filteredResults.slice(0, limit);
        }
        
        // Ensure we have results from different documents if possible
        const documentIds = new Set();
        const diverseResults = [];
        
        for (const chunk of results) {
          if (documentIds.size < 3 || !documentIds.has(chunk.documentId)) {
            diverseResults.push(chunk);
            documentIds.add(chunk.documentId);
          }
        }
        
        if (diverseResults.length > 0) {
          results = diverseResults;
        }
      }
      
      console.log(`Returning ${results.length} chunks from ${new Set(results.map(r => r.documentId)).size} documents`);
      
      return results;
    } catch (error) {
      console.error('Error searching chunks:', error);
      return [];
    }
  }

  // Calculate cosine similarity
  cosineSimilarity(a, b) {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  // Verify embedding model consistency
  async verifyEmbeddingConsistency() {
    try {
      console.log('Verifying embedding model consistency...');
      
      // Check a few stored embeddings to ensure they're from the same model
      const sampleChunks = await DocumentChunk.findAll({
        limit: 3,
        order: [['createdAt', 'DESC']]
      });
      
      for (const chunk of sampleChunks) {
        const metadata = chunk.metadata || {};
        const embeddingModel = metadata.embeddingModel || 'unknown';
        const embeddingLength = Array.isArray(chunk.embedding) 
          ? chunk.embedding.length 
          : JSON.parse(chunk.embedding || '[]').length;
        
        console.log(`Chunk ${chunk.id}: model=${embeddingModel}, dimensions=${embeddingLength}`);
      }
      
      console.log('Embedding consistency verification complete');
    } catch (error) {
      console.error('Error verifying embedding consistency:', error);
    }
  }

  // Generate answer using RAG
  async generateAnswer(query, contextChunks) {
    try {
      const context = contextChunks
        .map(chunk => `Document: ${chunk.document.title}\nContent: ${chunk.content}`)
        .join('\n\n');

      const prompt = `You are a helpful assistant that answers questions based on the provided documents.

Context from documents:
${context}

Question: ${query}

Please provide a comprehensive answer based on the context above. If the answer is not found in the provided context, say so clearly. Include relevant details and examples from the documents when available.`;

      const response = await this.llm.invoke([
        { role: 'system', content: prompt },
        { role: 'user', content: query },
      ]);

      return response.text;
    } catch (error) {
      console.error('Error generating answer:', error);
      throw error;
    }
  }

  // Generate reasoning for the answer
  async generateReasoning(query, answer, contextChunks) {
    try {
      const context = contextChunks
        .map(chunk => `Document: ${chunk.document.title}\nContent: ${chunk.content}\nRelevance Score: ${chunk.similarity.toFixed(3)}`)
        .join('\n\n');

      const prompt = `You are a reasoning assistant that explains how an answer was derived from documents.

Question: ${query}

Answer: ${answer}

Relevant document chunks used:
${context}

Please provide a detailed reasoning that explains:
1. Which specific parts of the documents were most relevant
2. How the information was combined to form the answer
3. The confidence level in the answer based on the available context
4. Any limitations or gaps in the information used

Be specific about which documents and sections were most important.`;

      const response = await this.llm.invoke([
        { role: 'system', content: prompt },
        { role: 'user', content: 'Explain the reasoning behind this answer.' },
      ]);

      return response.text;
    } catch (error) {
      console.error('Error generating reasoning:', error);
      throw error;
    }
  }
}

export default new RAGService();
