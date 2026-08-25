require('dotenv').config();

const express = require('express');

const { Pool } = require('pg');

 

const app = express();

const PORT = process.env.PORT || 3000;

 

app.use(express.json());

 

// Initialize PostgreSQL Connection Pool

const pool = new Pool({

  connectionString: process.env.DATABASE_URL,

  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false

});

 

// Create the 'tasks' table automatically on startup if it doesn't exist

async function initDb() {

  const query = `

    CREATE TABLE IF NOT EXISTS tasks (

      id SERIAL PRIMARY KEY,

      title VARCHAR(255) NOT NULL,

      description TEXT,

      due_date DATE NOT NULL,

      due_time VARCHAR(10),

      repeat_freq VARCHAR(10) DEFAULT 'none',

      repeat_interval INTEGER DEFAULT 1,

      repeat_weekdays VARCHAR(20) DEFAULT '',

      repeat_monthdays VARCHAR(100) DEFAULT '',

      repeat_exceptions TEXT DEFAULT ''

    );

  `;

  try {

    await pool.query(query);

    // Migrate older tables that predate the recurrence columns.

    await pool.query(`

      ALTER TABLE tasks

        ADD COLUMN IF NOT EXISTS repeat_freq VARCHAR(10) DEFAULT 'none',

        ADD COLUMN IF NOT EXISTS repeat_interval INTEGER DEFAULT 1,

        ADD COLUMN IF NOT EXISTS repeat_weekdays VARCHAR(20) DEFAULT '',

        ADD COLUMN IF NOT EXISTS repeat_monthdays VARCHAR(100) DEFAULT '',

        ADD COLUMN IF NOT EXISTS repeat_exceptions TEXT DEFAULT '';

    `);

    console.log('Database initialized successfully.');

  } catch (err) {

    console.error('Error initializing database:', err);

  }

}

 

// Status calculation logic

function getTaskStatus(dueDateStr, dueTimeStr) {

  const now = new Date();

 

  // Build the due date in LOCAL time from its components to avoid UTC shifting the day.

  const ymd = new Date(dueDateStr).toISOString().split('T')[0].split('-').map(Number);

  const timePart = (dueTimeStr && dueTimeStr.trim()) ? dueTimeStr : '23:59:59';

  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);

  const taskDate = new Date(ymd[0], ymd[1] - 1, ymd[2], hh, mm, ss);

 

  if (isNaN(taskDate.getTime())) {

    return { color: 'gray', label: 'Invalid Date' };

  }

 

  const diffMs = taskDate - now;

  const diffHours = diffMs / (1000 * 60 * 60);

 

  // Overdue only once the current date+time has passed the task's date+time.

  if (diffMs < 0) {

    return { color: '#ef4444', label: 'Overdue' };

  } else if (diffHours <= 24) {

    return { color: '#eab308', label: 'Due Soon' };

  } else {

    return { color: '#22c55e', label: 'Upcoming' };

  }

}

 

// API Routes

app.get('/api/tasks', async (req, res) => {

  try {

    const result = await pool.query('SELECT * FROM tasks ORDER BY due_date ASC');

    const enrichedTasks = result.rows.map(row => ({

      id: row.id,

      title: row.title,

      description: row.description,

      dueDate: row.due_date.toISOString().split('T')[0],

      dueTime: row.due_time,

      status: getTaskStatus(row.due_date, row.due_time),

      repeat: {

        freq: row.repeat_freq || 'none',

        interval: row.repeat_interval || 1,

        weekdays: row.repeat_weekdays ? row.repeat_weekdays.split(',').filter(Boolean).map(Number) : [],

        monthdays: row.repeat_monthdays ? row.repeat_monthdays.split(',').filter(Boolean).map(Number) : [],

        exceptions: row.repeat_exceptions ? row.repeat_exceptions.split(',').filter(Boolean) : []

      }

    }));

    res.json(enrichedTasks);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Database query failed' });

  }

});

 

