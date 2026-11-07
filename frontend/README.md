# Image Pipeline Console — Frontend (`frontend/`)

This directory contains the **React 19 + TypeScript + Tailwind CSS v4 + GSAP** Admin Dashboard for the [Serverless Image Processing Pipeline](../README.md).

## Tech Stack
- **Framework:** React 19 + TypeScript + Vite 8
- **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) with persistent Dark/Light mode
- **Animations:** GSAP 3 + `@gsap/react` (`useGSAP` stagger entrance, card hover physics, and filter transitions)
- **Icons & Utilities:** `lucide-react`, `date-fns`

## Environment Variables (`.env`)
```env
VITE_API_BASE_URL=http://35.87.135.224:5000
```

## Available Scripts
```bash
npm install       # Install dependencies
npm run dev       # Start local Vite dev server (http://localhost:5173)
npm run lint      # Run ESLint validation
npm run build     # Type-check (tsc -b) and build production bundle to dist/
```
