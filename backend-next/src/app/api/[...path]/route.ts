import { createApi } from '../../../lib/api';
import { database } from '../../../lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const handle = createApi(database);
export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as OPTIONS, handle as PATCH, handle as HEAD };