app.post('/api/tasks', async (req, res) => {

  const { title, description, dueDate, dueTime, repeat } = req.body;

  if (!title || !dueDate) {

    return res.status(400).json({ error: 'Title and Due Date are required.' });

  }

 

  // Normalize recurrence input defensively.

  const allowedFreq = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

  const freq = repeat && allowedFreq.includes(repeat.freq) ? repeat.freq : 'none';

  let interval = repeat && Number.isInteger(repeat.interval) ? repeat.interval : 1;

  if (interval < 1) interval = 1;

  if (interval > 999) interval = 999;

 

  const weekdays = (repeat && Array.isArray(repeat.weekdays))

    ? repeat.weekdays.filter(n => Number.isInteger(n) && n >= 0 && n <= 6)

    : [];

  const monthdays = (repeat && Array.isArray(repeat.monthdays))

    ? repeat.monthdays.filter(n => Number.isInteger(n) && n >= 1 && n <= 31)

    : [];

 

  try {

    const result = await pool.query(

      `INSERT INTO tasks

        (title, description, due_date, due_time, repeat_freq, repeat_interval, repeat_weekdays, repeat_monthdays, repeat_exceptions)

       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,

      [

        title,

        description || '',

        dueDate,

        dueTime || '',

        freq,

        interval,

        weekdays.join(','),

        monthdays.join(','),

        ''

      ]

    );

    res.status(201).json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Failed to insert task' });

  }

});

 

// Delete a single occurrence of a repeating task by adding it to the exceptions list.

app.post('/api/tasks/:id/skip', async (req, res) => {

  const id = parseInt(req.params.id);

  const { date } = req.body; // YYYY-MM-DD of the occurrence to skip

  if (!date) return res.status(400).json({ error: 'Occurrence date required.' });

 

  try {

    const cur = await pool.query('SELECT repeat_exceptions FROM tasks WHERE id = $1', [id]);

    if (cur.rows.length === 0) return res.status(404).json({ error: 'Task not found.' });

 

    const existing = cur.rows[0].repeat_exceptions

      ? cur.rows[0].repeat_exceptions.split(',').filter(Boolean)

      : [];

    if (!existing.includes(date)) existing.push(date);

 

    await pool.query('UPDATE tasks SET repeat_exceptions = $1 WHERE id = $2', [existing.join(','), id]);

    res.json({ message: 'Occurrence skipped' });

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Failed to skip occurrence' });

  }

});

 

app.delete('/api/tasks/:id', async (req, res) => {

  const id = parseInt(req.params.id);

  try {

    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);

    res.json({ message: 'Task deleted' });

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Failed to delete task' });

  }

});

 

// Single Page Application Frontend — Dark, Apple-style, two-column

app.get('/', (req, res) => {

  res.send(`

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Agenda</title>

<style>

:root {

  --bg: #0b0b0d;

  --bg-elevated: #151517;

  --card-bg: rgba(28, 28, 32, 0.72);

  --card-border: rgba(255, 255, 255, 0.08);

  --text-main: #f5f5f7;

  --text-muted: #8a8a90;

  --text-faint: #5a5a60;

  --accent: #dbf24a;

  --accent-soft: rgba(219, 242, 74, 0.14);

  --accent-text: #0b0b0d;

  --field-bg: rgba(255, 255, 255, 0.04);

  --shadow: 0 12px 40px rgba(0, 0, 0, 0.45);

  --radius: 18px;

}

 

* { box-sizing: border-box; }

 

body {

  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

  background: radial-gradient(1200px 600px at 85% -5%, rgba(219, 242, 74, 0.10), transparent 60%),

              radial-gradient(900px 500px at 0% 100%, rgba(219, 242, 74, 0.05), transparent 55%),

              var(--bg);

  color: var(--text-main);

  margin: 0;

  padding: 0;

  min-height: 100vh;

  -webkit-font-smoothing: antialiased;

}

 

.app-wrapper {

  max-width: 1240px;

  margin: 0 auto;

  padding: 3.5rem 2rem;

}

 

header {

  margin-bottom: 2.5rem;

}

 

header h1 {

  font-size: 2.4rem;

  font-weight: 700;

  letter-spacing: -0.03em;

  margin: 0 0 0.35rem 0;

}

 

header p {

  color: var(--text-muted);

  margin: 0;

  font-size: 1.05rem;

}

 

/* Two-column layout */

.layout {

  display: grid;

  grid-template-columns: 420px 1fr;

  gap: 1.75rem;

  align-items: start;

}

 

@media (max-width: 900px) {

  .layout { grid-template-columns: 1fr; }

}

 

.column {

  display: flex;

  flex-direction: column;

  gap: 1.5rem;

  min-width: 0;

}

 

.card {

  background: var(--card-bg);

  backdrop-filter: blur(24px);

  -webkit-backdrop-filter: blur(24px);

  border: 1px solid var(--card-border);

  border-radius: var(--radius);

  padding: 1.6rem;

  box-shadow: var(--shadow);

}

 

/* Form */

form { display: flex; flex-direction: column; gap: 1.1rem; }

.form-group { display: flex; flex-direction: column; gap: 0.45rem; }

 

label {

  font-size: 0.72rem;

  font-weight: 600;

  color: var(--text-muted);

  text-transform: uppercase;

  letter-spacing: 0.06em;

}

 

input, textarea {

  font-family: inherit;

  font-size: 0.98rem;

  padding: 0.8rem 0.95rem;

  background: var(--field-bg);

  border: 1px solid var(--card-border);

  border-radius: 11px;

  color: var(--text-main);

  outline: none;

  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;

}

 

input::placeholder, textarea::placeholder { color: var(--text-faint); }

 

input:focus, textarea:focus {

  border-color: var(--accent);

  box-shadow: 0 0 0 4px var(--accent-soft);

  background: rgba(255, 255, 255, 0.06);

}

 

/* Dark date/time picker icons */

input[type="date"], input[type="time"] { color-scheme: dark; }

 

textarea { resize: vertical; min-height: 70px; }

 

.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }

 

button.submit-btn {

  background: var(--accent);

  color: var(--accent-text);

  border: none;

  border-radius: 11px;

  padding: 0.9rem;

  font-size: 0.98rem;

  font-weight: 700;

  cursor: pointer;

  transition: transform 0.15s ease, filter 0.2s ease;

  margin-top: 0.2rem;

}

 

button.submit-btn:hover { filter: brightness(1.06); transform: translateY(-1px); }

button.submit-btn:active { transform: translateY(0); }

 

/* Section header */

.section-header {

  display: flex;

  align-items: center;

  justify-content: space-between;

  margin: 0.25rem 0.15rem 1rem;

}

 

.section-header h2 {

  font-size: 1.15rem;

  font-weight: 650;

  margin: 0;

  letter-spacing: -0.01em;

}

 

.count-pill {

  font-size: 0.75rem;

  font-weight: 600;

  color: var(--text-muted);

  background: var(--field-bg);

  border: 1px solid var(--card-border);

  padding: 0.2rem 0.6rem;

  border-radius: 20px;

}

 

/* Task list */

.task-list {

  display: flex;

  flex-direction: column;

  gap: 0.75rem;

  max-height: 640px;

  overflow-y: auto;

  padding-right: 4px;

}

.task-list::-webkit-scrollbar { width: 6px; }

.task-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 10px; }

 

.task-card {

  background: var(--bg-elevated);

  border: 1px solid var(--card-border);

  border-radius: 14px;

  padding: 1.1rem 1.2rem;

  display: flex;

  align-items: flex-start;

  justify-content: space-between;

  gap: 0.9rem;

  transition: transform 0.2s ease, border-color 0.2s ease;

}

.task-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.16); }

 

.task-content h3 { font-size: 1.02rem; font-weight: 600; margin: 0 0 0.3rem 0; }

.task-content p { font-size: 0.88rem; color: var(--text-muted); margin: 0 0 0.6rem 0; line-height: 1.45; }

 

.task-meta {

  display: flex; align-items: center; flex-wrap: wrap;

  gap: 0.6rem; font-size: 0.78rem; color: var(--text-muted); font-weight: 500;

}

 

