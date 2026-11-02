import { describe, expect, it } from 'vitest';
import { initTelemetry } from './telemetry.js';

describe('initTelemetry', () => {
  it('is a no-op unless explicitly enabled', () => {
    expect(initTelemetry({})).toBe(false);
    expect(initTelemetry({ VITE_OTEL_ENABLED: 'false' })).toBe(false);
  });

  it('does not throw when enabled', () => {
    expect(() => initTelemetry({ VITE_OTEL_ENABLED: 'true' })).not.toThrow();
  });
});
