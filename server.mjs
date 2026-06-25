import { createServer } from "node:http";
import next from "next";

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const dev = process.env.NODE_ENV === "development";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

createServer((request, response) => {
  handle(request, response);
}).listen(port, hostname, () => {
  console.log(`OptiAI CRM ready on http://localhost:${port}`);
});
