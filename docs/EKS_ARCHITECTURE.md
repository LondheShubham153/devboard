# DevBoard — EKS Architecture

## Overview

DevBoard is deployed on AWS EKS as a two-tier web application with an external managed database. The frontend (React/Nginx) serves static assets and proxies API calls to the backend (Go/Gin), which connects to Amazon RDS PostgreSQL.

---

## High-Level Architecture

```mermaid
flowchart TD
    Users["Users (Internet)"]
    R53["Route 53 DNS"]
    ACM["ACM Certificate"]
    ALB["AWS Application Load Balancer"]
    ING["Kubernetes Ingress"]
    FE["Frontend Service<br/>React + Nginx"]
    BE["Backend Service<br/>Go + Gin"]
    RDS["Amazon RDS<br/>PostgreSQL 17"]
    ECR["Amazon ECR<br/>Container Registry"]

    Users --> R53
    R53 --> ALB
    ACM -.-> ALB
    ALB --> ING
    ING --> FE
    FE -->|"/api/* proxy"| BE
    BE --> RDS
    ECR -.->|"Image Pull"| FE
    ECR -.->|"Image Pull"| BE
```

---

## AWS Infrastructure

```mermaid
flowchart TD
    subgraph VPC["VPC (10.0.0.0/16)"]
        subgraph PUB["Public Subnets"]
            ALB["ALB"]
            NAT["NAT Gateway"]
        end
        subgraph PRIV["Private Subnets"]
            subgraph EKS["EKS Cluster"]
                NG["Managed Node Group<br/>t3.medium × 2-6"]
                KP["Karpenter Nodes<br/>t3.medium/large"]
            end
            RDS["RDS PostgreSQL<br/>db.t4g.micro"]
        end
    end

    IGW["Internet Gateway"] --> PUB
    PRIV --> NAT --> IGW
    ALB --> EKS
    EKS --> RDS
```

---

## Kubernetes Architecture

```mermaid
flowchart TD
    subgraph NS["Namespace: devboard-prod"]
        subgraph BACKEND["Backend"]
            BD["Deployment<br/>2-8 replicas"]
            BS["Service: backend<br/>ClusterIP :8080"]
            BH["HPA<br/>CPU 70% / Mem 80%"]
            BP["PDB<br/>minAvailable: 1"]
            BSA["ServiceAccount<br/>devboard-backend"]
        end

        subgraph FRONTEND["Frontend"]
            FD["Deployment<br/>2-6 replicas"]
            FS["Service: frontend<br/>ClusterIP :80→8080"]
            FH["HPA<br/>CPU 70%"]
            FP["PDB<br/>minAvailable: 1"]
            FSA["ServiceAccount<br/>devboard-frontend"]
        end

        ING["Ingress<br/>AWS ALB"]
        CM["ConfigMap<br/>devboard-config"]
        SEC["Secret<br/>devboard-secrets"]
        RBAC["RBAC<br/>Role + RoleBinding"]
    end

    ING --> FS
    FS --> FD
    FD -->|"/api/*"| BS
    BS --> BD
    CM -.-> BD
    CM -.-> FD
    SEC -.-> BD
    BH --> BD
    FH --> FD
    BSA -.-> BD
    FSA -.-> FD
```

---

## Request Flow

```mermaid
sequenceDiagram
    actor User
    participant ALB as AWS ALB<br/>(HTTPS termination)
    participant Nginx as Frontend Nginx<br/>(Port 8080)
    participant Gin as Backend Gin<br/>(Port 8080)
    participant PG as RDS PostgreSQL<br/>(Port 5432)

    User->>ALB: HTTPS GET /
    ALB->>Nginx: HTTP (target group)
    Nginx-->>ALB: index.html + JS/CSS
    ALB-->>User: Static SPA content

    User->>ALB: HTTPS GET /api/projects
    ALB->>Nginx: HTTP /api/projects
    Nginx->>Gin: HTTP GET /projects<br/>(strips /api prefix)
    Gin->>PG: SELECT * FROM projects
    PG-->>Gin: Result set
    Gin-->>Nginx: JSON response
    Nginx-->>ALB: Proxy response
    ALB-->>User: JSON data
```

