# DevBoard — Complete Step-by-Step EKS Deployment Guide

This guide provides an end-to-end, copy-paste-ready deployment procedure for running **DevBoard** on **Amazon EKS**.

Every step explicitly states:
- **Where to run**: The exact directory or machine.
- **Which command**: The exact command to execute.
- **Expected output**: What success looks like.
- **How to verify**: Verification check before moving forward.

---

## Architecture Overview

```
                                    Internet
                                       │
                                       ▼
                              Route 53 (DNS / A Alias)
                                       │
                                       ▼
                       AWS ALB (HTTPS:443 / SSL Redirect)
                                       │
                                       ▼
                   AWS Load Balancer Controller (Ingress: devboard-ingress)
                                       │
                                       ▼
                 Frontend Service (ClusterIP :80 ──► TargetPort :8080)
                                       │
                                       ▼
                Frontend Pods (nginx-unprivileged :8080 - Static Assets)
                                       │
                              (Internal proxy /api/*)
                                       │
                                       ▼
                  Backend Service (ClusterIP :8080 ──► TargetPort :8080)
                                       │
                                       ▼
                     Backend Pods (Go / Gin REST API :8080)
                                       │
                                (Port :5432 TCP)
                                       │
                                       ▼
                   Amazon RDS PostgreSQL 17 (Private Subnet)
```

---

## Deployment Checklist & Flow

| Phase | Description | Working Directory | Estimated Time |
|---|---|---|---|
| **Step 0** | Install CLI Tools | Local Machine | 5 mins |
| **Step 1** | AWS Authentication & Variables | Project Root (`/data/project/devboard`) | 2 mins |
| **Step 2** | Provision AWS Infrastructure (Terraform) | `terraform/` | 15–20 mins |
| **Step 3** | Configure `kubectl` & Verify EKS Nodes | Project Root (`/data/project/devboard`) | 2 mins |
| **Step 4** | Build & Push Container Images to ECR | Project Root (`/data/project/devboard`) | 5 mins |
| **Step 5** | Initialize RDS PostgreSQL Database | Project Root (`/data/project/devboard`) | 2 mins |
| **Step 6** | Deploy Kubernetes Manifests | Project Root (`/data/project/devboard`) | 3 mins |
| **Step 7** | Verify AWS Load Balancer & Ingress | Project Root (`/data/project/devboard`) | 3 mins |
| **Step 8** | Configure DNS (Route 53) & HTTPS (ACM) | AWS CLI / Console | 5 mins |
| **Step 9** | End-to-End Smoke Testing | Local Machine | 2 mins |
| **Step 10** | Verify Autoscaling (HPA + Karpenter) | Project Root (`/data/project/devboard`) | 3 mins |
| **Step 11** | Zero-Downtime Rollback (If needed) | Project Root (`/data/project/devboard`) | 1 min |

---

## Step 0: Install Required CLI Tools

> **Where to run:** Local Machine (Terminal)

Ensure you have the following installed on your workstation:
- **AWS CLI** (v2.x)
- **kubectl** (v1.31+)
- **Terraform** (v1.9+)
- **Docker** (v24+)
- **psql** (v17+)

### Verification Commands:
```bash
aws --version
kubectl version --client
terraform version
docker --version
psql --version
```

---

## Step 1: AWS Authentication & Variable Setup

> **Where to run:** Project Root (`/data/project/devboard`)

### 1.1 Configure AWS Credentials
Run AWS configure with credentials that have Administrator or EKS/VPC/IAM/RDS deployment privileges:

```bash
aws configure
# AWS Access Key ID: <YOUR_AWS_ACCESS_KEY_ID>
# AWS Secret Access Key: <YOUR_AWS_SECRET_ACCESS_KEY>
# Default region name: us-east-1  (or your chosen region)
# Default output format: json
```

Verify your identity:
```bash
aws sts get-caller-identity
```

### 1.2 Export Common Environment Variables
Set shell variables for your active terminal session:

```bash
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_TAG=$(git rev-parse --short HEAD || echo "v1.0.0")
export TF_VAR_db_password="GenerateAStrongPassword123!"

echo "Account ID:   $AWS_ACCOUNT_ID"
echo "Region:       $AWS_REGION"
echo "ECR Registry: $ECR_REGISTRY"
echo "Image Tag:    $IMAGE_TAG"
```

