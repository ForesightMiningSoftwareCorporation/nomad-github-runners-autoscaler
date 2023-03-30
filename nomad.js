import got from "got";

const dispatchJob = async function(name, payload) {
    const nomadHost = process.env.NOMAD_HOST || "http://127.0.0.1"
    const nomadToken = process.env.NOMAD_TOKEN || ""
    const nomadJobId = process.env.NOMAD_JOB_ID || ""
    const nomadNamespace = process.env.NOMAD_NAMESPACE || "default"

    const available_node_classes = ["standard", "gpu"]
    let node_class = "standard"


    // only target events with "self-hosted" label
    const triggerConditions = (
        payload.workflow_job.labels.length > 0 &&
        payload.workflow_job.labels[0] === 'self-hosted'
    );
    if (!triggerConditions) return Promise.resolve();

    for (const label of payload.workflow_job.labels) {
        if (available_node_classes.includes(label)) {
            node_class = label
        }
    }
    const data = await got.post(`${nomadHost}/v1/job/${nomadJobId}-${node_class}/dispatch`, {
        json: {
            'Meta': {
                'GH_REPO_URL': payload.repository.html_url,
            },
            'namespace': nomadNamespace
        },
        headers: {
            'X-Nomad-Token': nomadToken
        }
    }).json();
    console.log(`Job ID: ${nomadJobId} has been dispatched.`)
    console.log(data)

    return Promise.resolve()
}

export { dispatchJob };