---

## CI/CD Pipeline

```mermaid
flowchart LR
    DEV["Developer"]
    GH["GitHub<br/>main branch"]
    CI["CI Pipeline<br/>Tests + Lint + SAST"]
    BUILD["Docker Build<br/>+ Trivy Scan"]
    ECR["Amazon ECR"]
    DEPLOY["EKS Deploy<br/>kubectl set image"]
    SMOKE["Smoke Tests<br/>/health + /"]
    PROD["Production<br/>Live Traffic"]
    ROLL["Rollback<br/>kubectl rollout undo"]

    DEV -->|push| GH
    GH --> CI
    CI -->|pass| BUILD
    BUILD --> ECR
    ECR --> DEPLOY
    DEPLOY --> SMOKE
    SMOKE -->|pass| PROD
    SMOKE -->|fail| ROLL
    ROLL --> PROD
```

---

## Scaling Architecture

```mermaid
flowchart TD
    LOAD["Increased Traffic"]
    HPA["HPA<br/>Detects CPU/Memory pressure"]
    PODS["Scale Pods<br/>2 → 8 replicas"]
    PEND["Pods Pending<br/>No node capacity"]
    KARP["Karpenter<br/>Detects pending pods"]
    NODES["Provision EC2<br/>~60 seconds"]
    SCHED["Pods Scheduled<br/>On new nodes"]
    ALB["ALB<br/>Adds healthy targets"]

    LOAD --> HPA
    HPA --> PODS
    PODS --> PEND
    PEND --> KARP
    KARP --> NODES
    NODES --> SCHED
    SCHED --> ALB

    style KARP fill:#f9f,stroke:#333
    style HPA fill:#bbf,stroke:#333
```

### Scaling Parameters

| Component | Min | Max | Trigger | Scale-Down Window |
|-----------|-----|-----|---------|-------------------|
| Backend pods | 2 | 8 | CPU > 70% or Memory > 80% | 5 minutes |
| Frontend pods | 2 | 6 | CPU > 70% | 5 minutes |
| Karpenter nodes | 0 | (CPU 20 / Mem 40Gi) | Pending pods | Consolidation: 60s |
| EKS node group | 2 | 6 | Managed by EKS | N/A |

---

## Security Architecture

### Network Security

| Layer | Control | Description |
|-------|---------|-------------|
| VPC | Private subnets | Worker nodes and RDS in private subnets |
| VPC | NAT Gateway | Outbound internet via NAT (no inbound) |
| ALB | Security groups | Only ports 80/443 from internet |
| EKS nodes | Security groups | Only traffic from ALB and inter-node |
| RDS | Security groups | Only port 5432 from EKS node SG |
| TLS | ACM + ALB | HTTPS termination at ALB, TLS 1.3 policy |

### Application Security

| Layer | Control | Description |
|-------|---------|-------------|
| Container | Non-root | Backend: UID 10001, Frontend: UID 101 |
| Container | Read-only FS | `readOnlyRootFilesystem: true` |
| Container | Drop caps | `capabilities.drop: [ALL]` |
| Container | No escalation | `allowPrivilegeEscalation: false` |
| Container | Seccomp | `RuntimeDefault` profile |
| IAM | IRSA | Pod-level IAM via service accounts |
| Secrets | K8s Secrets | Migrate to AWS Secrets Manager for production |
| Images | Immutable tags | Git SHA tags, no `latest` in production |
| Images | Scanning | Trivy scan on every build |

---

## Architecture Decisions

