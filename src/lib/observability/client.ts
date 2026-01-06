type ClientErrorInput = {
  message: string;
  stack?: string;
  component?: string;
  context?: Record<string, unknown>;
};

export function reportClientError(input: ClientErrorInput) {
  void input;
}

export function reportClientMetric(
  name: string,
  durationMs: number,
  context?: Record<string, unknown>
) {
  void name;
  void durationMs;
  void context;
}