.status-badge {

  display: inline-flex; align-items: center; gap: 0.4rem;

  padding: 0.25rem 0.6rem; border-radius: 20px;

  font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em;

}

.status-dot-inner { width: 7px; height: 7px; border-radius: 50%; }

 

.delete-btn {

  background: rgba(239, 68, 68, 0.12);

  color: #f87171;

  border: none; border-radius: 9px;

  padding: 0.45rem 0.75rem;

  font-size: 0.8rem; font-weight: 600; cursor: pointer;

  transition: background 0.2s ease; flex-shrink: 0;

}

.delete-btn:hover { background: rgba(239, 68, 68, 0.22); }

 

.empty-state { text-align: center; padding: 2.5rem 1rem; color: var(--text-faint); font-size: 0.92rem; }

 

/* Calendar */

.calendar-head {

  display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.4rem;

}

.calendar-head h2 { margin: 0; font-size: 1.35rem; font-weight: 650; letter-spacing: -0.01em; }

.calendar-nav { display: flex; gap: 0.5rem; }

.calendar-nav button {

  width: 34px; height: 34px; border-radius: 10px;

  background: var(--field-bg); border: 1px solid var(--card-border);

  color: var(--text-main); font-size: 1rem; cursor: pointer;

  transition: background 0.2s ease;

}

.calendar-nav button:hover { background: rgba(255,255,255,0.09); }

 

.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.4rem; }

 

.cal-dow {

  text-align: center; font-size: 0.72rem; font-weight: 600;

  color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.05em;

  padding-bottom: 0.5rem;

}

 

.cal-cell {

  aspect-ratio: 1 / 1;

  display: flex; flex-direction: column; align-items: center; justify-content: center;

  border-radius: 12px;

  font-size: 0.95rem; font-weight: 500;

  color: var(--text-main);

  background: transparent;

  border: 1px solid transparent;

  position: relative;

  transition: background 0.15s ease;

}

.cal-cell.empty { background: transparent; }

.cal-cell.other-month { color: var(--text-faint); }

.cal-cell:not(.empty):hover { background: var(--field-bg); }

 

.cal-cell.today {

  background: var(--accent);

  color: var(--accent-text);

  font-weight: 700;

}

 

.cal-dot {

  position: absolute; bottom: 7px;

  width: 5px; height: 5px; border-radius: 50%;

  background: var(--accent);

}

.cal-cell.today .cal-dot { background: var(--accent-text); }

 

/* Selected (filtered) day — outlined ring, distinct from today's solid fill */

.cal-cell.selected {

  border-color: var(--accent);

  background: var(--accent-soft);

  color: var(--text-main);

  font-weight: 700;

}

.cal-cell.today.selected {

  box-shadow: 0 0 0 2px var(--accent-soft), 0 0 0 3px var(--accent);

}

 

.clear-filter {

  background: var(--accent-soft);

  color: var(--accent);

  border: 1px solid rgba(219, 242, 74, 0.3);

  border-radius: 20px;

  padding: 0.2rem 0.65rem;

  font-size: 0.72rem;

  font-weight: 600;

  cursor: pointer;

  transition: background 0.2s ease;

}

.clear-filter:hover { background: rgba(219, 242, 74, 0.22); }

 

/* Repeat control in form */

.repeat-row { display: flex; gap: 0.6rem; align-items: stretch; }

select#repeatSelect, #customFreq {

  font-family: inherit;

  font-size: 0.98rem;

  padding: 0.8rem 0.95rem;

  background: var(--field-bg);

  border: 1px solid var(--card-border);

  border-radius: 11px;

  color: var(--text-main);

  outline: none;

  cursor: pointer;

  flex: 1;

  color-scheme: dark;

  transition: border-color 0.2s ease, box-shadow 0.2s ease;

}

select#repeatSelect:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }

 

.edit-custom-btn {

  background: var(--accent-soft);

  color: var(--accent);

  border: 1px solid rgba(219, 242, 74, 0.3);

  border-radius: 11px;

  padding: 0 1rem;

  font-size: 0.9rem;

  font-weight: 600;

  cursor: pointer;

  transition: background 0.2s ease;

  white-space: nowrap;

}

.edit-custom-btn:hover { background: rgba(219, 242, 74, 0.22); }

 

.repeat-summary {

  margin: 0.15rem 0 0 0;

  font-size: 0.82rem;

  color: var(--accent);

  font-weight: 500;

}

 

/* Modal */

.modal-overlay {

  position: fixed; inset: 0;

  background: rgba(0, 0, 0, 0.6);

  backdrop-filter: blur(6px);

  -webkit-backdrop-filter: blur(6px);

  display: flex; align-items: center; justify-content: center;

  z-index: 100;

  padding: 1.5rem;

  animation: fadeIn 0.18s ease;

}

@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

 

.modal-sheet {

  width: 100%; max-width: 440px;

  max-height: 88vh; overflow-y: auto;

  background: #1c1c20;

  border: 1px solid var(--card-border);

  border-radius: 22px;

  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);

  animation: sheetIn 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);

}

@keyframes sheetIn { from { transform: translateY(14px) scale(0.98); opacity: 0; } to { transform: none; opacity: 1; } }

 

.modal-head {

  display: grid;

  grid-template-columns: 1fr auto 1fr;

  align-items: center;

  padding: 1.1rem 1.25rem;

  position: sticky; top: 0;

  background: #1c1c20;

  border-bottom: 1px solid var(--card-border);

  z-index: 1;

}

.modal-head h3 { margin: 0; font-size: 1.1rem; font-weight: 650; text-align: center; }

.modal-cancel {

  background: none; border: none; color: var(--text-muted);

  font-size: 0.95rem; cursor: pointer; justify-self: start; padding: 0;

}

.modal-cancel:hover { color: var(--text-main); }

.modal-confirm {

  width: 36px; height: 36px; border-radius: 50%;

  background: var(--accent); color: var(--accent-text);

  border: none; font-size: 1.1rem; font-weight: 700; cursor: pointer;

  justify-self: end;

  display: flex; align-items: center; justify-content: center;

  transition: filter 0.2s ease;

}

.modal-confirm:hover { filter: brightness(1.08); }

 

