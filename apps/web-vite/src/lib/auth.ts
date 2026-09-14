import { createAuthClient } from "better-auth/react";
import { apiBase } from "./api";

export const authClient = createAuthClient({ baseURL: apiBase });
