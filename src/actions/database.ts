
'use server';

import { db } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

export async function initializeDatabase(): Promise<{ success: boolean; message: string }> {
  try {
    console.log('Iniciando a inicialização do banco de dados...');
    
    // O caminho para o arquivo SQL é relativo ao diretório raiz do projeto
    const sqlFilePath = path.join(process.cwd(), 'db', 'init.sql');
    
    console.log(`Lendo o arquivo SQL de: ${sqlFilePath}`);
    const sql = await fs.readFile(sqlFilePath, 'utf-8');

    if (!sql) {
      return { success: false, message: 'O arquivo init.sql está vazio ou não foi encontrado.' };
    }

    // Executa todo o script SQL como uma única transação
    console.log('Executando o script SQL...');
    await db.query(sql);

    console.log('Banco de dados inicializado com sucesso.');
    return { success: true, message: 'Banco de dados inicializado com sucesso!' };

  } catch (error) {
    console.error('Erro ao inicializar o banco de dados:', error);
    // Assegura que o erro é uma string para a serialização
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, message: `Falha na inicialização do banco de dados: ${errorMessage}` };
  }
}