.modal-body { padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }

 

.modal-group {

  background: var(--field-bg);

  border: 1px solid var(--card-border);

  border-radius: 14px;

  overflow: hidden;

}

.modal-line {

  display: flex; align-items: center; justify-content: space-between;

  padding: 1rem 1.1rem;

  font-size: 1.02rem;

}

.modal-line.divider { border-top: 1px solid var(--card-border); }

 

.modal-hint {

  margin: -0.35rem 0.4rem 0;

  font-size: 0.85rem;

  color: var(--text-muted);

}

 

/* Stepper */

.stepper { display: flex; align-items: center; gap: 0.25rem; }

.stepper button {

  width: 30px; height: 30px; border-radius: 8px;

  background: rgba(255,255,255,0.06); border: 1px solid var(--card-border);

  color: var(--text-main); font-size: 1.1rem; cursor: pointer; line-height: 1;

  transition: background 0.15s ease;

}

.stepper button:hover { background: rgba(255,255,255,0.12); }

.stepper input {

  width: 52px; text-align: center;

  font-size: 1rem; padding: 0.4rem;

  background: transparent; border: none; color: var(--text-main);

  -moz-appearance: textfield;

}

.stepper input::-webkit-outer-spin-button,

.stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

 

/* Weekday rows */

.weekday-row {

  display: flex; align-items: center; justify-content: space-between;

  padding: 0.9rem 1.1rem; cursor: pointer;

  font-size: 1.0rem;

  border-top: 1px solid var(--card-border);

  transition: background 0.15s ease;

}

.weekday-row:first-child { border-top: none; }

.weekday-row:hover { background: rgba(255,255,255,0.03); }

.weekday-row .check { color: var(--accent); font-size: 1.05rem; opacity: 0; transition: opacity 0.15s ease; }

.weekday-row.selected .check { opacity: 1; }

 

/* Month-day grid */

.monthday-label { padding: 0.9rem 1.1rem 0.5rem; font-size: 1.0rem; }

.monthday-grid {

  display: grid; grid-template-columns: repeat(7, 1fr);

  padding: 0.4rem 0.6rem 0.8rem;

}

.monthday-cell {

  aspect-ratio: 1 / 1;

  display: flex; align-items: center; justify-content: center;

  font-size: 0.92rem; cursor: pointer;

  border-radius: 9px;

  transition: background 0.12s ease;

}

.monthday-cell:hover { background: rgba(255,255,255,0.06); }

.monthday-cell.selected { background: var(--accent); color: var(--accent-text); font-weight: 700; }

 

/* Repeat indicator on task cards */

.repeat-chip {

  display: inline-flex; align-items: center; gap: 0.3rem;

  font-size: 0.76rem; color: var(--accent);

}

 

/* Greeting banner */

.greeting-eyebrow {

  color: var(--accent);

  font-size: 0.78rem;

  font-weight: 700;

  text-transform: uppercase;

  letter-spacing: 0.12em;

  margin: 0 0 0.6rem 0;

}

#greetingBody { line-height: 1.5; }

.greeting-tasks {

  list-style: none;

  margin: 0.6rem 0 0 0;

  padding: 0;

  display: flex;

  flex-direction: column;

  gap: 0.4rem;

}

.greeting-tasks li {

  display: flex;

  align-items: center;

  gap: 0.6rem;

  color: var(--text-main);

  font-size: 1.0rem;

}

.greeting-tasks li .g-dot {

  width: 6px; height: 6px; border-radius: 50%;

  background: var(--accent); flex-shrink: 0;

}

.greeting-tasks li .g-time {

  color: var(--text-muted);

  font-size: 0.88rem;

  font-variant-numeric: tabular-nums;

}

</style>

</head>

<body>

<div class="app-wrapper">

  <header>

    <p class="greeting-eyebrow" id="greetingEyebrow"></p>

    <h1 id="greetingTitle">Welcome Shaan</h1>

    <p id="greetingBody">Loading your day…</p>

  </header>

 

  <div class="layout">

    <!-- LEFT: add task + task log -->

    <div class="column">

      <div class="card">

        <form id="taskForm">

          <div class="form-group">

            <label for="title">Task Name</label>

            <input type="text" id="title" placeholder="e.g. Design review presentation" required />

          </div>

          <div class="form-group">

            <label for="description">Description</label>

            <textarea id="description" placeholder="Add additional details..."></textarea>

          </div>

          <div class="form-row">

            <div class="form-group">

              <label for="dueDate">Due Date</label>

              <input type="date" id="dueDate" required />

            </div>

            <div class="form-group">

              <label for="dueTime">Time</label>

              <input type="time" id="dueTime" />

            </div>

          </div>

 

          <div class="form-group">

            <label for="repeatSelect">Repeat</label>

            <div class="repeat-row">

              <select id="repeatSelect">

                <option value="none">Never</option>

                <option value="daily">Daily</option>

                <option value="weekly">Weekly</option>

                <option value="monthly">Monthly</option>

                <option value="yearly">Yearly</option>

                <option value="custom">Custom…</option>

              </select>

              <button type="button" id="editCustomBtn" class="edit-custom-btn" style="display:none;">Edit</button>

            </div>

            <p class="repeat-summary" id="repeatSummary" style="display:none;"></p>

          </div>

 

          <button type="submit" class="submit-btn">Add Task</button>

        </form>

      </div>

 

      <section>

        <div class="section-header">

          <h2 id="tasksHeading">Tasks</h2>

          <div style="display:flex; align-items:center; gap:0.5rem;">

            <button id="clearFilter" class="clear-filter" style="display:none;">Clear filter ✕</button>

            <span class="count-pill" id="taskCount">0</span>

          </div>

        </div>

        <div id="taskList" class="task-list"></div>

      </section>

    </div>

 

    <!-- RIGHT: monthly calendar -->

    <div class="column">

      <div class="card">

        <div class="calendar-head">

          <h2 id="calMonthLabel"></h2>

          <div class="calendar-nav">

            <button id="prevMonth" aria-label="Previous month">‹</button>

            <button id="nextMonth" aria-label="Next month">›</button>

          </div>

        </div>

        <div class="calendar-grid" id="calendarGrid"></div>

      </div>

    </div>

  </div>

