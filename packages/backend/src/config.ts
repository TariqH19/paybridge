import "dotenv/config";
import { z } from "zod";

const OptionalEnvironmentValue = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const EnvironmentSchema = z.object({
  MONGODB_URI: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  STRIPE_SECRET_KEY: OptionalEnvironmentValue,
  STRIPE_WEBHOOK_SECRET: OptionalEnvironmentValue,
  ADMIN_USERNAME: OptionalEnvironmentValue,
  ADMIN_PASSWORD: OptionalEnvironmentValue,
  ADMIN_SESSION_SECRET: OptionalEnvironmentValue,
});

const parsedEnvironment = EnvironmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const invalidVariables = parsedEnvironment.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  throw new Error(`Invalid environment configuration: ${invalidVariables}`);
}

export const config = parsedEnvironment.data;
