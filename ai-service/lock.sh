#!/usr/bin/env bash
# Regenerate the hashed lock files. Run after editing requirements.txt:
#   ./lock.sh
#
# Bootstrap runs HERE, not at image build: it scans the installed libraries and
# emits the matching opentelemetry-instrumentation-* requirements, which are
# added to the lock with hashes. The image then installs only from the lock
# (--require-hashes), so builds are reproducible and nothing runs setup scripts.
set -euo pipefail
cd "$(dirname "$0")"

docker run --rm -v "$PWD":/work -w /work python:3.13-slim bash -euc '
  pip install -q --no-cache-dir pip-tools -r requirements.txt
  opentelemetry-bootstrap -a requirements > /tmp/otel.in
  cat requirements.txt /tmp/otel.in > /tmp/runtime.in
  printf "pytest\nruff\npip-audit\n" > /tmp/dev-extra.in

  pip-compile -q --generate-hashes --strip-extras --no-header --allow-unsafe \
    --output-file requirements.lock /tmp/runtime.in
  cat /tmp/runtime.in /tmp/dev-extra.in > /tmp/dev.in
  pip-compile -q --generate-hashes --strip-extras --no-header --allow-unsafe \
    --output-file requirements-dev.lock /tmp/dev.in
'
echo "wrote requirements.lock and requirements-dev.lock"
