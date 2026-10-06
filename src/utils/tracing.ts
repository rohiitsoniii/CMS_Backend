let otelSDK: any = null;

// Initialize the SDK
export const initTracing = () => {
  if (process.env.ENABLE_TRACING === 'true') {
    try {
      // Dynamic imports or lazy creation
      const { NodeSDK } = require('@opentelemetry/sdk-node');
      const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
      const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

      const traceExporter = new OTLPTraceExporter({
        url: process.env.OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      });

      otelSDK = new NodeSDK({
        traceExporter,
        instrumentations: [getNodeAutoInstrumentations()],
      });

      otelSDK.start();
      console.log('✅ OpenTelemetry tracing initialized');

      process.on('SIGTERM', () => {
        otelSDK
          ?.shutdown()
          .then(() => console.log('Tracing terminated'))
          .catch((error: any) => console.log('Error terminating tracing', error));
      });
    } catch (err: any) {
      console.warn('⚠️ OpenTelemetry tracing failed to initialize:', err.message);
    }
  }
};

export { otelSDK };
