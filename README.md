# React + Vite

## Local setup

1. Copy `.env.example` to `.env` and replace both placeholder values with unique secrets.
2. Set `JWT_SECRET` to a random value of at least 32 characters.
3. `ADMIN_PASSWORD` is used only to create the initial `admin` account when the database has no users. Existing local accounts are not changed.
4. Keep `.env` and the local SQLite database private; both are excluded by `.gitignore`.
5. Run `npm install`, then `npm run dev`.

The server requires `JWT_SECRET` on every start. `ADMIN_PASSWORD` is required only when initializing a new, empty database. Do not use the example placeholder values in a deployed environment.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
