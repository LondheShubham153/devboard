# 04 — Gateway API (Envoy Gateway)

The Gateway API is the modern replacement for Ingress:
- **GatewayClass** — which controller handles gateways (set once)
- **Gateway** — a load balancer + listener (creates an AWS NLB)
- **HTTPRoute** — routing rules (send `/` here, `/api/ai` there)

The Gateway and HTTPRoute ship *with the app* (in `k8s/` and the Helm chart), so
here you only install the controller and the GatewayClass.

## Install Envoy Gateway

```bash
helm install eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.2.1 -n envoy-gateway-system --create-namespace
kubectl -n envoy-gateway-system rollout status deploy/envoy-gateway
```
(Check the [releases](https://github.com/envoyproxy/gateway/releases) for a newer
version. Installing Envoy Gateway also installs the Gateway API CRDs.)

## Create the GatewayClass

```bash
kubectl apply -f gitops/gateway/gatewayclass.yaml
kubectl get gatewayclass envoy        # ACCEPTED=True
```

## Get the Load Balancer URL from AWS

```bash
kubectl get svc -n envoy-gateway-system
```
This will give you the services from the envoy-gateway-system and the service LoadBalancer will have the AWS NLB URL

Next: [05-argocd.md](05-argocd.md)
