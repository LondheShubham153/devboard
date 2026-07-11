#!/bin/bash

set -e
set -o pipefail

echo "Starting installation..."

# ---------------------------------------
# Install Docker
# ---------------------------------------
# Checks if Docker is installed.
# If not, installs Docker and adds the
# current user to the docker group.
# Run 'newgrp docker' or re-login after this.
if ! command -v docker &>/dev/null; then
    sudo apt-get update -y
    sudo apt-get install -y docker.io
    sudo usermod -aG docker "$USER"
    sudo newgrp docker
fi

# ---------------------------------------
# Install Kind
# ---------------------------------------
if ! command -v kind &>/dev/null; then
    ARCH=$(uname -m)
    [ "$ARCH" = "x86_64" ] && URL="https://kind.sigs.k8s.io/dl/v0.29.0/kind-linux-amd64"
    [ "$ARCH" = "aarch64" ] && URL="https://kind.sigs.k8s.io/dl/v0.29.0/kind-linux-arm64"
    [ -z "$URL" ] && echo "Unsupported architecture: $ARCH" && exit 1
    curl -Lo kind "$URL"
    chmod +x kind
    sudo mv kind /usr/local/bin/
fi

# ---------------------------------------
# Install kubectl
# ---------------------------------------
if ! command -v kubectl &>/dev/null; then
    VERSION=$(curl -Ls https://dl.k8s.io/release/stable.txt)
    ARCH=$(uname -m)
    [ "$ARCH" = "x86_64" ] && URL="https://dl.k8s.io/release/${VERSION}/bin/linux/amd64/kubectl"
    [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ] && URL="https://dl.k8s.io/release/${VERSION}/bin/linux/arm64/kubectl"
    [ -z "$URL" ] && echo "Unsupported architecture: $ARCH" && exit 1
    curl -Lo kubectl "$URL"
    chmod +x kubectl
    sudo mv kubectl /usr/local/bin/
fi

echo
echo "Installed Versions:"
docker --version
kind --version
kubectl version --client

echo
echo "Installation completed successfully."

