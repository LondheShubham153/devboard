# 03 — Provision EKS with Terraform

The previous version of this project created the cluster with a 30-line
`eksctl` file. It worked, and it hid almost everything.

This chapter replaces it with Terraform. Not because Terraform is better at
making clusters — eksctl is genuinely excellent at that — but because **eksctl
silently built a VPC you never saw**: nine subnets across three availability
zones, an internet gateway, NAT, route tables, and two magic subnet tags that
decide where your load balancer can go. All of that was always there. You were
just never asked about it.

## What eksctl was doing for you

Read this table next to [`terraform/`](../terraform/). Your mental model is the
old eksctl file, so the mapping is the fastest way in. The row that matters
most is the one with an empty left cell.

| `gitops/eksctl/cluster.yaml` (deleted) | Terraform equivalent |
| --- | --- |
| `metadata.name: devboard` | `module.eks.name` |
| `metadata.region: us-west-2` | `provider "aws" { region }` |
| **— nothing —** | **`module.vpc`, ~50 explicit lines. This is the point of the chapter.** |
| `iam.withOIDC: true` | still created; Pod Identity doesn't need it, but leave it on |
| `instanceType: t3.medium` | `instance_types = ["t3.large"]` |
| `desiredCapacity: 3` | `desired_size = 3` |
| `volumeSize: 20` | `block_device_mappings.xvda.ebs.volume_size` — **not** `disk_size` |
| `ssh.enableSsm: true` | the module attaches the SSM policy to the node role by default |
| `addons: [vpc-cni, coredns, kube-proxy]` | `addons = { vpc-cni = { before_compute = true }, ... }` |
| `aws-ebs-csi-driver` + `wellKnownPolicies` | the addon + `module.ebs_csi_pod_identity` |
| `metrics-server` | `addons.metrics-server` |
| — | `eks-pod-identity-agent` — **new**, and required for External Secrets |

## Apply

```bash
cd terraform
terraform plan      # read this. ~70 resources.
terraform apply     # ~15-20 min, mostly the control plane
```

While it runs, read the four files that matter:

- **[`vpc.tf`](../terraform/vpc.tf)** — three subnet tiers with three different
  jobs. Public holds the NLB. Private holds your nodes, which reach the
  internet outward through NAT but cannot be reached inward. Intra has no
  internet route at all and holds the EKS control plane ENIs.
- **[`eks.tf`](../terraform/eks.tf)** — the cluster and its node group.
- **[`pod-identity.tf`](../terraform/pod-identity.tf)** — how a pod gets AWS
  permissions without a single access key.
- **[`storage.tf`](../terraform/storage.tf)** — the StorageClass, and why this
  chapter no longer contains a `kubectl patch` step.

## Three things worth stopping on

### 1. One NAT Gateway, not three

```hcl
single_nat_gateway = true
```

Without that line the VPC module creates one NAT Gateway per availability zone:
3 × $0.045/hr ≈ **$98/month**, before data charges. One is ≈ $33/month.

The trade-off is real, and do not copy this to production: all egress from all
three AZs now flows through a single AZ. Lose that AZ and every node loses
outbound internet — image pulls included — even though the nodes themselves are
perfectly healthy.

### 2. `disk_size` is silently ignored

```hcl
block_device_mappings = {
  xvda = { device_name = "/dev/xvda", ebs = { volume_size = 30, ... } }
}
```

In EKS module v21 the module builds a custom launch template by default, and
`disk_size` only applies when it doesn't. Set `disk_size` and it looks like it
worked — you just quietly get the AMI default instead. This is a top-three
"worked in v20, broke in v21" report.

### 3. There is no `kubectl patch storageclass` step any more

The old chapter ended with this:

```bash
# NO LONGER NEEDED
kubectl patch storageclass gp2 -p '{"metadata":{"annotations":{...}}}'
```

An imperative, easy-to-skip command whose only symptom when forgotten is a
PersistentVolumeClaim stuck `Pending` forever. **This project got bitten by
exactly that** — Postgres named its class explicitly and survived; the Ollama
PVC did not and silently never started, taking the AI assistant down while
every health check stayed green.

So the StorageClass is now infrastructure, declared in
[`storage.tf`](../terraform/storage.tf), and it uses `gp3`:

- cheaper — $0.08/GiB-month vs gp2's $0.10
- 3000 IOPS and 125 MB/s baseline at **any** size. gp2 ties IOPS to volume
  size, so a 1 GiB Postgres volume gets 3 IOPS and a burst balance.

Note `volume_binding_mode: WaitForFirstConsumer`. This is not optional on a
multi-AZ cluster: with immediate binding the CSI driver picks the volume's AZ
*before* the scheduler picks a node, and an EBS volume cannot cross AZs — so
roughly two times in three the pod is unschedulable forever, with an error that
blames affinity rather than binding order.

## Verify

```bash
aws eks update-kubeconfig --name devboard --region us-west-2

kubectl get nodes                     # 3 Ready, and note the private IPs
kubectl get storageclass              # gp3 (default) — with no patching
kubectl -n kube-system get pods | grep -E 'ebs-csi|metrics-server|pod-identity'
```

```bash
terraform output
```

Keep `configure_kubectl` and `set_postgres_secret` handy — chapter 06 uses the
second one.

## If Terraform ever gets stuck on the cluster

`storage.tf` uses the Kubernetes provider, so Terraform now depends on the
cluster API being reachable. If your credentials break and that blocks a plan
or destroy, the escape hatch is:

```bash
terraform state rm kubernetes_storage_class_v1.gp3
```

---

Next: [04-gateway-api.md](04-gateway-api.md) — get a public URL.
