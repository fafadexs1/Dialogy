import { Pool } from 'pg';

// Ensure the connection string is correctly typed
const connectionString: string = process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error('A variável de ambiente DATABASE_URL não está definida.');
}

// A nova implementação cria um único pool de conexões que é exportado.
// Isso é mais seguro e mais compatível com o ambiente Vercel/Next.js.
export const db = new Pool({
  connectionString,
});

// A lógica de pooling global foi removida por ser a causa provável de instabilidade
// no ambiente serverless.