</div>

 

<!-- Custom recurrence modal -->

<div class="modal-overlay" id="customModal" style="display:none;">

  <div class="modal-sheet">

    <div class="modal-head">

      <button type="button" class="modal-cancel" id="customCancel">Cancel</button>

      <h3>Custom</h3>

      <button type="button" class="modal-confirm" id="customConfirm" aria-label="Confirm">✓</button>

    </div>

 

    <div class="modal-body">

      <div class="modal-group">

        <div class="modal-line">

          <span>Frequency</span>

          <select id="customFreq">

            <option value="daily">Daily</option>

            <option value="weekly">Weekly</option>

            <option value="monthly">Monthly</option>

            <option value="yearly">Yearly</option>

          </select>

        </div>

        <div class="modal-line divider">

          <span>Every</span>

          <div class="stepper">

            <button type="button" id="intervalMinus">−</button>

            <input type="number" id="customInterval" min="1" max="999" value="1" />

            <button type="button" id="intervalPlus">+</button>

          </div>

        </div>

      </div>

      <p class="modal-hint" id="customHint">Event will occur every day.</p>

 

      <!-- Weekly: weekday chooser -->

      <div class="modal-group" id="weekdayGroup" style="display:none;">

        <div class="weekday-row" data-day="0"><span>Sunday</span><span class="check">✓</span></div>

        <div class="weekday-row" data-day="1"><span>Monday</span><span class="check">✓</span></div>

        <div class="weekday-row" data-day="2"><span>Tuesday</span><span class="check">✓</span></div>

        <div class="weekday-row" data-day="3"><span>Wednesday</span><span class="check">✓</span></div>

        <div class="weekday-row" data-day="4"><span>Thursday</span><span class="check">✓</span></div>

        <div class="weekday-row" data-day="5"><span>Friday</span><span class="check">✓</span></div>

        <div class="weekday-row" data-day="6"><span>Saturday</span><span class="check">✓</span></div>

      </div>

 

      <!-- Monthly: day-of-month grid -->

      <div class="modal-group" id="monthdayGroup" style="display:none;">

        <div class="monthday-label">On the…</div>

        <div class="monthday-grid" id="monthdayGrid"></div>

      </div>

    </div>

  </div>

</div>

 

<script>

let tasks = [];

let selectedDay = null; // YYYY-MM-DD when a calendar day filter is active

const today = new Date();

let viewYear = today.getFullYear();

let viewMonth = today.getMonth();

 

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DOW_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

 

// Working recurrence rule for the task currently being created.

// freq: none | daily | weekly | monthly | yearly

let currentRepeat = { freq: 'none', interval: 1, weekdays: [], monthdays: [] };

// Draft used inside the custom modal so Cancel discards changes.

let modalDraft = { freq: 'daily', interval: 1, weekdays: [], monthdays: [] };

 

async function loadTasks() {

  const res = await fetch('/api/tasks');

  tasks = await res.json();

  renderGreeting();

  renderTasks();

  renderCalendar();

}

 

// Time-of-day greeting phrases (chosen at random within the current window)

const GREETINGS = {

  morning: [

    'Good morning',

    'Rise and shine',

    'Morning, Shaan',

    'A fresh start'

  ],

  afternoon: [

    'Good afternoon',

    'Hope your day is going well',

    'Afternoon, Shaan',

    'Keeping the momentum'

  ],

  evening: [

    'Good evening',

    'Winding down',

    'Evening, Shaan',

    'Home stretch'

  ],

  night: [

    'Burning the midnight oil',

    'Working late',

    'Still up',

    'Quiet hours'

  ]

};

 

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

 

function timeBucket(h) {

  if (h >= 5 && h < 12) return 'morning';

  if (h >= 12 && h < 17) return 'afternoon';

  if (h >= 17 && h < 22) return 'evening';

  return 'night';

}

 

function todayStr() {

  return today.getFullYear() + '-' +

         String(today.getMonth() + 1).padStart(2, '0') + '-' +

         String(today.getDate()).padStart(2, '0');

}

 

// ---- Recurrence occurrence engine ----

// All comparisons use local date components to stay timezone-consistent.

 

function parseYMD(str) {

  const [y, m, d] = str.split('-').map(Number);

  return new Date(y, m - 1, d);

}

function toYMD(dateObj) {

  return dateObj.getFullYear() + '-' +

         String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +

         String(dateObj.getDate()).padStart(2, '0');

}

// Whole-day difference between two YMD dates (b - a) ignoring DST wrinkles.

function dayDiff(aStr, bStr) {

  const a = parseYMD(aStr), b = parseYMD(bStr);

  return Math.round((b - a) / 86400000);

}

function monthDiff(aStr, bStr) {

  const a = parseYMD(aStr), b = parseYMD(bStr);

  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());

}

 

// Does the given repeating task occur on target (YMD string)?

// The anchor date (task.dueDate) is always the series start; nothing before it counts.

function occursOn(task, target) {

  const r = task.repeat;

  if (!r || r.freq === 'none') return task.dueDate === target;

 

  if (dayDiff(task.dueDate, target) < 0) return false;      // before series start

  if (r.exceptions && r.exceptions.includes(target)) return false; // skipped occurrence

 

  const anchor = parseYMD(task.dueDate);

  const t = parseYMD(target);

  const interval = r.interval || 1;

 

  if (r.freq === 'daily') {

    return dayDiff(task.dueDate, target) % interval === 0;

  }

 

  if (r.freq === 'weekly') {

    // Which weekdays? If none explicitly chosen, use the anchor's weekday.

    const days = (r.weekdays && r.weekdays.length) ? r.weekdays : [anchor.getDay()];

    if (!days.includes(t.getDay())) return false;

    // Align to the week containing the anchor (weeks start Sunday).

    const anchorWeekStart = new Date(anchor); anchorWeekStart.setDate(anchor.getDate() - anchor.getDay());

    const targetWeekStart = new Date(t); targetWeekStart.setDate(t.getDate() - t.getDay());

    const weeksApart = Math.round((targetWeekStart - anchorWeekStart) / (7 * 86400000));

    return weeksApart % interval === 0;

  }

 

  if (r.freq === 'monthly') {

    const md = monthDiff(task.dueDate, target);

    if (md < 0 || md % interval !== 0) return false;

    // Which days of month? Default to the anchor's day.

    const days = (r.monthdays && r.monthdays.length) ? r.monthdays : [anchor.getDate()];

    return days.includes(t.getDate());

  }

 

  if (r.freq === 'yearly') {

    if (t.getMonth() !== anchor.getMonth() || t.getDate() !== anchor.getDate()) return false;

    return (t.getFullYear() - anchor.getFullYear()) % interval === 0;

  }

 

  return false;

}

 

