import { z } from "zod";

export const socialSchema = z.object({ platform: z.string(), url: z.string() });
