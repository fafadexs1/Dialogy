
import { Pool } from 'pg';

// Ensure the connection string is correctly typed
const connectionString: string = process.env.DATABASE_URL!;

if (!connectionString) {
  throw new Error('A variável de ambiente DATABASE_URL não está definida.');
}

// Este módulo é carregado por 5 processos distintos (app + 4 workers), cada um
// com o seu próprio pool. O default do `pg` é 10 por processo, o que dá 50
// conexões potenciais contra as ~41 livres do Postgres — daí o valor vir do
// ambiente, orçado por serviço no docker-compose.
function resolvePoolMax(): number {
  const parsed = Number.parseInt(process.env.DB_POOL_MAX ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

// A nova implementação cria um único pool de conexões que é exportado.
// Isso é mais seguro e mais compatível com o ambiente Vercel/Next.js.
export const db = new Pool({
  connectionString,
  max: resolvePoolMax(),
  // Sem isto o default é esperar para sempre: sob saturação as requisições
  // ficam penduradas em vez de falhar, e o sintoma vira "o sistema travou"
  // sem nada nos logs.
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

// Um erro em cliente ocioso emite 'error' no pool. Sem listener, o Node derruba
// o processo inteiro — uma queda de rede momentânea com o banco tiraria o app do ar.
db.on('error', (error) => {
  console.error('[DB_POOL] Erro em cliente ocioso:', error);
});
