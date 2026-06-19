const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:hE8NXpAbLHMSGru3rlnD7CMeJ8HPOwxVxiX4wnMIJa8jiSnSrUSBCVMFM02pCYxwZ1pyE9aOUlTNDBNfL5uwO4@193.202.85.69:5455/postgres' });

async function run() {
  try {
    const res = await pool.query(`SELECT flow_graph FROM autopilot_configs WHERE id = 'e2ccd8d7-354e-4bc1-9cef-4e061254c9a1'`);
    let table = 'autopilot_configs';
    let graph = null;

    if (res.rows.length === 0) {
        const saRes = await pool.query(`SELECT ac.id, ac.flow_graph FROM system_agents sa JOIN autopilot_configs ac ON sa.autopilot_config_id = ac.id WHERE sa.id = 'e2ccd8d7-354e-4bc1-9cef-4e061254c9a1'`);
        if (saRes.rows.length > 0) {
            graph = saRes.rows[0].flow_graph;
            table = 'system_agents_join'; // Just a marker
        }
    } else {
        graph = res.rows[0].flow_graph;
    }

    if (graph) {
        const apNode = graph.nodes.find(n => n.id === 'apresentacao_virtual');
        if (apNode) {
            apNode.config.message = "Olá! Sou a assistente virtual da Dra. Roberta, pediatra responsável pelos atendimentos. Para garantir a segurança da criança, a criança apresenta neste momento dificuldade importante para respirar, desmaio, convulsão, coloração azulada, reação alérgica intensa, sangramento importante ou está muito difícil de despertar?";
        }
        
        const trNode = graph.nodes.find(n => n.id === 'triagem_seguranca');
        if (trNode) {
            trNode.config.instructions = "Analise a resposta do usuário sobre sinais de alerta após a pergunta feita no bloco anterior. Identifique palavras-chave de risco (falta de ar, desmaio, convulsão, cor azulada, alergia grave). Rotas: 1. Se 'Sim' ou sintomas graves -> @urgencia_emergencia. 2. Se 'Não tenho certeza' -> Oriente atendimento presencial imediato e forneça SAMU (192). 3. Se 'Não' -> @menu_principal. 4. Fallback: Peça confirmação clara sobre os sinais antes de prosseguir.";
        }

        if (table === 'autopilot_configs') {
            await pool.query(`UPDATE autopilot_configs SET flow_graph = $1 WHERE id = 'e2ccd8d7-354e-4bc1-9cef-4e061254c9a1'`, [graph]);
        } else {
            const saRes = await pool.query(`SELECT ac.id FROM system_agents sa JOIN autopilot_configs ac ON sa.autopilot_config_id = ac.id WHERE sa.id = 'e2ccd8d7-354e-4bc1-9cef-4e061254c9a1'`);
            await pool.query(`UPDATE autopilot_configs SET flow_graph = $1 WHERE id = $2`, [graph, saRes.rows[0].id]);
        }
        console.log("Graph updated successfully.");
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
