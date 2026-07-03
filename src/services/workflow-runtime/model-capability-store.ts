import type { Pool } from 'pg';
import { ModelCapabilityProfileSchema } from './schemas';
import type { ModelCapabilityProfile } from './types';

type Queryable = Pick<Pool, 'query'>;

export class ModelCapabilityStore {
  constructor(private readonly database: Queryable) {}

  async get(provider: string, model: string): Promise<ModelCapabilityProfile | null> {
    const result = await this.database.query(
      `SELECT model, tool_calling, structured_output, streaming,
              recommended_max_tools, recommended_context_size, last_evaluated_at
       FROM workflow_model_capabilities
       WHERE provider = $1 AND model = $2
       LIMIT 1`,
      [provider, model],
    );
    const row = result.rows[0];
    if (!row) return null;
    return ModelCapabilityProfileSchema.parse({
      model: row.model,
      toolCalling: row.tool_calling,
      structuredOutput: row.structured_output,
      streaming: row.streaming,
      recommendedMaxTools: Number(row.recommended_max_tools),
      recommendedContextSize: Number(row.recommended_context_size),
      lastEvaluatedAt: new Date(row.last_evaluated_at).toISOString(),
    });
  }

  async list(provider: string): Promise<ModelCapabilityProfile[]> {
    const result = await this.database.query(
      `SELECT model, tool_calling, structured_output, streaming,
              recommended_max_tools, recommended_context_size, last_evaluated_at
       FROM workflow_model_capabilities
       WHERE provider = $1
       ORDER BY model`,
      [provider],
    );
    return result.rows.map((row) => ModelCapabilityProfileSchema.parse({
      model: row.model,
      toolCalling: row.tool_calling,
      structuredOutput: row.structured_output,
      streaming: row.streaming,
      recommendedMaxTools: Number(row.recommended_max_tools),
      recommendedContextSize: Number(row.recommended_context_size),
      lastEvaluatedAt: new Date(row.last_evaluated_at).toISOString(),
    }));
  }

  async upsert(
    provider: string,
    rawProfile: ModelCapabilityProfile,
    evaluationMetadata: Record<string, unknown> = {},
  ): Promise<ModelCapabilityProfile> {
    const profile = ModelCapabilityProfileSchema.parse(rawProfile);
    await this.database.query(
      `INSERT INTO workflow_model_capabilities (
         provider, model, tool_calling, structured_output, streaming,
         recommended_max_tools, recommended_context_size, evaluation_metadata,
         last_evaluated_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, clock_timestamp())
       ON CONFLICT (provider, model) DO UPDATE
       SET tool_calling = EXCLUDED.tool_calling,
           structured_output = EXCLUDED.structured_output,
           streaming = EXCLUDED.streaming,
           recommended_max_tools = EXCLUDED.recommended_max_tools,
           recommended_context_size = EXCLUDED.recommended_context_size,
           evaluation_metadata = EXCLUDED.evaluation_metadata,
           last_evaluated_at = EXCLUDED.last_evaluated_at,
           updated_at = clock_timestamp()`,
      [
        provider,
        profile.model,
        profile.toolCalling,
        profile.structuredOutput,
        profile.streaming,
        profile.recommendedMaxTools,
        profile.recommendedContextSize,
        JSON.stringify(evaluationMetadata),
        profile.lastEvaluatedAt,
      ],
    );
    return profile;
  }
}