---

## Step 2: Provision Infrastructure with Terraform

> **Where to run:** `terraform/` subdirectory (`cd /data/project/devboard/terraform`)

This provisions:
- VPC with 2 public & 2 private subnets across 2 AZs + NAT Gateway + Internet Gateway
- EKS Cluster (v1.31) with OIDC provider
- Managed Node Group (2 x `t3.medium` worker nodes)
- EKS Add-ons (VPC-CNI, CoreDNS, Kube-Proxy, EBS-CSI Driver, Metrics-Server)
- AWS Load Balancer Controller with IRSA
- Karpenter Node Autoscaler with NodePool & EC2NodeClass
- Amazon ECR repositories (`devboard-backend`, `devboard-frontend`)
- Amazon RDS PostgreSQL 17 database in private subnets with strict security groups

### 2.1 Navigate to `terraform/`
```bash
cd /data/project/devboard/terraform
```

### 2.2 Initialize Terraform
```bash
terraform init
```

*Expected output:*
```text
Terraform has been successfully initialized!
```

### 2.3 Review the Execution Plan
```bash
terraform plan -var-file=environments/production.tfvars
```

### 2.4 Apply the Infrastructure
```bash
terraform apply -var-file=environments/production.tfvars -auto-approve
```

*Estimated Duration:* 15–20 minutes.

### 2.5 Inspect Terraform Outputs
```bash
terraform output
```

Capture the outputs into variables for subsequent steps:
```bash
export EKS_CLUSTER_NAME=$(terraform output -raw eks_cluster_name)
export RDS_HOSTNAME=$(terraform output -raw rds_hostname)
export RDS_PORT=$(terraform output -raw rds_port)
export RDS_DB_NAME=$(terraform output -raw rds_database_name)
export POSTGRES_CONN_URL=$(terraform output -raw postgres_url)

echo "Cluster Name: $EKS_CLUSTER_NAME"
echo "RDS Host:     $RDS_HOSTNAME"
```

---

## Step 3: Configure `kubectl` & Verify EKS Cluster

> **Where to run:** Project Root (`/data/project/devboard`)

### 3.1 Return to project root
```bash
cd /data/project/devboard
```

### 3.2 Update Kubeconfig
```bash
aws eks update-kubeconfig --region $AWS_REGION --name $EKS_CLUSTER_NAME
```

*Expected output:*
```text
Updated context arn:aws:eks:us-east-1:123456789012:cluster/devboard-production in ~/.kube/config
```

### 3.3 Verify Cluster Communication and Node Health
```bash
kubectl get nodes -o wide
```

*Expected output:*
```text
NAME                                         STATUS   ROLES    AGE   VERSION   INTERNAL-IP
ip-10-0-1-xxx.ec2.internal                   Ready    <none>   5m    v1.31.x   10.0.1.xxx
ip-10-0-2-xxx.ec2.internal                   Ready    <none>   5m    v1.31.x   10.0.2.xxx
```

### 3.4 Verify System Pods (Addons & Controllers)
```bash
kubectl get pods -n kube-system
```

Verify that the following are running:
- `aws-load-balancer-controller-*`
- `metrics-server-*`
- `karpenter-*`
- `coredns-*`
- `aws-node-*`
- `ebs-csi-*`

---

## Step 4: Build & Push Container Images to Amazon ECR

> **Where to run:** Project Root (`/data/project/devboard`)

### 4.1 Authenticate Docker with Amazon ECR
```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
```

*Expected output:*
```text
Login Succeeded
```

### 4.2 Build and Push Backend Image
```bash
# Build Go backend (multi-stage non-root container)
docker build -t ${ECR_REGISTRY}/devboard-backend:${IMAGE_TAG} ./backend/

# Push to Amazon ECR
docker push ${ECR_REGISTRY}/devboard-backend:${IMAGE_TAG}
```

### 4.3 Build and Push Frontend Image
```bash
# Build Vite/React frontend into unprivileged Nginx image
docker build -t ${ECR_REGISTRY}/devboard-frontend:${IMAGE_TAG} ./frontend/

# Push to Amazon ECR
docker push ${ECR_REGISTRY}/devboard-frontend:${IMAGE_TAG}
```

### 4.4 Verify Images in ECR
```bash
aws ecr list-images --repository-name devboard-backend --region $AWS_REGION
aws ecr list-images --repository-name devboard-frontend --region $AWS_REGION
```