// Build the flat list of occurrences that fall on a given YMD date.

// Each occurrence carries the parent task plus this specific date.

function occurrencesOn(target) {

  const out = [];

  tasks.forEach(task => {

    if (occursOn(task, target)) {

      out.push(Object.assign({}, task, {

        occDate: target,

        isRepeat: task.repeat && task.repeat.freq !== 'none'

      }));

    }

  });

  return out;

}

 

// Human-readable summary of a recurrence rule.

function describeRepeat(r) {

  if (!r || r.freq === 'none') return '';

  const n = r.interval || 1;

  const every = n === 1 ? '' : n + ' ';

  if (r.freq === 'daily')  return 'Repeats every ' + (n === 1 ? 'day' : n + ' days');

  if (r.freq === 'weekly') {

    let base = 'Repeats every ' + (n === 1 ? 'week' : n + ' weeks');

    if (r.weekdays && r.weekdays.length) {

      const names = r.weekdays.slice().sort().map(d => DOW[d]).join(', ');

      base += ' on ' + names;

    }

    return base;

  }

  if (r.freq === 'monthly') {

    let base = 'Repeats every ' + (n === 1 ? 'month' : n + ' months');

    if (r.monthdays && r.monthdays.length) {

      base += ' on day ' + r.monthdays.slice().sort((a,b)=>a-b).join(', ');

    }

    return base;

  }

  if (r.freq === 'yearly') return 'Repeats every ' + (n === 1 ? 'year' : n + ' years');

  return '';

}

 

