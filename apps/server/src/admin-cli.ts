import { adminUsage, formatAdminResponse, parseAdminArgs, sendAdminRequest } from './admin-client';
import { parseEnv } from './env';

const parsed = parseAdminArgs(process.argv.slice(2));
if (parsed.kind === `usage`) {
    console.error(`${parsed.error}\n\n${adminUsage}`);
    process.exit(2);
}
try {
    const response = await sendAdminRequest(parseEnv(process.env).ADMIN_SOCKET_PATH, parsed.request);
    const text = formatAdminResponse(response);
    if (response.kind === `error`) {
        console.error(text);
        process.exit(1);
    }
    console.log(text);
} catch (error) {
    console.error(`hexarena-admin: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
