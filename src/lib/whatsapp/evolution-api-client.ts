import { resilientFetch } from '@/lib/http/resilient-fetch';

export type EvolutionApiClientConfig = {
  api_url: string;
  api_key: string;
};

export async function fetchEvolutionAPI(
  endpoint: string,
  apiConfig: EvolutionApiClientConfig,
  options: RequestInit = {}
): Promise<any> {
  if (!apiConfig.api_url || !apiConfig.api_key) {
    throw new Error('A configuracao da API (URL e Chave) e necessaria.');
  }

  const baseUrl = apiConfig.api_url.endsWith('/')
    ? apiConfig.api_url.slice(0, -1)
    : apiConfig.api_url;
  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await resilientFetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: apiConfig.api_key,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Evolution API Error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.error(`[EVO_API_FETCH] Erro de rede ou sistema ao chamar a API Evolution. URL: ${url}. Erro:`, error);
    throw error;
  }
}
