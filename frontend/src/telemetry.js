// Browser tracing. Imported first in main.jsx.
//
// The page load and every fetch() the app makes (api/client.js is untouched)
// become spans, and `traceparent` is added to same-origin requests. The trace
// therefore starts in the user's browser and continues through the Gateway,
// the Go backend and Postgres, instead of starting at Envoy.
//
// Spans are exported to a RELATIVE url (/otlp/v1/traces). The Gateway routes
// that one exact path to the Collector, so there is no CORS and the browser
// never learns the Collector's address.
//
// Telemetry must never break the page: everything is off unless
// VITE_OTEL_ENABLED=true at build time, and any failure is swallowed.
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';

const TRACES_PATH = '/otlp/v1/traces';

export function initTelemetry(env = import.meta.env) {
  if (env.VITE_OTEL_ENABLED !== 'true') return false;

  try {
    const ratio = Number(env.VITE_OTEL_SAMPLE_RATIO ?? 1);

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({
        'service.name': 'devboard-frontend',
        'service.version': env.VITE_APP_VERSION ?? 'dev',
        'deployment.environment': env.VITE_OTEL_ENVIRONMENT ?? 'dev',
      }),
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(Number.isFinite(ratio) ? ratio : 1),
      }),
      // Batch, never sync: export happens off the main path.
      spanProcessors: [
        new BatchSpanProcessor(new OTLPTraceExporter({ url: TRACES_PATH })),
      ],
    });

    // Zone-based context keeps the active span across await/promise boundaries.
    provider.register({ contextManager: new ZoneContextManager() });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          // Same-origin only: traceparent is sent to /api, never to third parties.
          // The exporter's own POST must not be traced, or it traces itself.
          ignoreUrls: [/\/otlp\//],
        }),
      ],
    });
    return true;
  } catch (err) {
    console.warn('[telemetry] disabled:', err);
    return false;
  }
}

initTelemetry();
