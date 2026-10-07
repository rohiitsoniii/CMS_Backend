import express from 'express';
import { generateOpenapiSpec } from '../utils/openapi.js';

const router = express.Router();

// Generate and return raw JSON spec
router.get('/openapi.json', (_req, res) => {
    const spec = generateOpenapiSpec();
    res.json(spec);
});

// Render Scalar API HTML docs
router.get('/', (_req, res) => {
    res.send(`
    <!doctype html>
    <html>
      <head>
        <title>CMS API Reference</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <script id="api-reference" data-url="/api/v1/docs/openapi.json"></script>
        <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
      </body>
    </html>
    `);
});

export default router;
