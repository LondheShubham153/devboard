# DevBoard — Production Checklist

Complete checklist for production readiness on AWS EKS. All items should be verified before directing production traffic.

---

## AWS Infrastructure

- [ ] AWS account configured with appropriate billing alerts
- [ ] IAM user/role with least-privilege permissions created
- [ ] VPC created with public and private subnets
- [ ] Private subnets span at least 2 Availability Zones
- [ ] Public subnets tagged for ALB (`kubernetes.io/role/elb = 1`)
- [ ] Private subnets tagged for internal ELB (`kubernetes.io/role/internal-elb = 1`)
- [ ] NAT Gateway deployed for outbound internet from private subnets
- [ ] Security groups configured (EKS, RDS, ALB)
- [ ] EKS cluster created and accessible
- [ ] EKS managed node group running (min 2 nodes)
- [ ] ECR repositories created (`devboard-backend`, `devboard-frontend`)
- [ ] ECR lifecycle policies configured
- [ ] ECR image scanning enabled

---

## Database (RDS)

- [ ] RDS PostgreSQL instance created in private subnets
- [ ] RDS security group allows only EKS node SG on port 5432
- [ ] RDS has no public accessibility
- [ ] RDS storage encryption enabled
- [ ] RDS automated backups enabled (7-day retention)
- [ ] RDS deletion protection enabled
- [ ] RDS Performance Insights enabled
- [ ] Database schema initialized (`01_schema.sql`)
- [ ] Database credentials stored securely (not in Git)
- [ ] `db_password` is strong and unique
- [ ] Connection tested from within EKS cluster

---

## Kubernetes Platform

- [ ] Namespace `devboard-prod` created
- [ ] ConfigMap `devboard-config` applied with correct values
- [ ] Secret `devboard-secrets` applied with real `POSTGRES_URL`
- [ ] Service accounts created (backend, frontend)
- [ ] RBAC roles and bindings applied
- [ ] Metrics Server installed and functional
- [ ] AWS Load Balancer Controller installed and functional
- [ ] Karpenter installed (or Cluster Autoscaler configured)

---

## Application Deployment

- [ ] Backend Deployment running with 2+ replicas
- [ ] Frontend Deployment running with 2+ replicas
- [ ] All pods in `Running` state
- [ ] No pods in `CrashLoopBackOff` or `Error` state
- [ ] Backend liveness probe passing (`GET /health`)
- [ ] Backend readiness probe passing (`GET /health`)
- [ ] Frontend liveness probe passing (`GET /`)
- [ ] Frontend readiness probe passing (`GET /`)
- [ ] Backend Service (`backend`) reachable from frontend pods
- [ ] Frontend Service (`frontend`) reachable from ingress
- [ ] Pods spread across multiple AZs (TopologySpreadConstraints)
- [ ] Resource requests and limits set for all containers
- [ ] Image tags are immutable (Git SHA, not `latest`)

---

## Autoscaling

- [ ] Backend HPA configured (2-8 replicas, CPU 70%, Memory 80%)
- [ ] Frontend HPA configured (2-6 replicas, CPU 70%)
- [ ] HPA showing actual metrics (not `<unknown>`)
- [ ] Backend PDB configured (`minAvailable: 1`)
- [ ] Frontend PDB configured (`minAvailable: 1`)
- [ ] Karpenter NodePool configured
- [ ] Karpenter can provision nodes (test with scale-up)

---

## Networking & DNS

- [ ] Ingress resource created
- [ ] ALB provisioned by AWS Load Balancer Controller
- [ ] ALB health checks passing
- [ ] ALB target groups healthy
- [ ] HTTP → HTTPS redirect configured
- [ ] ACM certificate issued and validated
- [ ] ACM certificate ARN set in Ingress annotations
- [ ] DNS record (Route 53) pointing to ALB
- [ ] `https://<DOMAIN>` returns frontend SPA
- [ ] `https://<DOMAIN>/api/health` returns backend health JSON
- [ ] `https://<DOMAIN>/api/projects` returns project data

---

## Security

- [ ] All containers running as non-root
- [ ] `readOnlyRootFilesystem: true` set
- [ ] `allowPrivilegeEscalation: false` set
- [ ] All capabilities dropped (`drop: [ALL]`)
- [ ] Seccomp profile set to `RuntimeDefault`
- [ ] No AWS access keys in Kubernetes manifests or Git
- [ ] No database passwords in plaintext in Git
- [ ] IRSA configured for AWS-accessing service accounts
- [ ] TLS 1.3 enforced on ALB (`ELBSecurityPolicy-TLS13-1-2-2021-06`)
- [ ] Security headers set by nginx (X-Frame-Options, CSP, etc.)
- [ ] Container images scanned with Trivy (no HIGH/CRITICAL CVEs)
- [ ] Gitleaks passing (no leaked secrets)
- [ ] ECR image tag immutability enabled

---

## CI/CD Pipeline

- [ ] `eks-docker-build.yml` workflow functional
- [ ] `eks-deploy.yml` workflow functional
- [ ] GitHub OIDC configured for AWS authentication
- [ ] `AWS_ECR_ROLE_ARN` secret set in GitHub
- [ ] `AWS_EKS_DEPLOY_ROLE_ARN` secret set in GitHub
- [ ] `production` environment configured with approval rules
- [ ] Trivy scan runs on every image build
- [ ] Automatic rollback on deployment failure
- [ ] Smoke tests pass after deployment
- [ ] Rollout history accessible (`kubectl rollout history`)

---

## Monitoring & Observability

- [ ] Application logs accessible via `kubectl logs`
- [ ] CloudWatch log group configured (recommended)
- [ ] Prometheus + Grafana deployed (recommended)
- [ ] Alerts configured for pod restarts, high error rates
- [ ] Dashboard showing CPU, memory, request count, latency
- [ ] HPA scaling events monitored
- [ ] Karpenter provisioning events monitored
- [ ] ALB metrics visible in CloudWatch

---

## Disaster Recovery

- [ ] RDS automated backups verified
- [ ] RDS snapshot restore tested
- [ ] Rollback procedure documented and tested
- [ ] Application can be redeployed from scratch using Terraform + K8s manifests
- [ ] Terraform state backed up (S3 + DynamoDB locking)
- [ ] Recovery Time Objective (RTO) defined
- [ ] Recovery Point Objective (RPO) defined

---

## Performance

- [ ] Resource requests/limits tuned based on actual usage
- [ ] HPA thresholds validated under load
- [ ] Database connection pool size appropriate (10 connections)
- [ ] Nginx gzip compression enabled for static assets
- [ ] Static asset caching headers set (30-day expiry)
- [ ] ALB idle timeout appropriate (60 seconds)
- [ ] Deregistration delay allows in-flight requests to complete (30 seconds)

---

## Go-Live

- [ ] All checklist items above verified ✅
- [ ] Stakeholders notified of deployment
- [ ] Runbook/playbook available for on-call team
- [ ] Rollback plan documented and communicated
- [ ] Monitoring dashboards bookmarked
- [ ] Alert channels (Slack/PagerDuty/email) configured
- [ ] DNS TTL lowered before cutover (restore after)
- [ ] Load test completed (recommended)
- [ ] Production traffic routed
- [ ] Post-deployment smoke tests passing

