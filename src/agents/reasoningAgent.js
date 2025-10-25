import { ChatOpenAI } from '@langchain/openai';
import { initializeAgentExecutorWithOptions } from 'langchain/agents';
import { DynamicTool } from '@langchain/core/tools';
import ragService from '../services/ragService.js';

class ReasoningAgent {
  constructor() {
    this.llm = new ChatOpenAI({
      openAIApiKey: process.env.OPENAI_API_KEY,
      modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.3, // Slightly higher for more creative reasoning
    });
    this.tools = this.initializeTools();
  }

  initializeTools() {
    return [
      new DynamicTool({
        name: 'analyze_relevance',
        description: 'Analyze the relevance and quality of document chunks used in an answer',
        func: async (input) => {
          try {
            const { query, chunks } = JSON.parse(input);
            
            const analysis = chunks.map(chunk => ({
              document: chunk.document.title,
              relevance: chunk.similarity,
              content: chunk.content.substring(0, 200) + '...',
              quality: chunk.similarity > 0.8 ? 'High' : chunk.similarity > 0.6 ? 'Medium' : 'Low'
            }));

            return `Relevance Analysis:\n${JSON.stringify(analysis, null, 2)}`;
          } catch (error) {
            console.error('Error in analyze_relevance tool:', error);
            return 'Error analyzing relevance.';
          }
        },
      }),
      new DynamicTool({
        name: 'generate_reasoning',
        description: 'Generate detailed reasoning explaining how the answer was derived',
        func: async (input) => {
          try {
            const { query, answer, chunks } = JSON.parse(input);
            
            const reasoning = await ragService.generateReasoning(query, answer, chunks);
            return reasoning;
          } catch (error) {
            console.error('Error in generate_reasoning tool:', error);
            return 'Error generating reasoning.';
          }
        },
      }),
      new DynamicTool({
        name: 'evaluate_confidence',
        description: 'Evaluate the confidence level of the answer based on available evidence',
        func: async (input) => {
          try {
            const { chunks, answer } = JSON.parse(input);
            
            const avgRelevance = chunks.reduce((sum, chunk) => sum + chunk.similarity, 0) / chunks.length;
            const chunkCount = chunks.length;
            
            let confidence = 'Low';
            if (avgRelevance > 0.8 && chunkCount >= 3) {
              confidence = 'High';
            } else if (avgRelevance > 0.6 && chunkCount >= 2) {
              confidence = 'Medium';
            }

            return `Confidence Evaluation:
- Average Relevance: ${(avgRelevance * 100).toFixed(1)}%
- Number of Sources: ${chunkCount}
- Overall Confidence: ${confidence}
- Answer Length: ${answer.length} characters`;
          } catch (error) {
            console.error('Error in evaluate_confidence tool:', error);
            return 'Error evaluating confidence.';
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

  async generateReasoning(query, answer, contextChunks) {
    try {
      const agent = await this.createAgent();
      
      const prompt = `You are a reasoning agent that explains how answers were derived from documents.

Question: ${query}
Answer: ${answer}

Available context chunks: ${contextChunks.length} chunks

Your task is to:
1. Analyze the relevance and quality of the source documents
2. Generate detailed reasoning explaining the thought process
3. Evaluate the confidence level of the answer
4. Identify any limitations or gaps in the information

Please provide a comprehensive reasoning analysis.`;

      const contextData = {
        query,
        answer,
        chunks: contextChunks
      };

      const result = await agent.invoke({ 
        input: `${prompt}\n\nContext Data: ${JSON.stringify(contextData)}` 
      });
      
      return result.output;
    } catch (error) {
      console.error('Error in reasoning agent:', error);
      return 'Sorry, I encountered an error while generating reasoning.';
    }
  }
}

export default new ReasoningAgent();
