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
  
  // Format date to YYYY-MM-DD string
  const formattedDate = new Date(dueDateStr).toISOString().split('T')[0];
  const timePart = dueTimeStr ? dueTimeStr : '23:59:59';
  const taskDate = new Date(`${formattedDate}T${timePart}`);

  if (isNaN(taskDate.getTime())) {
    return { color: 'gray', label: 'Invalid Date' };
  }

  const diffMs = taskDate - now;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) {
    return { color: '#ef4444', label: 'Overdue' }; // Red
  } else if (diffHours <= 24) {
    return { color: '#eab308', label: 'Due Soon' }; // Yellow
  } else {
    return { color: '#22c55e', label: 'Upcoming' }; // Green
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

// Single Page Application Frontend with Modern Apple-Style UI
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
      --bg: #f5f5f7;
      --card-bg: rgba(255, 255, 255, 0.85);
      --text-main: #1d1d1f;
      --text-muted: #86868b;
      --border: rgba(0, 0, 0, 0.08);
      --accent: #0071e3;
      --accent-hover: #0077ed;
      --shadow: 0 8px 30px rgba(0, 0, 0, 0.04);
      --radius: 16px;
    }

    * { box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      margin: 0;
      padding: 0;
      display: flex;
      justify-content: center;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }

    /* Container setup with smooth vertical scrolling */
    .app-wrapper {
      width: 100%;
      max-width: 680px;
      padding: 3rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    header {
      text-align: left;
    }

    header h1 {
      font-size: 2.2rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin: 0 0 0.25rem 0;
    }

    header p {
      color: var(--text-muted);
      margin: 0;
      font-size: 1.05rem;
    }

    /* Form Container */
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      box-shadow: var(--shadow);
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    label {
      font-size: 0.825rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    input, textarea {
      font-family: inherit;
      font-size: 1rem;
      padding: 0.85rem 1rem;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text-main);
      outline: none;
      transition: all 0.2s ease;
    }

    input:focus, textarea:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(0, 113, 227, 0.15);
    }

    textarea {
      resize: vertical;
      min-height: 80px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    button.submit-btn {
      background: var(--accent);
      color: #ffffff;
      border: none;
      border-radius: 10px;
      padding: 0.9rem;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: 0.5rem;
    }

    button.submit-btn:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }

    /* Tasks List Section with Scrollable Containment */
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .section-header h2 {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0;
      letter-spacing: -0.01em;
    }

    .task-list {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      max-height: 600px;
      overflow-y: auto;
      padding-right: 4px;
    }

    /* Custom Scrollbar */
    .task-list::-webkit-scrollbar {
      width: 6px;
    }
    .task-list::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.15);
      border-radius: 10px;
    }

    .task-card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      box-shadow: var(--shadow);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .task-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.06);
    }

    .task-main {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 0.65rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .status-dot-inner {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .task-content h3 {
      font-size: 1.1rem;
      font-weight: 600;
      margin: 0 0 0.35rem 0;
      color: var(--text-main);
    }

    .task-content p {
      font-size: 0.925rem;
      color: var(--text-muted);
      margin: 0 0 0.6rem 0;
      line-height: 1.4;
    }

    .task-meta {
      display: flex;
      align-items: center;
      gap: 1rem;
      font-size: 0.825rem;
      color: var(--text-muted);
      font-weight: 500;
    }

    .delete-btn {
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
      border: none;
      border-radius: 8px;
      padding: 0.5rem 0.85rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
    }

    .delete-btn:hover {
      background: rgba(239, 68, 68, 0.18);
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
  </style>
</head>
<body>
  <div class="app-wrapper">
    <header>
      <h1>Agenda</h1>
      <p>Keep track of your schedule and task priorities.</p>
    </header>

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
        <h2>Tasks</h2>
      </div>
      <div id="taskList" class="task-list"></div>
    </section>
  </div>

  <script>
    async function loadTasks() {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();
      const listEl = document.getElementById('taskList');
      listEl.innerHTML = '';

      if (tasks.length === 0) {
        listEl.innerHTML = '<div class="card empty-state">No tasks scheduled yet.</div>';
        return;
      }

      tasks.forEach(task => {
        const parts = task.dueDate.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const formattedDate = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        
        // Status color mapping for pill background and text
        let bgStyle = 'rgba(34, 197, 94, 0.1)';
        let textStyle = '#15803d';
        
        if (task.status.color === '#ef4444') {
          bgStyle = 'rgba(239, 68, 68, 0.1)';
          textStyle = '#b91c1c';
        } else if (task.status.color === '#eab308') {
          bgStyle = 'rgba(234, 179, 8, 0.15)';
          textStyle = '#a16207';
        }

        const card = document.createElement('div');
        card.className = 'task-card';
        card.innerHTML = \`
          <div class="task-main">
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
          </div>
          <button class="delete-btn" onclick="deleteTask(\${task.id})">Remove</button>
        \`;
        listEl.appendChild(card);
      });
    }

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
      loadTasks();
    });

    async function deleteTask(id) {
      await fetch('/api/tasks/' + id, { method: 'DELETE' });
      loadTasks();
    }

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