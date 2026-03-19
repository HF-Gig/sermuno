## Setup

1. Install dependencies:
   - backend: `cd backend && npm install`
   - frontend: `cd frontend && npm install`
2. Create env files from the examples:
   - `backend/.env.example` -> `backend/.env`
   - `frontend/.env.example` -> `frontend/.env`
3. Start the apps:
   - backend: `cd backend && npm run start:dev`
   - frontend: `cd frontend && npm run dev`

## Backend env

Required to boot:
- `DATABASE_URL`
- `REDIS_URL`
- `ENCRYPTION_KEY`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `PORT`

Feature-specific values in `backend/.env.example` can stay blank until you use those features:
- SMTP / email delivery
- Stripe billing
- Google / Microsoft / Zoom OAuth
- calendar ingest
- attachment storage
- feature flags

## Frontend env

- `VITE_API_URL`
- `VITE_CONTACT_EMAIL`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_VAPID_KEY`