---

## Step 5: Initialize Amazon RDS PostgreSQL Schema

> **Where to run:** Project Root (`/data/project/devboard`)

The database runs in a private subnet and only accepts connections from within the VPC (or via an EKS pod).

### 5.1 Run Schema and Seed Initialization via an Ephemeral Pod
Run a one-time migration pod inside EKS to execute `01_schema.sql` and `02_seed.sql`:

```bash
# Apply schema (creates 'projects' and 'tasks' tables)
kubectl run db-migrate --rm -i --restart=Never \
  --image=postgres:17-alpine \
  --env="PGPASSWORD=${TF_VAR_db_password}" \
  -- psql -h "${RDS_HOSTNAME}" -U devboard -d "${RDS_DB_NAME}" < ./init/postgres/01_schema.sql

# Seed demo data
kubectl run db-seed --rm -i --restart=Never \
  --image=postgres:17-alpine \
  --env="PGPASSWORD=${TF_VAR_db_password}" \
  -- psql -h "${RDS_HOSTNAME}" -U devboard -d "${RDS_DB_NAME}" < ./init/postgres/02_seed.sql
```

*Expected output:*
```text
CREATE TABLE
CREATE TABLE
CREATE FUNCTION
CREATE TRIGGER
INSERT 0 1
INSERT 0 3
pod "db-migrate" deleted
pod "db-seed" deleted
```

---

## Step 6: Deploy Kubernetes Manifests

> **Where to run:** Project Root (`/data/project/devboard`)

### 6.1 Create the Namespace
```bash
kubectl apply -f k8s/namespace.yaml
```

*Expected output:*
```text
namespace/devboard-prod created
```

### 6.2 Inject Real Secrets into `devboard-secrets`
Encode the connection URL and create the secret:

```bash
kubectl create secret generic devboard-secrets \
  --namespace devboard-prod \
  --from-literal=POSTGRES_URL="${POSTGRES_CONN_URL}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 6.3 Deploy Application ConfigMap & RBAC
```bash
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/backend/serviceaccount.yaml
kubectl apply -f k8s/frontend/serviceaccount.yaml
kubectl apply -f k8s/rbac/role.yaml
kubectl apply -f k8s/rbac/rolebinding.yaml
```

### 6.4 Deploy Backend & Frontend Services
```bash
kubectl apply -f k8s/backend/service.yaml
kubectl apply -f k8s/frontend/service.yaml
```

### 6.5 Deploy Workloads with the ECR Image Tag
Substitute your account ID, region, and image tag into the deployments:

```bash
# Deploy Backend
sed -e "s|<AWS_ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
    -e "s|<AWS_REGION>|${AWS_REGION}|g" \
    -e "s|<IMAGE_TAG>|${IMAGE_TAG}|g" \
    k8s/backend/deployment.yaml | kubectl apply -f -

# Deploy Frontend
sed -e "s|<AWS_ACCOUNT_ID>|${AWS_ACCOUNT_ID}|g" \
    -e "s|<AWS_REGION>|${AWS_REGION}|g" \
    -e "s|<IMAGE_TAG>|${IMAGE_TAG}|g" \
    k8s/frontend/deployment.yaml | kubectl apply -f -
```

### 6.6 Deploy Autoscaling Policies (HPA & PDB)
```bash
kubectl apply -f k8s/backend/hpa.yaml
kubectl apply -f k8s/frontend/hpa.yaml
kubectl apply -f k8s/backend/pdb.yaml
kubectl apply -f k8s/frontend/pdb.yaml
```

### 6.7 Monitor Rollout Status
```bash
kubectl rollout status deployment/backend -n devboard-prod --timeout=180s
kubectl rollout status deployment/frontend -n devboard-prod --timeout=180s
```

*Expected output:*
```text
deployment "backend" successfully rolled out
deployment "frontend" successfully rolled out
```

### 6.8 Verify Running Pods
```bash
kubectl get pods -n devboard-prod -o wide
```

*Expected output:*
```text
NAME                        READY   STATUS    RESTARTS   AGE   IP           NODE
backend-6bf976985f-8x2jk    1/1     Running   0          45s   10.0.1.12    ip-10-0-1-xxx
backend-6bf976985f-l9mp4    1/1     Running   0          45s   10.0.2.34    ip-10-0-2-xxx
frontend-58d79b94c4-72q89   1/1     Running   0          40s   10.0.1.56    ip-10-0-1-xxx
frontend-58d79b94c4-w8nm1   1/1     Running   0          40s   10.0.2.78    ip-10-0-2-xxx
```

Notice that the pods are automatically distributed across different AZ nodes (`10.0.1.x` and `10.0.2.x`) by `topologySpreadConstraints`.

---

## Step 7: Deploy & Verify Ingress / AWS Load Balancer

> **Where to run:** Project Root (`/data/project/devboard`)

### 7.1 If using Custom Domain + ACM Certificate
If you have a domain (e.g. `devboard.example.com`) and an ACM Certificate ARN:

```bash
export DOMAIN_NAME="devboard.example.com"
export ACM_CERT_ARN="arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id"