function renderGreeting() {

  const eyebrow = document.getElementById('greetingEyebrow');

  const title = document.getElementById('greetingTitle');

  const body = document.getElementById('greetingBody');

 

  const bucket = timeBucket(new Date().getHours());

  eyebrow.textContent = pick(GREETINGS[bucket]);

  title.textContent = 'Welcome Shaan';

 

  const dueToday = occurrencesOn(todayStr())

    .sort((a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99'));

 

  if (dueToday.length === 0) {

    body.innerHTML = "You're all caught up — nothing due today. Enjoy the breathing room.";

    return;

  }

 

  const items = dueToday.map(t => {

    const time = t.dueTime

      ? '<span class="g-time">' + t.dueTime + '</span>'

      : '';

    return '<li><span class="g-dot"></span><span>' + escapeHtml(t.title) + '</span>' + time + '</li>';

  }).join('');

 

  const noun = dueToday.length === 1 ? 'task' : 'tasks';

  body.innerHTML = 'Your ' + dueToday.length + ' ' + noun + ' for the day are as follows:' +

                   '<ul class="greeting-tasks">' + items + '</ul>';

}

 

// Basic HTML escaping so task titles can't break the markup

function escapeHtml(str) {

  return String(str)

    .replace(/&/g, '&amp;')

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;');

}

 

function renderTasks() {

  const listEl = document.getElementById('taskList');

  const headerEl = document.getElementById('tasksHeading');

  const clearBtn = document.getElementById('clearFilter');

 

  // Build the list of {task, date} rows to show.

  let rows;

  if (selectedDay) {

    rows = occurrencesOn(selectedDay);

  } else {

    // Unfiltered: show every task once at its next upcoming occurrence

    // (or its original date if that has passed and it doesn't repeat).

    rows = tasks.map(task => {

      const d = nextOccurrenceFrom(task, todayStr()) || task.dueDate;

      return Object.assign({}, task, {

        occDate: d,

        isRepeat: task.repeat && task.repeat.freq !== 'none'

      });

    }).sort((a, b) => a.occDate.localeCompare(b.occDate) ||

                       (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99'));

  }

 

  document.getElementById('taskCount').textContent = rows.length;

 

  if (selectedDay) {

    const p = selectedDay.split('-');

    const d = new Date(p[0], p[1] - 1, p[2]);

    headerEl.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    clearBtn.style.display = 'inline-flex';

  } else {

    headerEl.textContent = 'Tasks';

    clearBtn.style.display = 'none';

  }

 

  listEl.innerHTML = '';

 

  if (rows.length === 0) {

    listEl.innerHTML = '<div class="card empty-state">' +

      (selectedDay ? 'No tasks on this day.' : 'No tasks scheduled yet.') + '</div>';

    return;

  }

 

  rows.forEach(row => {

    const parts = row.occDate.split('-');

    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);

    const formattedDate = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

 

    // Status is computed for THIS occurrence's date, not the anchor.

    const st = statusForDate(row.occDate, row.dueTime);

 

    let bgStyle = 'rgba(34, 197, 94, 0.14)';

    let textStyle = '#86efac';

    if (st.color === '#ef4444') {

      bgStyle = 'rgba(239, 68, 68, 0.14)'; textStyle = '#fca5a5';

    } else if (st.color === '#eab308') {

      bgStyle = 'rgba(234, 179, 8, 0.16)'; textStyle = '#fde047';

    }

 

    const repeatChip = row.isRepeat

      ? '<span class="repeat-chip" title="' + escapeHtml(describeRepeat(row.repeat)) + '">🔁 Repeats</span>'

      : '';

 

    // Repeating occurrences get a "Skip" (this one) and "Delete series" control;

    // one-off tasks just get "Remove".

    const controls = row.isRepeat

      ? '<div style="display:flex; flex-direction:column; gap:0.35rem;">' +

          '<button class="delete-btn" onclick="skipOccurrence(' + row.id + ', \\'' + row.occDate + '\\')">Skip</button>' +

          '<button class="delete-btn" onclick="deleteTask(' + row.id + ', true)">Delete series</button>' +

        '</div>'

      : '<button class="delete-btn" onclick="deleteTask(' + row.id + ')">Remove</button>';

 

    const card = document.createElement('div');

    card.className = 'task-card';

    card.innerHTML = \`

      <div class="task-content">

        <h3>\${escapeHtml(row.title)}</h3>

        \${row.description ? \`<p>\${escapeHtml(row.description)}</p>\` : ''}

        <div class="task-meta">

          <span>📅 \${formattedDate}</span>

          \${row.dueTime ? \`<span>⏰ \${row.dueTime}</span>\` : ''}

          \${repeatChip}

          <span class="status-badge" style="background: \${bgStyle}; color: \${textStyle};">

            <span class="status-dot-inner" style="background: \${st.color};"></span>

            \${st.label}

          </span>

        </div>

      </div>

      \${controls}

    \`;

    listEl.appendChild(card);

  });

}

 

// Find the first occurrence on/after a given date (searches up to ~2 years out).

function nextOccurrenceFrom(task, fromStr) {

  if (!task.repeat || task.repeat.freq === 'none') {

    return dayDiff(task.dueDate, fromStr) <= 0 ? task.dueDate : task.dueDate;

  }

  let cursor = parseYMD(fromStr);

  // If the series starts in the future, begin the search there.

  if (dayDiff(fromStr, task.dueDate) > 0) cursor = parseYMD(task.dueDate);

  for (let i = 0; i < 800; i++) {

    const ds = toYMD(cursor);

    if (occursOn(task, ds)) return ds;

    cursor.setDate(cursor.getDate() + 1);

  }

  return null;

}

 

// Client-side status matching the server logic, for an arbitrary occurrence date.

function statusForDate(dateStr, timeStr) {

  const now = new Date();

  const [y, m, d] = dateStr.split('-').map(Number);

  const timePart = (timeStr && timeStr.trim()) ? timeStr : '23:59:59';

  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);

  const taskDate = new Date(y, m - 1, d, hh, mm, ss);

  const diffMs = taskDate - now;

  const diffHours = diffMs / 3600000;

  if (diffMs < 0) return { color: '#ef4444', label: 'Overdue' };

  if (diffHours <= 24) return { color: '#eab308', label: 'Due Soon' };

  return { color: '#22c55e', label: 'Upcoming' };

}

 

function renderCalendar() {

  document.getElementById('calMonthLabel').textContent = MONTHS[viewMonth] + ' ' + viewYear;

  const grid = document.getElementById('calendarGrid');

  grid.innerHTML = '';

 

  DOW.forEach(d => {

    const el = document.createElement('div');

    el.className = 'cal-dow';

    el.textContent = d;

    grid.appendChild(el);

  });

 

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

 

  // Compute which days in this month have at least one occurrence.

  const occDays = new Set();

  for (let day = 1; day <= daysInMonth; day++) {

    const ds = viewYear + '-' + String(viewMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');

    if (occurrencesOn(ds).length > 0) occDays.add(ds);

  }

 

  for (let i = 0; i < firstDay; i++) {

    const el = document.createElement('div');

    el.className = 'cal-cell empty';

    grid.appendChild(el);

  }

 

  for (let day = 1; day <= daysInMonth; day++) {

    const el = document.createElement('div');

    el.className = 'cal-cell';

    el.textContent = day;

 

    const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();

    if (isToday) el.classList.add('today');

 

    const dateStr = viewYear + '-' + String(viewMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');

    if (occDays.has(dateStr)) {

      const dot = document.createElement('span');

      dot.className = 'cal-dot';

      el.appendChild(dot);

    }

 

    if (dateStr === selectedDay) el.classList.add('selected');

 

    el.style.cursor = 'pointer';

    el.addEventListener('click', () => {

      // Toggle: clicking the active day clears the filter

      selectedDay = (selectedDay === dateStr) ? null : dateStr;

      renderTasks();

      renderCalendar();

    });

 

    grid.appendChild(el);

  }

}

 

document.getElementById('clearFilter').addEventListener('click', () => {

  selectedDay = null;

  renderTasks();

  renderCalendar();

});

 

document.getElementById('prevMonth').addEventListener('click', () => {

  viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }

  renderCalendar();

});

document.getElementById('nextMonth').addEventListener('click', () => {

  viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }

  renderCalendar();

});

 

document.getElementById('taskForm').addEventListener('submit', async (e) => {

  e.preventDefault();

  const payload = {

    title: document.getElementById('title').value,

    description: document.getElementById('description').value,

    dueDate: document.getElementById('dueDate').value,

    dueTime: document.getElementById('dueTime').value,

    repeat: currentRepeat.freq === 'none' ? null : currentRepeat

  };

  await fetch('/api/tasks', {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify(payload)

  });

  e.target.reset();

  setDefaultTime();

  resetRepeat();

  loadTasks();

});

 

async function deleteTask(id, isSeries) {

  if (isSeries && !confirm('Delete the entire repeating series? This removes all its occurrences.')) return;

  await fetch('/api/tasks/' + id, { method: 'DELETE' });

  loadTasks();

}

 

// Skip a single occurrence of a repeating task.

async function skipOccurrence(id, date) {

  await fetch('/api/tasks/' + id + '/skip', {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify({ date })

  });

  loadTasks();

}

 

// ---- Repeat selector + custom modal ----

 

const repeatSelect = document.getElementById('repeatSelect');

const editCustomBtn = document.getElementById('editCustomBtn');

const repeatSummary = document.getElementById('repeatSummary');

 

function resetRepeat() {

  currentRepeat = { freq: 'none', interval: 1, weekdays: [], monthdays: [] };

  repeatSelect.value = 'none';

  editCustomBtn.style.display = 'none';

  repeatSummary.style.display = 'none';

  repeatSummary.textContent = '';

}

 

function refreshRepeatSummary() {

  const txt = describeRepeat(currentRepeat);

  if (txt) {

    repeatSummary.textContent = txt;

    repeatSummary.style.display = 'block';

  } else {

    repeatSummary.style.display = 'none';

  }

}

 

repeatSelect.addEventListener('change', () => {

  const v = repeatSelect.value;

  if (v === 'custom') {

    openCustomModal();

    return;

  }

  if (v === 'none') {

    currentRepeat = { freq: 'none', interval: 1, weekdays: [], monthdays: [] };

    editCustomBtn.style.display = 'none';

  } else {

    // Simple presets: interval 1, no sub-selection (engine falls back to anchor day).

    currentRepeat = { freq: v, interval: 1, weekdays: [], monthdays: [] };

    editCustomBtn.style.display = 'none';

  }

  refreshRepeatSummary();

});

 

editCustomBtn.addEventListener('click', openCustomModal);

 

// --- Modal internals ---

const customModal = document.getElementById('customModal');

const customFreq = document.getElementById('customFreq');

const customInterval = document.getElementById('customInterval');

const customHint = document.getElementById('customHint');

const weekdayGroup = document.getElementById('weekdayGroup');

const monthdayGroup = document.getElementById('monthdayGroup');

const monthdayGrid = document.getElementById('monthdayGrid');

 

// Build the 1..31 month-day grid once.

for (let d = 1; d <= 31; d++) {

  const cell = document.createElement('div');

  cell.className = 'monthday-cell';

  cell.textContent = d;

  cell.dataset.day = d;

  cell.addEventListener('click', () => {

    const day = Number(cell.dataset.day);

    const idx = modalDraft.monthdays.indexOf(day);

    if (idx === -1) modalDraft.monthdays.push(day);

    else modalDraft.monthdays.splice(idx, 1);

    cell.classList.toggle('selected');

  });

  monthdayGrid.appendChild(cell);

}

 

// Weekday rows toggle.

document.querySelectorAll('.weekday-row').forEach(rowEl => {

  rowEl.addEventListener('click', () => {

    const day = Number(rowEl.dataset.day);

    const idx = modalDraft.weekdays.indexOf(day);

    if (idx === -1) modalDraft.weekdays.push(day);

    else modalDraft.weekdays.splice(idx, 1);

    rowEl.classList.toggle('selected');

  });

});

 

function openCustomModal() {

  // Seed the draft from the current rule (or sensible defaults).

  const base = (currentRepeat.freq !== 'none')

    ? currentRepeat

    : { freq: 'weekly', interval: 1, weekdays: [], monthdays: [] };

  modalDraft = {

    freq: base.freq === 'none' ? 'weekly' : base.freq,

    interval: base.interval || 1,

    weekdays: (base.weekdays || []).slice(),

    monthdays: (base.monthdays || []).slice()

  };

 

  customFreq.value = modalDraft.freq;

  customInterval.value = modalDraft.interval;

 

  // Reflect weekday/monthday selections into the UI.

  document.querySelectorAll('.weekday-row').forEach(r => {

    r.classList.toggle('selected', modalDraft.weekdays.includes(Number(r.dataset.day)));

  });

  document.querySelectorAll('.monthday-cell').forEach(c => {

    c.classList.toggle('selected', modalDraft.monthdays.includes(Number(c.dataset.day)));

  });

 

  syncModalSections();

  customModal.style.display = 'flex';

}

 

function closeCustomModal() {

  customModal.style.display = 'none';

  // If the user cancels and no rule was ever set, revert the dropdown.

  if (currentRepeat.freq === 'none') repeatSelect.value = 'none';

}

 

function syncModalSections() {

  const f = customFreq.value;

  weekdayGroup.style.display = (f === 'weekly') ? 'block' : 'none';

  monthdayGroup.style.display = (f === 'monthly') ? 'block' : 'none';

 

  const n = Math.max(1, parseInt(customInterval.value) || 1);

  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[f];

  customHint.textContent = 'Event will occur every ' + (n === 1 ? unit : n + ' ' + unit + 's') + '.';

}

 

customFreq.addEventListener('change', () => { modalDraft.freq = customFreq.value; syncModalSections(); });

customInterval.addEventListener('input', () => {

  let n = parseInt(customInterval.value) || 1;

  if (n < 1) n = 1; if (n > 999) n = 999;

  modalDraft.interval = n;

  syncModalSections();

});

document.getElementById('intervalMinus').addEventListener('click', () => {

  let n = Math.max(1, (parseInt(customInterval.value) || 1) - 1);

  customInterval.value = n; modalDraft.interval = n; syncModalSections();

});

document.getElementById('intervalPlus').addEventListener('click', () => {

  let n = Math.min(999, (parseInt(customInterval.value) || 1) + 1);

  customInterval.value = n; modalDraft.interval = n; syncModalSections();

});

 

document.getElementById('customCancel').addEventListener('click', closeCustomModal);

customModal.addEventListener('click', (e) => { if (e.target === customModal) closeCustomModal(); });

 

document.getElementById('customConfirm').addEventListener('click', () => {

  // Commit the draft into the active rule.

  currentRepeat = {

    freq: modalDraft.freq,

    interval: Math.max(1, modalDraft.interval || 1),

    weekdays: modalDraft.freq === 'weekly' ? modalDraft.weekdays.slice() : [],

    monthdays: modalDraft.freq === 'monthly' ? modalDraft.monthdays.slice() : []

  };

  // Reflect in the dropdown as a custom selection.

  repeatSelect.value = 'custom';

  editCustomBtn.style.display = 'block';

  refreshRepeatSummary();

  customModal.style.display = 'none';

});

 

// Default the time picker to 6:00 PM rather than the current time

function setDefaultTime() {

  document.getElementById('dueTime').value = '18:00';

}

setDefaultTime();

 

loadTasks();

</script>

</body>

</html>

`);

});

 

// Initialize database and start listening

initDb().then(() => {

  app.listen(PORT, () => {

    console.log(`Server running on port ${PORT}`);

  });

});