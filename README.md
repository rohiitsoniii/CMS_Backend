# Headless CMS Backend API

Robust, enterprise-grade Headless Content Management System (CMS) SaaS Platform backend built with Node.js, Express, TypeScript, MongoDB (Mongoose), and Apollo GraphQL.

---

## 🚀 Features

- **Multi-Tenant Architecture**: Complete tenant isolation, workspaces, and team memberships.
- **Dynamic Content Types & Schema Engine**: Field validations, relations, localization, and polymorphic content modeling.
- **REST & GraphQL APIs**: Full CRUD REST endpoints alongside Apollo Server GraphQL querying.
- **Role-Based Access Control (RBAC)**: Granular permissions, custom roles, and resource policies.
- **Authentication & Security**:
  - JWT Access & Refresh tokens
  - MFA / TOTP 2FA authentication
  - SSO Configuration support
  - Rate limiting, Helmet, CORS, and request sanitization
- **Real-Time Collaboration**: Socket.IO integration for live multi-user editing, cursor presence, and locks.
- **Scheduled Publishing**: Bull queue & Cron workers for automated content scheduling and transitions.
- **Media Management & CDN Support**: Chunked file upload, image processing, and secure asset delivery.
- **Audit Logs & Version History**: Full delta tracking, version rollbacks, and compliance audit trail.
- **Webhooks & Integrations**: Event-driven webhook delivery with HMAC signature verification and retry logic.
- **Embedded In-Memory MongoDB Fallback**: Automatic initialization of `MongoMemoryServer` for instant zero-configuration development and automated testing.

---

## 🛠️ Tech Stack

- **Runtime**: Node.js (v18+)
- **Language**: TypeScript (Strict Mode)
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **GraphQL**: Apollo Server v4 & GraphQL Tag
- **Caching & Queues**: Redis (ioredis) & Bull
- **Real-time**: Socket.IO v4
- **Security**: Helmet, bcryptjs, Speakeasy, JSONWebToken, Express Rate Limit
- **Validation**: Joi & Express Validator
- **Logging & Monitoring**: Pino & OpenTelemetry

---

## 📦 Getting Started

### 1. Prerequisites
- Node.js (v18.0.0 or higher)
- npm or pnpm
- MongoDB (Optional: an embedded `MongoMemoryServer` will automatically spin up if local MongoDB is not detected)

### 2. Installation
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and configure your credentials:
```bash
cp .env.example .env
```

Key environment variables:
```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/headless_cms
JWT_SECRET=your_jwt_secret_key
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key
FRONTEND_URL=http://localhost:5174
```

### 4. Running the Development Server
```bash
npm run dev
```
The server will start at `http://localhost:5000`. GraphQL Playground/Sandbox is available at `http://localhost:5000/graphql`.

### 5. Seeding Demo Data
To seed initial demo workspaces, users, and content:
```bash
npm run seed
```
Default demo account:
- **Email**: `demo@example.com`
- **Password**: `Demo@123`

---

## 📂 Project Structure

```
backend/
├── docs/                 # API documentation & schemas
├── public/               # Public assets & templates
├── src/
│   ├── config/           # Database, Redis, and app configuration
│   ├── controllers/      # Route controllers (Auth, Content, Media, RBAC, etc.)
│   ├── middleware/       # Auth, error handling, rate limiting, validation
│   ├── models/           # Mongoose schemas & TypeScript interfaces
│   ├── routes/           # REST API route definitions
│   ├── graphql/          # Apollo GraphQL schemas & resolvers
│   ├── services/         # Business logic services (Email, S3, Webhooks, etc.)
│   ├── utils/            # Shared utilities & helpers
│   ├── workers/          # Bull background workers & Cron jobs
│   ├── scripts/          # Database seeders & test suites
│   ├── app.ts            # Express application bootstrap
│   └── server.ts         # Server entry point
├── Dockerfile            # Container configuration
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

---

## 📜 License

MIT License. Designed and built for modern digital content workflows.