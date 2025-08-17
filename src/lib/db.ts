
import { Pool } from 'pg';

// Tipagem para garantir que o pool seja do tipo correto
declare global {
  // eslint-disable-next-line no-var
  var pool: Pool | undefined;
}

let db: Pool;

// Em desenvolvimento, o "hot-reloading" pode recriar o módulo,
// o que levaria a múltiplos pools. Usamos a variável global para prevenir isso.
if (process.env.NODE_ENV === 'production') {
  if (!global.pool) {
    global.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
  }
  db = global.pool;
} else {
  // Em desenvolvimento, criamos um novo pool se ele não existir no escopo global.
  if (!global.pool) {
    global.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
  }
  db = global.pool;
}

export { db };
