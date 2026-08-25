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

      due_time VARCHAR(10)

    );

  `;

  try {

    await pool.query(query);

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

      status: getTaskStatus(row.due_date, row.due_time)

    }));

    res.json(enrichedTasks);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Database query failed' });

  }

});

 

app.post('/api/tasks', async (req, res) => {

  const { title, description, dueDate, dueTime } = req.body;

  if (!title || !dueDate) {

    return res.status(400).json({ error: 'Title and Due Date are required.' });

  }

 

  try {

    const result = await pool.query(

      'INSERT INTO tasks (title, description, due_date, due_time) VALUES ($1, $2, $3, $4) RETURNING *',

      [title, description || '', dueDate, dueTime || '']

    );

    res.status(201).json(result.rows[0]);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: 'Failed to insert task' });

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

 

<script>

let tasks = [];

let selectedDay = null; // YYYY-MM-DD when a calendar day filter is active

const today = new Date();

let viewYear = today.getFullYear();

let viewMonth = today.getMonth();

 

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

 

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

 

function renderGreeting() {

  const eyebrow = document.getElementById('greetingEyebrow');

  const title = document.getElementById('greetingTitle');

  const body = document.getElementById('greetingBody');

 

  const bucket = timeBucket(new Date().getHours());

  eyebrow.textContent = pick(GREETINGS[bucket]);

  title.textContent = 'Welcome Shaan';

 

  const dueToday = tasks

    .filter(t => t.dueDate === todayStr())

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

 

  const visible = selectedDay ? tasks.filter(t => t.dueDate === selectedDay) : tasks;

 

  document.getElementById('taskCount').textContent = visible.length;

 

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

 

  if (visible.length === 0) {

    listEl.innerHTML = '<div class="card empty-state">' +

      (selectedDay ? 'No tasks on this day.' : 'No tasks scheduled yet.') + '</div>';

    return;

  }

 

  visible.forEach(task => {

    const parts = task.dueDate.split('-');

    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);

    const formattedDate = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

 

    let bgStyle = 'rgba(34, 197, 94, 0.14)';

    let textStyle = '#86efac';

    if (task.status.color === '#ef4444') {

      bgStyle = 'rgba(239, 68, 68, 0.14)'; textStyle = '#fca5a5';

    } else if (task.status.color === '#eab308') {

      bgStyle = 'rgba(234, 179, 8, 0.16)'; textStyle = '#fde047';

    }

 

    const card = document.createElement('div');

    card.className = 'task-card';

    card.innerHTML = \`

      <div class="task-content">

        <h3>\${task.title}</h3>

        \${task.description ? \`<p>\${task.description}</p>\` : ''}

        <div class="task-meta">

          <span>📅 \${formattedDate}</span>

          \${task.dueTime ? \`<span>⏰ \${task.dueTime}</span>\` : ''}

          <span class="status-badge" style="background: \${bgStyle}; color: \${textStyle};">

            <span class="status-dot-inner" style="background: \${task.status.color};"></span>

            \${task.status.label}

          </span>

        </div>

      </div>

      <button class="delete-btn" onclick="deleteTask(\${task.id})">Remove</button>

    \`;

    listEl.appendChild(card);

  });

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

 

  // Set of dates (YYYY-MM-DD) that have tasks

  const taskDays = new Set(tasks.map(t => t.dueDate));

 

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

    if (taskDays.has(dateStr)) {

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

    dueTime: document.getElementById('dueTime').value

  };

  await fetch('/api/tasks', {

    method: 'POST',

    headers: { 'Content-Type': 'application/json' },

    body: JSON.stringify(payload)

  });

  e.target.reset();

  setDefaultTime();

  loadTasks();

});

 

async function deleteTask(id) {

  await fetch('/api/tasks/' + id, { method: 'DELETE' });

  loadTasks();

}

 

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