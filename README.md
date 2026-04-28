# Project Deadline Tracker Starter

A lean starter for the project/deadline tracker we mapped out.

## What this includes

- React + Vite frontend
- Mobile-friendly layout
- Deadline dashboard
- Month calendar
- Calendar toggles:
  - Design milestones
  - Tasks
  - CA deadlines
- Project list
- Supabase schema for:
  - users/profiles
  - projects
  - project members
  - buildings
  - milestones
  - milestone-building links
  - tasks
  - milestone change requests
  - notifications
- `calendar_items` database view that feeds both dashboard and calendar

## Color logic

- Design milestones: red
- Task due dates: orange
- CA deadlines/shop drawings/RFIs: dark yellow

## Calendar event layout

Project title is the main line.

```text
Project Title
Building / Buildings
Milestone or Task Label
```

If multiple buildings share the same milestone/date, they are combined into one calendar event.

## Setup

1. Create a Supabase project.
2. Open Supabase SQL Editor.
3. Run `supabase/schema.sql`.
4. Copy your Supabase URL and anon key.
5. Create a `.env` file:

```bash
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

6. Install and run:

```bash
npm install
npm run dev
```

## Current state

The UI currently uses sample data in `src/main.jsx`.

Next build step:
- replace sample data with Supabase queries
- add login
- add create/edit forms
- add milestone change request approval flow
- add notification creation