sed -e "s|<DOMAIN_NAME>|${DOMAIN_NAME}|g" \
    -e "s|<ACM_CERTIFICATE_ARN>|${ACM_CERT_ARN}|g" \
    k8s/ingress/ingress.yaml | kubectl apply -f -
```

### 7.2 If Testing Directly with ALB DNS (No Custom Domain Yet)
If you don't have a domain or ACM certificate yet and want to test HTTP directly:

```bash
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: devboard-ingress
  namespace: devboard-prod
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}]'
    alb.ingress.kubernetes.io/healthcheck-path: /
spec:
  ingressClassName: alb
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
EOF
```

### 7.3 Wait for AWS ALB Provisioning
The AWS Load Balancer Controller provisions an ALB in AWS. This takes ~2–3 minutes:

```bash
kubectl get ingress devboard-ingress -n devboard-prod -w
```

*Expected output:*
```text
NAME               CLASS   HOSTS   ADDRESS                                                                  PORTS
devboard-ingress   alb     *       k8s-devboard-devboard-xxxxxx-xxxxxxxxx.us-east-1.elb.amazonaws.com       80
```

Export the ALB hostname:
```bash
export ALB_DNS=$(kubectl get ingress devboard-ingress -n devboard-prod -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "ALB Public URL: http://${ALB_DNS}"
```

---

## Step 8: Configure DNS (Route 53) & HTTPS

> **Where to run:** AWS Console / AWS CLI

If deploying with your domain:

### 8.1 Create Route 53 Alias Record
Point your domain (or subdomain) to the ALB:

```bash
export HOSTED_ZONE_ID="Z1234567890ABC"

aws route53 change-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"UPSERT\",
      \"ResourceRecordSet\": {
        \"Name\": \"${DOMAIN_NAME}\",
        \"Type\": \"A\",
        \"AliasTarget\": {
          \"HostedZoneId\": \"Z35SXDOTRQ7X7K\",
          \"DNSName\": \"${ALB_DNS}\",
          \"EvaluateTargetHealth\": true
        }
      }
    }]
  }"
