import { createEgressProxy, egressAllowlist } from './egress-proxy';

const port = 3128;
const server = createEgressProxy(egressAllowlist, (line) => {
    console.log(JSON.stringify(line));
});
process.once(`SIGTERM`, () => {
    server.close();
    process.exit(0);
});
server.listen(port, `0.0.0.0`);
