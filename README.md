# nomad-github-runners-autoscaler

A Application that listens to the GitHub Webhooks event (`workflow_job.queued`) and dispatches Nomad parameterized jobs using Nomad HTTP API to launch "on-demand" GitHub Actions Self-hosted Runners easily and efficiently.

This application implements the suggested autoscaling pattern mentioned in the GitHub documentation below:

- [Autoscaling with self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/autoscaling-with-self-hosted-runners)

### (optional) Horizontal Nomad Cluster Autoscaling

While this demo app shows you a conceptual way of auto-scaling GitHub Actions Self-hosted runners on your Nomad Cluster, you may also want to ensure that there is always an appropriate amount of Nomad cluster resource to run your runners' workload at scale. This is achievable by using [Nomad Autoscaler](https://www.nomadproject.io/tools/autoscaling).

### Environment Variables

The following environment variables should be passed accordingly to run this app container.

- `PORT`: the port number the server will listen on in the container (default: `3000`)
- `GH_WEBHOOK_SECRET`: your configured GitHub Webhook secret
- `NOMAD_HOST`: the Nomad host address (e.g., `http://example.com:4646`)
- `NOMAD_JOB_ID`: the Nomad Job ID to dispatch
- `NOMAD_TOKEN`: the Nomad token (requires permission to dispatch jobs)

```sh
docker run -d --restart always --name nomad-github-runners-autoscaler \
  -e GH_WEBHOOK_SECRET="mysecret" \
  -e NOMAD_HOST="http://127.0.0.1:4646" \
  -e NOMAD_JOB_ID="github_runner" \
  -e NOMAD_TOKEN="foo" \
  -p 8080:3000 \
  jrsyo/nomad-github-runners-autoscaler:alpha
```

## Deploy to Nomad cluster

### example architecture overview

![example system architecture overview diagram](docs/example-deployment-overview.png)

