import got from "got";
import https from "https";
import fs from "fs";

const dispatchJob = async function (name, payload) {
    const nomadHost = process.env.NOMAD_HOST || "http://127.0.0.1"
    const nomadToken = process.env.NOMAD_TOKEN || ""
    const nomadJobId = process.env.NOMAD_JOB_ID || ""
    const nomadNamespace = process.env.NOMAD_NAMESPACE || "default"
    const nomadCaCert = process.env.NOMAD_CACERT || null
    const nomadClientCert = process.env.NOMAD_CLIENT_CERT || null
    const nomadClientKey = process.env.NOMAD_CLIENT_KEY || null

    let httpsAgent = null;
    if (nomadCaCert || nomadClientCert) {
        const httpsAgentOptions = {}
        if (nomadCaCert) {
            httpsAgentOptions.ca = fs.readFileSync(nomadCaCert)
        }
        if (nomadClientCert && nomadClientKey) {
            httpsAgentOptions.cert = fs.readFileSync(nomadClientCert)
            httpsAgentOptions.key = fs.readFileSync(nomadClientKey)
            httpsAgentOptions.passphrase = process.env.NOMAD_CLIENT_KEY_PASSPHRASE || undefined
        }
        httpsAgent = new https.Agent(httpsAgentOptions);
    }

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
    try {
        const data = await got.post(`${nomadHost}/v1/job/${nomadJobId}-${node_class}/dispatch`, {
            agent: {
                https: httpsAgent,
            },
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
    } catch (error) {
        if (error.response.statusCode === 400) {
            console.error(error.response.body);
        } else {
            console.error(error.message);
        }
    }
    console.log(`Job ID: ${nomadJobId} has been dispatched.`)

    return Promise.resolve()
}

export { dispatchJob };
