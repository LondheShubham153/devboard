# EKS ships gp2 but marks nothing default, so a PVC hangs Pending. gp3 here, default, no patching.
resource "kubernetes_storage_class_v1" "gp3" {
  metadata {
    name = "gp3"

    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }

  storage_provisioner = "ebs.csi.aws.com"
  reclaim_policy      = "Delete"

  allow_volume_expansion = true

  # WaitForFirstConsumer: schedule the pod first, or the EBS volume lands in the wrong AZ.
  volume_binding_mode = "WaitForFirstConsumer"

  parameters = {
    type      = "gp3"
    encrypted = "true"
    fsType    = "ext4"
  }

  depends_on = [module.eks]
}
