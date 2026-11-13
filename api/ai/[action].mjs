import { createVercelHandler } from '../../server/vercel.mjs';

// Vercel provides req/res. Do not listen on a port in a Function.
export default createVercelHandler();