| # | Decision | Choice | Alternative | Rationale |
|---|----------|--------|-------------|-----------|
| 1 | Database | Amazon RDS | PostgreSQL StatefulSet | 2-table schema; managed backups, HA, patching eliminate operational overhead |
| 2 | Node autoscaling | Karpenter | Cluster Autoscaler | ~60s provisioning vs ~5min; native EC2 Fleet API; better bin-packing |
| 3 | Image registry | Amazon ECR | GHCR / DockerHub | Native EKS integration; IAM auth; image scanning; lifecycle policies |
| 4 | Load balancer | AWS ALB | NLB / nginx-ingress | HTTP/HTTPS routing; ACM integration; path-based rules; AWS-managed |
| 5 | TLS termination | ACM + ALB | cert-manager | Free auto-renewing certs; no in-cluster cert management |
| 6 | Ingress routing | ALB → Nginx → Backend | ALB path-based split | Preserves existing nginx proxy; zero application code changes |
| 7 | Secrets | K8s Secrets | External Secrets Operator | Simple baseline; ESO documented for production hardening |
| 8 | Container runtime | Distroless / nginx-unprivileged | Standard images | Minimal attack surface; non-root by default |
| 9 | IaC | Terraform | CloudFormation / CDK | Multi-provider; mature module ecosystem; declarative |
| 10 | CI/CD | GitHub Actions | ArgoCD / FluxCD | Matches existing CI/CD; simple kubectl-based deploys |

---

## Network Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS Region                               │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    VPC (10.0.0.0/16)                      │  │
│  │                                                           │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐       │  │
│  │  │  Public Subnet AZ-a │  │  Public Subnet AZ-b │       │  │
│  │  │  10.0.101.0/24      │  │  10.0.102.0/24      │       │  │
│  │  │                     │  │                     │       │  │
│  │  │  ┌───┐  ┌───┐      │  │  ┌───┐              │       │  │
│  │  │  │ALB│  │NAT│      │  │  │ALB│              │       │  │
│  │  │  └───┘  └───┘      │  │  └───┘              │       │  │
│  │  └─────────────────────┘  └─────────────────────┘       │  │
│  │                                                           │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐       │  │
│  │  │  Private Subnet AZ-a│  │  Private Subnet AZ-b│       │  │
│  │  │  10.0.1.0/24        │  │  10.0.2.0/24        │       │  │
│  │  │                     │  │                     │       │  │
│  │  │  ┌────────────────┐ │  │  ┌────────────────┐ │       │  │
│  │  │  │  EKS Node      │ │  │  │  EKS Node      │ │       │  │
│  │  │  │  ┌──┐ ┌──┐     │ │  │  │  ┌──┐ ┌──┐    │ │       │  │
│  │  │  │  │FE│ │BE│     │ │  │  │  │FE│ │BE│    │ │       │  │
│  │  │  │  └──┘ └──┘     │ │  │  │  └──┘ └──┘    │ │       │  │
│  │  │  └────────────────┘ │  │  └────────────────┘ │       │  │
│  │  │                     │  │                     │       │  │
│  │  │  ┌───┐              │  │                     │       │  │
│  │  │  │RDS│ (primary)    │  │  (standby if Multi-AZ) │    │  │
│  │  │  └───┘              │  │                     │       │  │
│  │  └─────────────────────┘  └─────────────────────┘       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────┐  ┌──────┐                                            │
│  │ ECR  │  │ ACM  │                                            │
│  └──────┘  └──────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

| Flow | Path | Protocol | Auth |
|------|------|----------|------|
| User → App | Internet → ALB → Nginx → Static files | HTTPS → HTTP | None (public) |
| User → API | Internet → ALB → Nginx → Backend → RDS | HTTPS → HTTP → TCP | None (public API) |
| Image pull | ECR → EKS Node | HTTPS | IAM (node role) |
| DB connection | Backend pod → RDS | TCP/5432 | Password (POSTGRES_URL) |
| Metrics | Pods → Metrics Server → HPA | Internal | K8s RBAC |
| Logs | Pods → stdout → CloudWatch (optional) | Internal | IAM |

