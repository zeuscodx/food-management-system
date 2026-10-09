# Food Management System

Food-management web application built with React, Vite, Express, and SQLite.

## Run locally

1. Install Node.js 22.
2. Copy `.env.example` to `.env` and replace both placeholder values with unique secrets.
3. Set `JWT_SECRET` to a random value of at least 32 characters.
4. `ADMIN_PASSWORD` is used only to create the initial `admin` account when the database has no users. Existing accounts are not changed.
5. Install dependencies and start the app:

   ```sh
   npm install
   npm run dev
   ```

The development frontend is served by Vite, and the API runs on port 3001. For production, `npm run build` creates the frontend bundle and `npm start` serves the API and bundle together.

## Deploy to Railway

1. Create a Railway project and deploy this GitHub repository as a service. Railway reads [`railway.json`](./railway.json) for the build, start, health-check, and restart settings.
2. Before the first deployment, add a Railway Volume to the service and mount it at `/data`. SQLite data must live on this persistent volume or it can be lost when the service is redeployed.
3. In the service's Variables settings, set:
   - `JWT_SECRET`: a unique random value of at least 32 characters.
   - `ADMIN_PASSWORD`: a unique initial admin password. It is only required when creating a fresh database with no users.
   - `DATABASE_PATH`: `/data/food_management.db`
4. Deploy the service. Railway supplies `PORT`; the server listens on that port and `/api/health` is used as the health check.
5. Open the generated Railway domain and sign in as `admin` using the `ADMIN_PASSWORD` set before the first deployment. Change or rotate credentials as appropriate.

Keep these values in Railway Variables, not in GitHub. Never upload `.env` files or the local SQLite database. Back up the mounted database volume regularly.

## User registration

Anyone with access to the public site can create an account from the login page. New accounts receive the `Employee` role and can sign in immediately. Employees can view application data and record inventory transactions and distributions. Only administrators can create, edit, or delete sectors, centers, people, and items, or change system settings. Usernames must be 3-32 lowercase English letters, numbers, dots, underscores, or hyphens; passwords must be at least 8 characters. Public registration does not require email verification.
