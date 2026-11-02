// OpenTelemetry wiring for the Go backend.
//
// Compare this file with ai-service/Dockerfile, where the same three signals
// cost ONE WORD on the CMD line (`opentelemetry-instrument`). Python can do
// that because it can rewrite functions at runtime; Go compiles to a static
// binary, so there is nothing to monkey-patch and you wire the SDK yourself.
//
// Neither approach is simply better, and that trade-off is the lesson of
// chapter 12:
//
//   Python's magic is invisible when it works — and invisible when it breaks.
//   ("Why are there no spans?" has no stack trace.)
//
//   This is explicit and greppable. It is also 60 lines you have to maintain,
//   and it is why every function below takes a context.Context.
package main

import (
	"context"
	"log"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// initTracing configures the global tracer provider and returns a shutdown
// function. Call the shutdown on the way out so buffered spans are flushed.
//
// Telemetry must never take the application down. If the Collector is missing,
// unreachable, or misconfigured, this logs once and returns a no-op shutdown —
// the API keeps serving traffic, untraced. An observability stack that can
// cause an outage is worse than no observability stack.
func initTracing(ctx context.Context) func() {
	// Endpoint, headers and protocol all come from OTEL_EXPORTER_OTLP_*
	// environment variables. Nothing is hardcoded, so the same binary runs
	// traced in the cluster and untraced on a laptop.
	exp, err := otlptracegrpc.New(ctx)
	if err != nil {
		log.Printf("[backend] tracing disabled: %v", err)
		return func() {}
	}

	// resource.WithFromEnv() reads OTEL_SERVICE_NAME and
	// OTEL_RESOURCE_ATTRIBUTES. Those attributes are what let Tempo tell the
	// raw stack's backend apart from the Helm stack's backend — without them
	// both report as "backend" and the traces interleave.
	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithTelemetrySDK(),
		resource.WithProcess(),
	)
	if err != nil {
		log.Printf("[backend] tracing resource incomplete: %v", err)
	}

	tp := sdktrace.NewTracerProvider(
		// Batch, never sync. The exporter runs on a background goroutine, so a
		// slow or dead Collector adds zero latency to a request.
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	// The two most important lines in this file.
	//
	// W3C traceparent is the wire format Envoy sends and the Python service
	// forwards. Without this propagator the backend IGNORES the incoming
	// header and starts a brand new trace on every request — so the waterfall
	// breaks in half and the backend's spans float off as their own root
	// traces. It is the classic "why are my traces disconnected" bug, and the
	// symptom (lots of tiny valid-looking traces) does not look like an error.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return func() {
		// On SIGTERM, flush whatever is still buffered. Without this you lose
		// the spans from the last few seconds of a pod's life — which are
		// exactly the ones you want when a pod is being killed.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tp.Shutdown(shutdownCtx); err != nil {
			log.Printf("[backend] tracing shutdown: %v", err)
		}
	}
}
