
import { db } from '../src/lib/db';
import { generateEmbedding } from '../src/lib/embeddings';
import { VectorStore } from '../src/lib/vector-store';
import { randomUUID } from 'crypto';

async function main() {
    try {
        console.log('--- Starting RAG Verification ---');

        const testContent = "This is a test document for RAG verification.";
        const testDocId = randomUUID();

        // 1. Generate Embedding
        console.log('1. Generating Document Embedding...');
        const vector = await generateEmbedding(testContent, 'doc');
        console.log(`   - Generated vector of length: ${vector.length}`);

        if (vector.length === 0) {
            throw new Error('Vector generation failed (empty vector).');
        }

        // 2. Store Embedding
        console.log(`2. Storing Embedding for Doc ID: ${testDocId}...`);
        await VectorStore.addDocumentEmbedding(testDocId, testContent, vector);
        console.log('   - Stored successfully.');

        // 3. Search Similarity
        console.log('3. Searching for similar content...');
        const searchVector = await generateEmbedding("verification document", 'doc');
        const results = await VectorStore.searchSimilarDocuments(searchVector, 5);

        console.log(`   - Found ${results.length} results.`);
        results.forEach((r, i) => {
            console.log(`     ${i + 1}. [${r.similarity.toFixed(4)}] ${r.content.substring(0, 50)}...`);
        });

        const match = results.find(r => r.document_id === testDocId);
        if (match) {
            console.log('✅ SUCCESS: Created document was found in search results.');
        } else {
            console.log('❌ FAILURE: Created document was NOT found in search results.');
        }

        // 4. Test Chat Embedding
        console.log('\n4. Testing Chat Embedding...');
        const chatContent = "Hello agent, help me with pricing.";
        const chatVector = await generateEmbedding(chatContent, 'chat');
        console.log(`   - Generated chat vector length: ${chatVector.length} (Expected 384)`);

        if (chatVector.length > 0) {
            const chatId = randomUUID();
            const messageId = randomUUID();
            await VectorStore.addMessageEmbedding(messageId, chatId, chatContent, 'user', chatVector);
            console.log('   - Stored chat embedding.');

            const searchChatVector = await generateEmbedding("help pricing", 'chat');
            const chatResults = await VectorStore.searchSimilarMessages(searchChatVector, undefined, 5);
            console.log(`   - Found ${chatResults.length} chat results.`);
            chatResults.forEach((r, i) => {
                console.log(`     ${i + 1}. [${r.similarity.toFixed(4)}] ${r.content.substring(0, 50)}...`);
            });

            const chatMatch = chatResults.find(r => r.message_id === messageId);
            if (chatMatch) {
                console.log('✅ SUCCESS: Created chat message was found in search results.');
            } else {
                console.log('❌ FAILURE: Created chat message was NOT found in search results.');
            }
        }

    } catch (error) {
        console.error('❌ Error during RAG verification:', error);
    } finally {
        process.exit(0);
    }
}

main();
