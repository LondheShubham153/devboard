# DevBoard — EKS Deployment Guide

Complete step-by-step guide for deploying DevBoard to production on AWS EKS.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [1. AWS Account Setup](#1-aws-account-setup)
- [2. Terraform — Provision Infrastructure](#2-terraform--provision-infrastructure)
- [3. ECR — Push Container Images](#3-ecr--push-container-images)
- [4. Database — Initialize RDS](#4-database--initialize-rds)
- [5. Kubernetes — Deploy Application](#5-kubernetes--deploy-application)
- [6. DNS & HTTPS](#6-dns--https)
- [7. Verification](#7-verification)
- [8. Scaling](#8-scaling)
- [9. Monitoring & Observability](#9-monitoring--observability)
- [10. Rollback](#10-rollback)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Command Reference](#12-command-reference)

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| AWS CLI | v2.x | AWS authentication & ECR login |
| kubectl | v1.31+ | Kubernetes management |
| Terraform | v1.9+ | Infrastructure provisioning |
| Helm | v3.x | Kubernetes package management |
| Docker | 24+ | Image building |
| psql | 17+ | Database initialization |

### Install prerequisites

```bash
# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# kubectl
curl -LO "https://dl.k8s.io/release/v1.31.0/bin/linux/amd64/kubectl"
chmod +x kubectl && sudo mv kubectl /usr/local/bin/

# Terraform
wget https://releases.hashicorp.com/terraform/1.9.0/terraform_1.9.0_linux_amd64.zip
unzip terraform_1.9.0_linux_amd64.zip && sudo mv terraform /usr/local/bin/

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

## 1. AWS Account Setup

### Configure AWS CLI

```bash
aws configure
# AWS Access Key ID: <YOUR_ACCESS_KEY>
# AWS Secret Access Key: <YOUR_SECRET_KEY>
# Default region name: <AWS_REGION>
# Default output format: json

# Verify
aws sts get-caller-identity
```

### Required IAM Permissions

The user/role running Terraform needs:
- `AmazonEKSClusterPolicy`
- `AmazonEKSServicePolicy`
- `AmazonEC2FullAccess` (or scoped EC2/VPC/SG permissions)
- `AmazonRDSFullAccess` (or scoped RDS permissions)
- `AmazonECR*` permissions
- `IAMFullAccess` (or scoped IAM role/policy creation)
- `ElasticLoadBalancing*` permissions

---

## 2. Terraform — Provision Infrastructure

### Configure variables

```bash
cd terraform/

# Edit production values
cp environments/production.tfvars environments/production.tfvars.local
vi environments/production.tfvars.local
```

> **Important**: Set `db_password` via environment variable, not in the tfvars file:
> ```bash
> export TF_VAR_db_password="your-secure-password-here"
> ```

### Initialize and apply

```bash
# Initialize Terraform
terraform init

# Review the plan
terraform plan -var-file=environments/production.tfvars

# Apply (this takes ~15-20 minutes)
terraform apply -var-file=environments/production.tfvars
```

### Configure kubectl

```bash
# The command is output by Terraform
aws eks update-kubeconfig \
  --region <AWS_REGION> \
  --name devboard-production

# Verify
kubectl cluster-info
kubectl get nodes
```

---

## 3. ECR — Push Container Images

### Login to ECR

```bash
aws ecr get-login-password --region <AWS_REGION> | \
  docker login --username AWS --password-stdin \
  <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
```

### Build and push images

```bash
# Set variables
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AWS_REGION=<AWS_REGION>
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_TAG=$(git rev-parse --short HEAD)

# Backend
docker build -t ${ECR_REGISTRY}/devboard-backend:${IMAGE_TAG} ./backend/
docker push ${ECR_REGISTRY}/devboard-backend:${IMAGE_TAG}

# Frontend
docker build -t ${ECR_REGISTRY}/devboard-frontend:${IMAGE_TAG} ./frontend/
docker push ${ECR_REGISTRY}/devboard-frontend:${IMAGE_TAG}

# Verify
aws ecr describe-images --repository-name devboard-backend --region ${AWS_REGION}
aws ecr describe-images --repository-name devboard-frontend --region ${AWS_REGION}
```

---

## 4. Database — Initialize RDS

### Get RDS endpoint

```bash
# From Terraform output
terraform output rds_endpoint
terraform output -raw postgres_url
```

### Run initialization scripts

```bash
export RDS_HOST=$(terraform output -raw rds_hostname)
export DB_PASSWORD=${TF_VAR_db_password}

# Create schema
psql "postgres://devboard:${DB_PASSWORD}@${RDS_HOST}:5432/devboard?sslmode=require" \
  -f init/postgres/01_schema.sql

# Seed data (optional for production)
psql "postgres://devboard:${DB_PASSWORD}@${RDS_HOST}:5432/devboard?sslmode=require" \
  -f init/postgres/02_seed.sql
```

---

## 5. Kubernetes — Deploy Application

### Update secrets with real values

```bash
# Generate the base64-encoded POSTGRES_URL
export POSTGRES_URL=$(terraform output -raw postgres_url)
echo -n "${POSTGRES_URL}" | base64

# Edit k8s/secret.yaml and replace the placeholder with the real base64 value
```

### Update image tags

```bash
# Edit k8s/backend/deployment.yaml and k8s/frontend/deployment.yaml
# Replace <AWS_ACCOUNT_ID>, <AWS_REGION>, and <TAG> with actual values
```

### Apply manifests

```bash
# Dry-run validation
kubectl apply -k k8s/ --dry-run=client

# Apply all resources
kubectl apply -k k8s/

# Or apply in order
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/backend/serviceaccount.yaml
kubectl apply -f k8s/frontend/serviceaccount.yaml
kubectl apply -f k8s/rbac/
kubectl apply -f k8s/backend/deployment.yaml
kubectl apply -f k8s/backend/service.yaml
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml
kubectl apply -f k8s/ingress/ingress.yaml
kubectl apply -f k8s/backend/hpa.yaml
kubectl apply -f k8s/frontend/hpa.yaml
kubectl apply -f k8s/backend/pdb.yaml
kubectl apply -f k8s/frontend/pdb.yaml
```

### Verify deployment

```bash
# Wait for rollout
kubectl rollout status deployment/backend -n devboard-prod --timeout=120s
kubectl rollout status deployment/frontend -n devboard-prod --timeout=120s

# Check pods
kubectl get pods -n devboard-prod -o wide

# Check services
kubectl get svc -n devboard-prod

# Check ingress (ALB creation takes ~3-5 minutes)
kubectl get ingress -n devboard-prod
```

---

## 6. DNS & HTTPS

### Get ALB DNS name

```bash
kubectl get ingress devboard-ingress -n devboard-prod \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

### Configure Route 53

1. Go to AWS Route 53 console
2. Select your hosted zone for `<DOMAIN_NAME>`
3. Create an **A record** with **Alias** pointing to the ALB
4. Or use the CLI:

```bash
# Create alias record
aws route53 change-resource-record-sets \
  --hosted-zone-id <HOSTED_ZONE_ID> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "<DOMAIN_NAME>",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "<ALB_HOSTED_ZONE_ID>",
          "DNSName": "<ALB_DNS_NAME>",
          "EvaluateTargetHealth": true
        }
      }
    }]
  }'
```

### ACM Certificate

If you haven't created a certificate yet:

```bash
aws acm request-certificate \
  --domain-name <DOMAIN_NAME> \
  --validation-method DNS \
  --region <AWS_REGION>

# Complete DNS validation, then update k8s/ingress/ingress.yaml with the ARN
```

---

## 7. Verification

### Health checks

```bash
# Backend health (via port-forward)
kubectl port-forward svc/backend 8080:8080 -n devboard-prod &
curl http://localhost:8080/health
# Expected: {"status":"ok","service":"backend"}

# Frontend (via port-forward)
kubectl port-forward svc/frontend 8081:80 -n devboard-prod &
curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/
# Expected: 200

# Via ALB (after DNS)
curl https://<DOMAIN_NAME>/
curl https://<DOMAIN_NAME>/api/health
curl https://<DOMAIN_NAME>/api/projects
```

### HPA

```bash
kubectl get hpa -n devboard-prod
# Ensure TARGETS show actual values (not <unknown>)
# If <unknown>, verify Metrics Server is running:
kubectl get deployment metrics-server -n kube-system
kubectl top pods -n devboard-prod
```

### ALB

```bash
# Check ALB was created
kubectl get ingress -n devboard-prod
# ADDRESS column should show the ALB DNS name

# Check target group health in AWS console or:
aws elbv2 describe-target-health \
  --target-group-arn <TARGET_GROUP_ARN>
```

---

## 8. Scaling

### HPA (Pod autoscaling)

```bash
# View current HPA status
kubectl get hpa -n devboard-prod

# Manually scale (overrides HPA temporarily)
kubectl scale deployment/backend --replicas=4 -n devboard-prod

# Load test to trigger HPA
# Use a tool like k6, hey, or wrk
```

### Karpenter (Node autoscaling)

```bash
# View Karpenter logs
kubectl logs -l app.kubernetes.io/name=karpenter -n kube-system

# View provisioned nodes
kubectl get nodes -l managed-by=karpenter

# View NodePool status
kubectl get nodepool
```

---

## 9. Monitoring & Observability

### Recommended monitoring stack

| Component | Tool | Purpose |
|-----------|------|---------|
| Metrics | Prometheus + Grafana | CPU, memory, request rates |
| Logging | CloudWatch Logs / Loki | Application & system logs |
| Tracing | AWS X-Ray / OpenTelemetry | Request tracing |
| Alerts | Prometheus Alertmanager | Critical event notification |

### Application logs

```bash
# Backend logs
kubectl logs -l app=backend -n devboard-prod -f

# Frontend (nginx) logs
kubectl logs -l app=frontend -n devboard-prod -f

# Previous container logs (after crash)
kubectl logs <pod-name> -n devboard-prod --previous
```

### Key metrics to monitor

- Pod CPU/memory usage vs requests/limits
- Pod restart count
- HPA scaling events
- HTTP 5xx error rate
- Request latency (P50, P95, P99)
- Database connection pool usage
- ALB healthy/unhealthy target count
- Node count and utilization

---

## 10. Rollback

### Quick rollback

```bash
# View rollout history
kubectl rollout history deployment/backend -n devboard-prod
kubectl rollout history deployment/frontend -n devboard-prod

# Rollback to previous revision
kubectl rollout undo deployment/backend -n devboard-prod
kubectl rollout undo deployment/frontend -n devboard-prod

# Rollback to a specific revision
kubectl rollout undo deployment/backend -n devboard-prod --to-revision=2

# Verify rollback
kubectl rollout status deployment/backend -n devboard-prod
kubectl get pods -n devboard-prod
```

### CI/CD rollback

Use the manual `workflow_dispatch` trigger on `eks-deploy.yml` with a known-good image tag.

---

## 11. Troubleshooting

### ImagePullBackOff

```bash
# Check pod events
kubectl describe pod <pod-name> -n devboard-prod

# Common causes:
# 1. ECR authentication expired → re-login to ECR
# 2. Image tag doesn't exist → verify with: aws ecr describe-images
# 3. Node IAM role missing ECR permissions → check node IAM role
```

### CrashLoopBackOff

```bash
# Check logs
kubectl logs <pod-name> -n devboard-prod --previous

# Common causes:
# 1. POSTGRES_URL not set or wrong → check secret
# 2. RDS not reachable → check security groups
# 3. Database not initialized → run init SQL
```

### Pods stuck in Pending

```bash
kubectl describe pod <pod-name> -n devboard-prod

# Common causes:
# 1. Insufficient node resources → check Karpenter logs, node capacity
# 2. TopologySpreadConstraints unsatisfiable → need nodes in more AZs
# 3. PDB blocking scheduling → check PDB status
```

### ALB not created

```bash
# Check ALB controller logs
kubectl logs -l app.kubernetes.io/name=aws-load-balancer-controller -n kube-system

# Common causes:
# 1. ALB controller not installed → check Helm release
# 2. Ingress annotations incorrect → verify annotations
# 3. Subnet tagging missing → check VPC subnet tags
# 4. IAM permissions insufficient → check IRSA role
```

### HPA showing `<unknown>`

```bash
# Check Metrics Server
kubectl get deployment metrics-server -n kube-system
kubectl logs -l app=metrics-server -n kube-system

# Common causes:
# 1. Metrics Server not installed
# 2. Resource requests not set on deployment (required for CPU %)
# 3. Metrics Server can't reach kubelet → check security groups
```

### Database connectivity

```bash
# Test from within the cluster
kubectl run db-test --rm -it --image=postgres:17-alpine -n devboard-prod -- \
  psql "postgres://devboard:<password>@<rds-endpoint>:5432/devboard?sslmode=require"

# Common causes:
# 1. Security group not allowing EKS → RDS traffic
# 2. Wrong POSTGRES_URL in secret
# 3. RDS not in the same VPC/subnets
```

### ECR authentication failure

```bash
# Re-authenticate
aws ecr get-login-password --region <AWS_REGION> | \
  docker login --username AWS --password-stdin \
  <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com

# For EKS nodes, ensure the node IAM role has:
# - AmazonEC2ContainerRegistryReadOnly policy
```

### DNS issues

```bash
# Verify ALB is healthy
kubectl get ingress -n devboard-prod

# Test DNS resolution
nslookup <DOMAIN_NAME>
dig <DOMAIN_NAME>

# Verify Route 53 record
aws route53 list-resource-record-sets --hosted-zone-id <ZONE_ID> \
  --query "ResourceRecordSets[?Name == '<DOMAIN_NAME>.']"
```

---

## 12. Command Reference

### Daily operations

```bash
# Check cluster health
kubectl get nodes
kubectl get pods -n devboard-prod
kubectl get hpa -n devboard-prod
kubectl top pods -n devboard-prod
kubectl top nodes

# View logs
kubectl logs -l app=backend -n devboard-prod --tail=100 -f
kubectl logs -l app=frontend -n devboard-prod --tail=100 -f

# Restart a deployment (rolling restart)
kubectl rollout restart deployment/backend -n devboard-prod

# Scale manually
kubectl scale deployment/backend --replicas=4 -n devboard-prod

# Port-forward for debugging
kubectl port-forward svc/backend 8080:8080 -n devboard-prod
kubectl port-forward svc/frontend 8081:80 -n devboard-prod

# Shell into a pod
kubectl exec -it <pod-name> -n devboard-prod -- /bin/sh
```

### Infrastructure

```bash
# Terraform
cd terraform/
terraform plan -var-file=environments/production.tfvars
terraform apply -var-file=environments/production.tfvars
terraform output

# ECR
aws ecr describe-repositories --region <AWS_REGION>
aws ecr describe-images --repository-name devboard-backend --region <AWS_REGION>

# EKS
aws eks describe-cluster --name devboard-production --region <AWS_REGION>
aws eks list-nodegroups --cluster-name devboard-production --region <AWS_REGION>
```

