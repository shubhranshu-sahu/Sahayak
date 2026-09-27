import { sendError } from '../utils/response.js';

/**
 * Middleware factory for request body validation using Zod schemas
 * @param {import('zod').ZodSchema} schema - Zod schema to validate against
 */
export const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return sendError(res, 400, 'Validation failed', errors);
    }
    req.body = result.data;
    next();
  };
};
