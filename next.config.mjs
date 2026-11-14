/** @type {import('next').NextConfig} */
import path from "path";
export default { reactStrictMode: true, outputFileTracingRoot: path.dirname(new URL(import.meta.url).pathname) };
