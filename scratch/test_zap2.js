const https = require('https');

function apiCall(url, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'apikey': apiKey,
        'Content-Type': 'application/json'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, statusText: res.statusMessage, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, statusText: res.statusMessage, body: data });
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const api_url = process.env.EVOLUTION_API_URL;
  const api_key = process.env.EVOLUTION_API_KEY;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'zap2';

  if (!api_url || !api_key) {
    throw new Error('EVOLUTION_API_URL and EVOLUTION_API_KEY are required.');
  }

  console.log(`Checking connection state for ${instanceName}...`);
  try {
    const res = await apiCall(`${api_url}/instance/connectionState/${instanceName}`, api_key);
    console.log('connectionState status:', res.status, res.statusText);
    console.log('connectionState body:', JSON.stringify(res.body, null, 2));
  } catch (err) {
    console.error('Error fetching connectionState:', err.message);
  }

  console.log(`\nFetching all instances from cluster to see if ${instanceName} exists...`);
  try {
    const res = await apiCall(`${api_url}/instance/fetchInstances`, api_key);
    console.log('fetchInstances status:', res.status, res.statusText);
    if (Array.isArray(res.body)) {
      const zap2Instance = res.body.find(inst => inst.name === instanceName);
      console.log(`Instance ${instanceName} in cluster:`, JSON.stringify(zap2Instance, null, 2));
      
      console.log('\nAll instances in cluster (names and status):');
      console.log(res.body.map(inst => ({ name: inst.name, connectionStatus: inst.connectionStatus })));
    } else {
      console.log('fetchInstances response is not an array:', res.body);
    }
  } catch (err) {
    console.error('Error fetching instances:', err.message);
  }
}

main().catch(console.error);
