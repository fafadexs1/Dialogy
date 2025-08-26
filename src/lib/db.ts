
import { Pool } from 'pg';

// Tipagem para garantir que o pool seja do tipo correto e único.
declare global {
  // eslint-disable-next-line no-var
  var dbPool: Pool | undefined;
}

// Usamos um singleton para o Pool de conexões.
// Isso garante que apenas uma instância do pool seja criada e reutilizada
// em toda a aplicação, prevenindo vazamentos de memória e conexão.
const db = global.dbPool || new Pool({
    connectionString: process.env.DATABASE_URL,
    // Configurações adicionais do pool podem ser adicionadas aqui.
    // Ex: max: 20, idleTimeoutMillis: 30000, etc.
});

// Em desenvolvimento, o "hot-reloading" pode recriar o módulo.
// Armazenamos o pool na variável global para que ele persista
// entre as recargas e não crie novas conexões desnecessariamente.
if (process.env.NODE_ENV !== 'production') {
  global.dbPool = db;
}

export { db };
