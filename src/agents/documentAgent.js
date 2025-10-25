import { ChatOpenAI } from '@langchain/openai';
import { initializeAgentExecutorWithOptions } from 'langchain/agents';
import { DynamicTool } from '@langchain/core/tools';
import ragService from '../services/ragService.js';

class DocumentAgent {
  constructor() {
    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.1, // Lower temperature for more factual responses
    });
    this.tools = this.initializeTools();
  }

  initializeTools() {
    return [
      new DynamicTool({
        name: 'search_documents',
        description: 'Search through uploaded documents to find relevant information for answering questions',
        func: async (input) => {
          try {
            const relevantChunks = await ragService.searchRelevantChunks(input, 5);
            
            if (relevantChunks.length === 0) {
              return 'No relevant documents found for this query.';
            }

            const context = relevantChunks
              .map(chunk => `Document: ${chunk.document.title}\nContent: ${chunk.content}\nRelevance: ${(chunk.similarity * 100).toFixed(1)}%`)
              .join('\n\n---\n\n');

            return `Found ${relevantChunks.length} relevant document chunks:\n\n${context}`;
          } catch (error) {
            console.error('Error in search_documents tool:', error);
            return 'Error searching documents.';
          }
        },
      }),
      new DynamicTool({
        name: 'generate_answer',
        description: 'Generate a comprehensive answer based on document context',
        func: async (input) => {
          try {
            const { query, context } = JSON.parse(input);
            const chunks = JSON.parse(context);
            
            const answer = await ragService.generateAnswer(query, chunks);
            return answer;
          } catch (error) {
            console.error('Error in generate_answer tool:', error);
            return 'Error generating answer from documents.';
          }
        },
      }),
    ];
  }

  async createAgent() {
    return await initializeAgentExecutorWithOptions(
      this.tools,
      this.llm,
      {
        agentType: 'openai-functions',
        verbose: false,
        maxIterations: 3,
      }
    );
  }

  async answerQuestion(question) {
    try {
      const agent = await this.createAgent();
      
      const prompt = `You are a document-based question answering agent. 
      
Your task is to:
1. Search through available documents to find relevant information
2. Generate a comprehensive answer based on the found information
3. If no relevant documents are found, clearly state that

Question: ${question}

Please search for relevant documents and provide a detailed answer.`;

      const result = await agent.invoke({ input: prompt });
      return result.output;
    } catch (error) {
      console.error('Error in document agent:', error);
      return 'Sorry, I encountered an error while processing your question.';
    }
  }
}

export default new DocumentAgent();
