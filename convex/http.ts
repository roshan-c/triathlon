import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./betterAuth/auth";
import { agent } from "./agentHttp";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/agent/v1",
  method: "POST",
  handler: agent
});

export default http;
