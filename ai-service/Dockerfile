FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# Wheels only: a source distribution would run its setup.py during the build.
# Bootstrap detects every installed library and emits the matching instrumentation
# packages as pinned requirements. It runs at build time, never at container start.
RUN pip install --no-cache-dir --only-binary :all: -r requirements.txt \
    && opentelemetry-bootstrap -a requirements > otel-requirements.txt \
    && pip install --no-cache-dir --only-binary :all: -r otel-requirements.txt

COPY app ./app

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 3005

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD curl -fsS http://localhost:3005/health || exit 1

# --threads 32: gthread holds a thread for a whole SSE stream, and a full pool stops /health.
CMD ["opentelemetry-instrument", \
     "gunicorn", "--bind", "0.0.0.0:3005", "--workers", "1", "--threads", "32", \
     "--timeout", "600", "--access-logfile", "-", "--error-logfile", "-", "app.main:app"]
