# Set up the EC2 machine with Ansible

Four small playbooks, each doing one job. Run them all at once, or run just the
one you need.

```
ansible/
  inventory.ini              which machine to set up
  group_vars/devboard.yml    all your settings, in one place

  01-install-tools.yml       apt packages, Terraform, kubectl, Helm, gh, AWS CLI
  02-configure-aws.yml       AWS region, your keys, a `k` shortcut
  03-clone-repo.yml          clone the DevBoard repo
  04-verify.yml              check it all works

  site.yml                   runs 01 -> 04 in order
```

Installs **AWS CLI v2, Terraform, kubectl, Helm, jq, dig, git, gh**. No Docker —
GitHub Actions builds the images and ArgoCD deploys them, so this machine never
needs it.

## What you need

- An Ubuntu EC2 instance (`t3.small` is plenty — nothing runs *on* this box, it
  only talks to the cluster)
- Its public IP and your `.pem` key file
- Ansible on your laptop: `brew install ansible` or `pip install ansible`

## Run it

**1. Edit `inventory.ini`** — your IP and key file:

```ini
[devboard]
my-ec2 ansible_host=1.2.3.4 ansible_user=ubuntu ansible_ssh_private_key_file=~/.ssh/my-key.pem
```

**2. Edit `group_vars/devboard.yml`** — your AWS keys and your fork:

```yaml
aws_access_key: "AKIA..."
aws_secret_key: "wJalr..."
repo_url: https://github.com/YOUR-USERNAME/devboard.git
```

**3. Run everything:**

```bash
cd ansible
ansible-playbook -i inventory.ini site.yml
```

**4. Log in and start deploying:**

```bash
ssh ubuntu@1.2.3.4
aws sts get-caller-identity
cd devboard && less Deploy.md
```

## Running one piece at a time

This is the reason for four files instead of one. Each is independent.

```bash
# changed your AWS keys? just redo that part
ansible-playbook -i inventory.ini 02-configure-aws.yml

# is the machine still healthy?
ansible-playbook -i inventory.ini 04-verify.yml

# see what would change, without changing anything
ansible-playbook -i inventory.ini site.yml --check
```

All of them are safe to re-run — Ansible skips whatever is already done.

## What 04-verify actually checks

Not just "is it installed". It prints every tool's version, asserts Terraform is
**1.11 or newer** (Deploy.md needs that for S3 state locking), and calls
`aws sts get-caller-identity` to prove AWS really accepts your credentials.
Better to find that out here than twenty minutes into a `terraform apply`.

## About those AWS keys

Putting keys in a file is the easy way, not the safe way. Two better options:

- **Attach an IAM role to the EC2 instance.** Leave `aws_access_key` empty and
  `02-configure-aws.yml` skips the credentials file — the AWS CLI finds the role
  by itself. Nothing to leak, nothing to rotate.
- **Encrypt them:**
  ```bash
  ansible-vault encrypt_string 'AKIA...' --name aws_access_key
  ```
  Paste the output into `group_vars/devboard.yml`, then run with
  `--ask-vault-pass`.

Either way the account needs EKS, VPC, IAM, S3 and Secrets Manager permissions.

## If something breaks

| Problem | Fix |
| --- | --- |
| `UNREACHABLE` / permission denied | `chmod 400 ~/.ssh/my-key.pem`, and check the security group allows SSH from your IP |
| `sudo: a password is required` | Add `--ask-become-pass`, or use the `ubuntu` user which has passwordless sudo |
| Wrong user | Amazon Linux uses `ec2-user`. These playbooks expect Ubuntu |
| `undefined variable` | You ran a playbook from outside `ansible/`, so `group_vars/` was not found. `cd ansible` first |
