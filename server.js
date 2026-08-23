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

// Single Page Application Frontend
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agenda Web App</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f4f9; margin: 0; padding: 2rem; color: #333; }
    .container { max-width: 650px; margin: 0 auto; background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    h1 { margin-top: 0; }
    form { display: grid; gap: 1rem; margin-bottom: 2rem; }
    input, textarea, button { padding: 0.75rem; border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; }
    button { background: #2563eb; color: #fff; border: none; cursor: pointer; font-weight: bold; }
    button:hover { background: #1d4ed8; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .task-card { display: flex; align-items: center; justify-content: space-between; padding: 1rem; border: 1px solid #eee; border-radius: 6px; margin-bottom: 0.75rem; background: #fafafa; }
    .task-info { display: flex; align-items: flex-start; gap: 0.75rem; }
    .status-dot { width: 14px; height: 14px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
    .task-details h3 { margin: 0 0 0.25rem 0; font-size: 1.1rem; }
    .task-details p { margin: 0 0 0.5rem 0; color: #666; font-size: 0.9rem; }
    .task-date { font-size: 0.8rem; color: #888; font-weight: bold; }
    .delete-btn { background: transparent; color: #ef4444; border: none; cursor: pointer; font-size: 0.9rem; padding: 0.25rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📅 Agenda</h1>
    
    <form id="taskForm">
      <input type="text" id="title" placeholder="Task Name *" required />
      <textarea id="description" placeholder="Description (Optional)"></textarea>
      <div class="row">
        <div>
          <label style="font-size: 0.8rem; color: #666;">Date *</label>
          <input type="date" id="dueDate" required />
        </div>
        <div>
          <label style="font-size: 0.8rem; color: #666;">Time (Optional)</label>
          <input type="time" id="dueTime" />
        </div>
      </div>
      <button type="submit">Add Task</button>
    </form>

    <h2>Your Tasks</h2>
    <div id="taskList"></div>
  </div>

  <script>
    async function loadTasks() {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();
      const listEl = document.getElementById('taskList');
      listEl.innerHTML = '';

      if (tasks.length === 0) {
        listEl.innerHTML = '<p style="color: #888;">No tasks logged yet.</p>';
        return;
      }

      tasks.forEach(task => {
        const parts = task.dueDate.split('-');
        const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
        const formattedDate = dateObj.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        
        const card = document.createElement('div');
        card.className = 'task-card';
        card.innerHTML = \`
          <div class="task-info">
            <div class="status-dot" style="background-color: \${task.status.color}" title="\${task.status.label}"></div>
            <div class="task-details">
              <h3>\${task.title}</h3>
              \${task.description ? \`<p>\${task.description}</p>\` : ''}
              <div class="task-date">📅 \${formattedDate} \${task.dueTime ? '⏰ ' + task.dueTime : ''}</div>
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