```
*(Note: `Z35SXDOTRQ7X7K` is the canonical hosted zone ID for ALBs in `us-east-1`)*.

---

## Step 9: End-to-End Application Smoke Testing

> **Where to run:** Local Machine (Terminal)

Test all layers through the Application Load Balancer:

### 9.1 Test Frontend SPA Root Route
```bash
curl -I "http://${ALB_DNS}/"
```

*Expected output:*
```text
HTTP/1.1 200 OK
Content-Type: text/html
...
```

### 9.2 Test Backend Health Check (Routed via Nginx `/api/health`)
```bash
curl -s "http://${ALB_DNS}/api/health"
```

*Expected output:*
```json
{"service":"backend","status":"ok"}
```

### 9.3 Test Database Queries (Fetch Seeded Projects)
```bash
curl -s "http://${ALB_DNS}/api/projects"
```

*Expected output:*
```json
{"projects":[{"created_at":"2026-09-21T10:00:00Z","description":"DevBoard Demo","id":1,"name":"DevBoard Demo","owner_id":null}]}
```

### 9.4 Test Database Queries (Fetch Tasks for Project 1)
```bash
curl -s "http://${ALB_DNS}/api/tasks?project_id=1"
```

*Expected output:*
```json
{"source":"database","tasks":[{"id":1,"project_id":1,"status":"done","title":"Set up CI pipeline",...}]}
```

### 9.5 Test Creating a New Task via API
```bash
curl -s -X POST "http://${ALB_DNS}/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test EKS Deployment","project_id":1,"status":"in_progress","priority":"high"}'
```

*Expected output:*
```json
{"id":4,"project_id":1,"status":"in_progress","title":"Test EKS Deployment","priority":"high",...}
```

---

## Step 10: Verify Autoscaling (HPA + Karpenter)

> **Where to run:** Project Root (`/data/project/devboard`)

### 10.1 Check HPA Metrics Status
```bash
kubectl get hpa -n devboard-prod
```

*Expected output:*
```text
NAME           REFERENCE              TARGETS           MINPODS   MAXPODS   REPLICAS   AGE
backend-hpa    Deployment/backend     cpu: 2%/70%       2         8         2          10m
frontend-hpa   Deployment/frontend    cpu: 1%/70%       2         6         2          10m
```
*(If `TARGETS` displays percentages, Metrics-Server is healthy)*.

### 10.2 Verify Karpenter Node Pool
```bash
kubectl get nodepool
kubectl get ec2nodeclass
```

### 10.3 Test Load-Triggered Scaling (Optional)
Simulate load on the backend:
```bash
kubectl run -i --tty load-generator --rm --image=busybox --restart=Never -- \
  /bin/sh -c "while true; do wget -q -O- http://backend.devboard-prod.svc.cluster.local:8080/health; done"
```

In another terminal, observe HPA scale out the backend replicas:
```bash
kubectl get hpa -n devboard-prod -w
```

---

## Step 11: Rollback Procedure

> **Where to run:** Project Root (`/data/project/devboard`)

If a deployment contains a defect, rollback instantaneously with zero downtime:

### 11.1 Check Deployment History
```bash
kubectl rollout history deployment/backend -n devboard-prod
kubectl rollout history deployment/frontend -n devboard-prod
```

### 11.2 Rollback to Previous Revision
```bash
kubectl rollout undo deployment/backend -n devboard-prod
kubectl rollout undo deployment/frontend -n devboard-prod
```

### 11.3 Confirm Rollback
```bash
kubectl rollout status deployment/backend -n devboard-prod
kubectl rollout status deployment/frontend -n devboard-prod
```

---

## Step 12: Destroying the Environment (Clean Up)

> **Where to run:** Project Root and `terraform/`

To prevent ongoing AWS costs when you want to tear down the environment:

```bash
# 1. Delete Kubernetes Ingress (deletes the AWS ALB first)
kubectl delete ingress devboard-ingress -n devboard-prod

# Wait 2 minutes for ALB deletion in AWS
sleep 120

# 2. Delete all other k8s resources
kubectl delete namespace devboard-prod

# 3. Destroy Terraform infrastructure
cd /data/project/devboard/terraform
terraform destroy -var-file=environments/production.tfvars -auto-approve
```

---

## Summary of File Locations & Reference Map

| Component | File Path |
|---|---|
| **EKS Namespace** | `k8s/namespace.yaml` |
| **ConfigMap** | `k8s/configmap.yaml` |
| **Secrets Placeholder** | `k8s/secret.yaml` |
| **Backend Workload** | `k8s/backend/deployment.yaml` |
| **Backend Service** | `k8s/backend/service.yaml` |
| **Backend HPA** | `k8s/backend/hpa.yaml` |
| **Backend PDB** | `k8s/backend/pdb.yaml` |
| **Frontend Workload** | `k8s/frontend/deployment.yaml` |
| **Frontend Service** | `k8s/frontend/service.yaml` |
| **Frontend HPA** | `k8s/frontend/hpa.yaml` |
| **Frontend PDB** | `k8s/frontend/pdb.yaml` |
| **ALB Ingress** | `k8s/ingress/ingress.yaml` |
| **RBAC** | `k8s/rbac/role.yaml` & `k8s/rbac/rolebinding.yaml` |
| **Kustomization** | `k8s/kustomization.yaml` |
| **Terraform Code** | `terraform/` (`vpc.tf`, `eks.tf`, `rds.tf`, `karpenter.tf`, `ecr.tf`, etc.) |
| **Terraform Variables** | `terraform/environments/production.tfvars` |
| **CI/CD Workflows** | `.github/workflows/eks-docker-build.yml` & `eks-deploy.yml` |

