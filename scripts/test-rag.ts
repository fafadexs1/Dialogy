import { randomUUID } from 'crypto';
import { generateDocumentPassageEmbedding, generateDocumentQueryEmbedding } from '../src/lib/embeddings';
import { VectorStore } from '../src/lib/vector-store';

async function main() {
    try {
        console.log('--- Starting RAG Verification ---');

        const workspaceId = randomUUID();
        const testContent = 'Procedimento de cancelamento: validar titularidade, registrar motivo e confirmar prazo de estorno.';
        const testDocId = randomUUID();

        console.log('1. Generating document passage embedding...');
        const vector = await generateDocumentPassageEmbedding(testContent);
        console.log(`   - Generated vector of length: ${vector.length}`);

        if (vector.length === 0) {
            throw new Error('Vector generation failed (empty vector).');
        }

        console.log(`2. Storing document embedding for doc ${testDocId}...`);
        await VectorStore.addDocumentEmbedding({
            documentId: testDocId,
            workspaceId,
            documentName: 'Procedimento de cancelamento',
            content: testContent,
            vector,
            metadata: { source: 'script-test' },
        });
        console.log('   - Stored successfully.');

        console.log('3. Searching similar documents...');
        const searchVector = await generateDocumentQueryEmbedding('como cancelar e pedir estorno');
        const results = await VectorStore.searchSimilarDocuments({
            vector: searchVector,
            workspaceId,
            limit: 5,
            minSimilarity: 0,
        });

        console.log(`   - Found ${results.length} results.`);
        results.forEach((r, i) => {
            console.log(`     ${i + 1}. [${r.similarity.toFixed(4)}] ${r.content.substring(0, 80)}...`);
        });

        const match = results.find((r) => r.document_id === testDocId);
        if (match) {
            console.log('SUCCESS: created document was found in search results.');
        } else {
            console.log('FAILURE: created document was NOT found in search results.');
        }

        console.log('\n4. Upserting case memory...');
        const chatId = randomUUID();
        const caseText = [
            'Resumo: cliente pediu cancelamento de compra duplicada.',
            'Problema: compra em duplicidade no cartao.',
            'Resolucao: confirmar identidade, abrir solicitacao e orientar prazo de estorno.',
            'Resultado: caso encerrado com estorno solicitado.',
        ].join('\n');
        const caseVector = await generateDocumentPassageEmbedding(caseText);

        await VectorStore.upsertCaseMemory({
            chatId,
            workspaceId,
            summary: 'Cancelamento de compra duplicada com estorno',
            problem: 'Compra em duplicidade no cartao',
            resolution: 'Validar identidade e abrir solicitacao de estorno',
            outcome: 'Estorno solicitado e cliente orientado',
            keywords: ['cancelamento', 'estorno', 'compra duplicada'],
            searchableContent: caseText,
            vector: caseVector,
            metadata: { source: 'script-test' },
        });

        const caseResults = await VectorStore.searchSimilarCaseMemories({
            vector: searchVector,
            workspaceId,
            limit: 5,
            minSimilarity: 0,
        });

        console.log(`   - Found ${caseResults.length} case memories.`);
        caseResults.forEach((r, i) => {
            console.log(`     ${i + 1}. [${r.similarity.toFixed(4)}] ${r.summary}`);
        });
    } catch (error) {
        console.error('Error during RAG verification:', error);
    } finally {
        process.exit(0);
    }
}

main();
