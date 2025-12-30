import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

declare global {
  // eslint-disable-next-line no-var
  var __otelSdk: NodeSDK | undefined;
}

function resolveOtelUrl(base: string | undefined, suffix: string) {
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}${suffix}`;
}

export async function registerNodeInstrumentation() {
  if (globalThis.__otelSdk) {
    return;
  }

  const diagLevel = process.env.OTEL_DIAG_LOG_LEVEL;
  const normalizedDiag = diagLevel?.toUpperCase();
  if (normalizedDiag && normalizedDiag in DiagLogLevel) {
    diag.setLogger(
      new DiagConsoleLogger(),
      DiagLogLevel[normalizedDiag as keyof typeof DiagLogLevel]
    );
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'dialogy';
  const serviceVersion = process.env.OTEL_SERVICE_VERSION || process.env.npm_package_version || 'unknown';
  const environment = process.env.OTEL_ENVIRONMENT || process.env.NODE_ENV || 'development';

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
  });

  const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const otlpTracesUrl =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || resolveOtelUrl(otlpBase, '/v1/traces');
  const otlpMetricsUrl =
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT || resolveOtelUrl(otlpBase, '/v1/metrics');

  let traceExporter: OTLPTraceExporter | undefined;
  if (otlpTracesUrl) {
    traceExporter = new OTLPTraceExporter({ url: otlpTracesUrl });
  } else if (process.env.JAEGER_ENDPOINT) {
    try {
      const jaegerModulePath: string = '@opentelemetry/exporter-jaeger';
      const jaegerModule = await import(jaegerModulePath);
      const JaegerExporter = (jaegerModule as any).JaegerExporter;
      if (JaegerExporter) {
        traceExporter = new JaegerExporter({
          endpoint: process.env.JAEGER_ENDPOINT,
        });
      }
    } catch (error) {
      console.warn('[OTEL] Jaeger exporter not available, skipping trace export.', error);
    }
  }

  let metricReader: PeriodicExportingMetricReader | undefined;
  if (otlpMetricsUrl) {
    try {
      const metricsModulePath: string = '@opentelemetry/exporter-metrics-otlp-http';
      const metricsModule = await import(metricsModulePath);
      const OTLPMetricExporter = (metricsModule as any).OTLPMetricExporter;
      if (OTLPMetricExporter) {
        metricReader = new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: otlpMetricsUrl }),
          exportIntervalMillis: Number(process.env.OTEL_METRICS_EXPORT_INTERVAL_MS || '10000'),
        });
      }
    } catch (error) {
      console.warn('[OTEL] Metrics exporter not available, skipping metrics export.', error);
    }
  }

  const sdk = new NodeSDK({
    resource,
    ...(traceExporter ? { traceExporter } : {}),
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  globalThis.__otelSdk = sdk;

  await sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch((error) => {
      console.error('[OTEL] Failed to shut down SDK', error);
    });
  });
}