**NOTE:** These examples assume that you have already set up Nomad Vault integration on your Nomad cluster to avoid hard-coding your GitHub personal access token to obtain the runner tokens on-demand. See [Vault integration](https://www.nomadproject.io/docs/integrations/vault-integration) for more details.

Or, you could remove the `vault` and `template` stanzas and pass secrets via the normal `env` stanza.

### example (webhook server)

This example job exposes the app container on port 8080 on the deployed Nomad node and lets the app container process incoming webhook requests directly. Therefore, you can't run multiple app containers (i.e., the `count` parameter).

This example is not meant to be a production-ready showcase. In a realistic environment, you should consider running load balancers in front of your apps. Please refer to HashiCorp's official learning guide resources such as [Load Balancer Deployment Considerations](https://learn.hashicorp.com/tutorials/nomad/load-balancing?in=nomad/load-balancing).

\* Since Nomad 1.3 will add a built-in service discovery feature, using the `template` stanza and accessing other services' address information does not necessarily require [Consul](https://www.nomadproject.io/docs/integrations/consul-integration) as before.

```hcl
job "gh_webhook_server" {
    datacenters = ["dc1"]
    type = "service"

    vault {
        policies = ["github-hashicorp-demo"]
        change_mode   = "noop"
    }

    group "server" {
        count = 1
        network {
            port "http" {
                static = 8080
            }
        }
        task "app" {
            driver = "docker"

            # fetch secrets from Vault KV secret engine
            template {
                env = true
                destination = "secret/gh-webhook-server.env"
                data = <<EOF
                    NOMAD_TOKEN = "{{with secret "demos-secret/data/github-hashicorp-demo"}}{{index .Data.data "nomad-token"}}{{end}}"
                    GH_WEBHOOK_SECRET = "{{with secret "demos-secret/data/github-hashicorp-demo"}}{{index .Data.data "github-webhook-secret"}}{{end}}"
                EOF
            }

            env {
                PORT = "8080"
                NOMAD_HOST        = "http://${NOMAD_IP_http}:4646"
                NOMAD_JOB_ID      = "github_runner"
            }

            config {
                image = "jrsyo/nomad-github-runners-autoscaler:alpha"
                ports = [
                    "http",
                ]
            }
        }
    }
}
```

### example (GitHub Actions Runners)

See [myoung34/docker-github-actions-runner](https://github.com/myoung34/docker-github-actions-runner) for more details about configuration options.

In this example job file, `GH_REPO_URL` is defined as a required metadata key. This metadata value is used in the `env` stanza to pass the `REPO_URL` environment variable dynamically, so the demo app [always sends](https://github.com/smaeda-ks/nomad-github-runners-autoscaler-demo/blob/main/nomad.js) this metadata when calling the [`Dispatch Job`](https://www.nomadproject.io/api-docs/jobs#dispatch-job) Nomad HTTP API endpoint. This way, we can have a reusable job definition across your repositories.

Also, as a possible improvement, by further utilizing the Actions `runs-on:` [custom labels](https://docs.github.com/en/actions/hosting-your-own-runners/using-self-hosted-runners-in-a-workflow#routing-precedence-for-self-hosted-runners), you could send as many arbitrary metadata for parameterized jobs. This might be useful to limit jobs [resources](https://www.nomadproject.io/docs/job-specification/resources) (e.g., cpu/memory) as well as have fine control of the target nodes with [constraint](https://www.nomadproject.io/docs/job-specification/constraint) and/or [affinity](https://www.nomadproject.io/docs/job-specification/affinity), for instance.

```hcl
job "github_runner" {
    datacenters = ["dc1"]
    type = "batch"

    parameterized {
        payload = "forbidden"
        meta_required = ["GH_REPO_URL"]
    }

    vault {
        policies = ["github-hashicorp-demo"]
        change_mode   = "signal"
        change_signal = "SIGINT"
    }

    group "runners" {
        task "runner" {
            driver = "docker"

            # fetch secrets from Vault KV secret engine
            template {
                env = true
                destination = "secret/vault.env"
                data = <<EOF
                    ACCESS_TOKEN = "{{with secret "demos-secret/data/github-hashicorp-demo"}}{{index .Data.data "github-pat"}}{{end}}"
                EOF
            }

            env {
                EPHEMERAL           = "true"
                DISABLE_AUTO_UPDATE = "true"
                RUNNER_NAME_PREFIX  = "gh-runner"
                RUNNER_WORKDIR      = "/tmp/runner/work"
                RUNNER_SCOPE        = "repo"
                REPO_URL            = "${NOMAD_META_GH_REPO_URL}"
                LABELS              = "linux-x86,t2-micro"
            }

            config {
                image = "myoung34/github-runner:latest"
                
                privileged  = true
                userns_mode = "host"

                # Allow DooD (Docker outside of Docker)
                volumes = [
                    "/var/run/docker.sock:/var/run/docker.sock",
                ]
            }
        }
    }
}
```

### GitHub PAT (Personal Access Token) vs GitHub Apps

The Nomad job file above requires a valid GitHub PAT (Personal Access Token) in order to register a new Runner to a given GitHub repository.

While this works fine, PAT is a static and long-lived secret that you may want to avoid sharing across teams. Therefore, GitHub actually recommends using GitHub Apps and generating a short-lived token instead.

To do so, since the `myoung34/docker-github-actions-runner` Docker image currently [doesn't support](https://github.com/myoung34/docker-github-actions-runner/pull/205) authenticating with GitHub Apps upon start-up, you can do a little hack using Nomad's [init task pattern](https://www.nomadproject.io/docs/job-specification/lifecycle#init-task-pattern) to generate a token in the `prestart` lifecycle stage.

See an example [here](https://github.com/smaeda-ks/nomad-github-runners-autoscaler-demo/blob/main/nomad-jobs/gha-runner-github-apps.nomad).

### Docker in Docker

The GitHub Runner itself doesn't support DinD (Docker in Docker):
https://github.com/actions/runner/issues/406

But you could do DooD (Docker outside of Docker) instead:
https://github.com/actions/runner/issues/406#issuecomment-876283668
