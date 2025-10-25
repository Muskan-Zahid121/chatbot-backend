import { ChatOpenAI } from '@langchain/openai';
import Chat from '../models/chat.model.js';
import ragService from '../services/ragService.js';

export const chatWithTutor = async (req, res) => {
  try {
    const { message, stream = false, useRAG = true, docRefId, userId } = req.body || {};
    if (!message) return res.status(400).json({ message: 'message is required' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ message: 'OPENAI_API_KEY not configured' });

    // Save user message (best-effort)
    try {
      await Chat.create({ role: 'user', message });
    } catch (err) {
      console.error('Failed saving user message:', err);
    }

    let answer = '';
    let reasoning = '';

    if (useRAG) {
      try {
        console.log(`RAG enabled for query: "${message}"`);
        
        // Check if this is a greeting
        const greetingPatterns = /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|what's up|howdy|greetings|hi there|hello there|hey there|good day|good night)/i;
        const isGreeting = greetingPatterns.test(message.trim());
        
        console.log(`Greeting check for "${message}": ${isGreeting}`);
        
        if (isGreeting) {
          // Handle greetings with a document-focused response
          console.log('Handling greeting response');
          answer = 'Hello! I\'m your document-based AI assistant. I can help you find information from the documents you\'ve uploaded. Please ask me questions about the content in your uploaded documents.';
          
          console.log('Greeting answer set to:', answer);
          
          // Save assistant reply (best-effort)
          try {
            await Chat.create({ role: 'assistant', message: answer });
            console.log('Greeting response saved to database');
          } catch (err) {
            console.error('Failed saving assistant message:', err);
          }
          
          console.log('Returning greeting response');
          return res.json({ answer });
        } else {
          const relevantChunks = await ragService.searchRelevantChunks(message, 8, {
            docRefId: docRefId || undefined,
            userId: userId || undefined,
          });

          console.log(`Found ${relevantChunks.length} relevant chunks`);
          if (relevantChunks.length === 0) {
            answer = 'I don\'t have enough information in the uploaded documents to answer this question. Please upload a relevant document or try asking about something that might be covered in the documents you\'ve already uploaded.';
          } else {
            const context = relevantChunks
              .map((c, i) => `Source ${i + 1} — ${c.document?.title || 'Untitled'}\n${c.content}`)
              .join('\n\n');

            const systemPrompt = `You are a document-based AI assistant that answers questions using information from the provided document context. 

Instructions:
1. Use the information in the <context> section to answer the user's question comprehensively
2. If the answer is clearly present in the context, provide a detailed and helpful response
3. If the answer is partially present, provide what information is available and mention any limitations
4. If you find relevant information from multiple documents, synthesize the information to provide a complete answer
5. If the answer is not present in the context, say "I don't have enough information in the uploaded documents to answer this question. Please upload a relevant document or try asking about something that might be covered in the documents you've already uploaded."
6. Be conversational and helpful in your responses
7. Do not include source citations or [Source N] markers in your answer
8. Focus only on document content - do not provide general knowledge or programming advice
9. If the question is about a specific document or person, try to find information from all relevant documents

<context>
${context}
</context>`;

            const llm = new ChatOpenAI({
            openAIApiKey: apiKey,
            modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0.1,
            streaming: stream,
          });

          if (stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': 'Cache-Control',
            });

            let fullResponse = '';

            try {
              const s = await llm.stream([
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
              ]);

              for await (const chunk of s) {
                const content = chunk.content;
                if (content) {
                  fullResponse += content;
                  res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
                }
              }

              res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
              res.end();

              try {
                await Chat.create({ role: 'assistant', message: fullResponse });
              } catch (err) {
                console.error('Failed saving assistant message:', err);
              }
            } catch (e) {
              console.error('RAG streaming error:', e);
              res.write(`data: ${JSON.stringify({ type: 'error', message: 'Streaming failed' })}\n\n`);
              res.end();
            }
            return;
          }

          const completion = await llm.invoke([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ]);

          answer = completion.text;

          try {
            reasoning = await ragService.generateReasoning(message, answer, relevantChunks);
          } catch {
            reasoning = '';
          }
          }
        }
      } catch (ragError) {
        console.error('RAG error:', ragError);
        answer = 'RAG system error. Please try again.';
      }
    } else {
      // Direct OpenAI call (original behavior)
      const llm = new ChatOpenAI({
        openAIApiKey: apiKey,
        modelName: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        streaming: stream,
      });

      // Check if this is a greeting for direct mode too
      const greetingPatterns = /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|what's up|howdy|greetings|hi there|hello there|hey there|good day|good night)/i;
      const isGreeting = greetingPatterns.test(message.trim());
      
      let systemPrompt;
      if (isGreeting) {
        systemPrompt = `You are a friendly document-based AI assistant. Respond warmly to greetings and introduce yourself as an assistant who can help with questions about uploaded documents.`;
      } else {
        systemPrompt = `You are a document-based AI assistant. You can only help with questions about uploaded documents. If the user asks about general topics not related to documents, politely redirect them to ask about document content instead.`;
      }

      if (stream) {
        // Set up Server-Sent Events headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control',
        });

        let fullResponse = '';

        try {
          const stream = await llm.stream([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ]);

          for await (const chunk of stream) {
            const content = chunk.content;
            if (content) {
              fullResponse += content;
              // Send chunk to client
              res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
            }
          }

          // Send completion signal
          res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          res.end();

          // Save complete assistant reply (best-effort)
          try {
            await Chat.create({ role: 'assistant', message: fullResponse });
          } catch (err) {
            console.error('Failed saving assistant message:', err);
          }

        } catch (streamErr) {
          console.error('Streaming error:', streamErr);
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Streaming failed' })}\n\n`);
          res.end();
        }
        return;
      } else {
        const completion = await llm.invoke([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ]);

        answer = completion.text;
      }
    }

    // Save assistant reply (best-effort)
    try {
      await Chat.create({ role: 'assistant', message: answer });
    } catch (err) {
      console.error('Failed saving assistant message:', err);
    }

    // Return response with reasoning if available
    const response = { answer };
    if (reasoning) {
      response.reasoning = reasoning;
    }

    return res.json(response);
  } catch (err) {
    console.error('Chat error:', err);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal Server Error' })}\n\n`);
      res.end();
    } else {
      return res.status(500).json({ message: 'Internal Server Error', detail: err?.message || String(err) });
    }
  }
};