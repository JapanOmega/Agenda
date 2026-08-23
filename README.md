# 📅 Node.js Agenda Web App

A lightweight task agenda application built with Node.js and Express. Features automated color-coded status tracking based on completion due dates.

## Features
- **Task Logging:** Input task name, optional description, completion date, and optional time.
- **Dynamic Status Indicators:**
  - 🟢 **Green:** Upcoming task (due in > 24 hours).
  - 🟡 **Yellow:** Due soon (due within 24 hours).
  - 🔴 **Red:** Overdue task.
- **REST API:** Express endpoints for fetching, creating, and removing tasks.

## Quick Start
1. Clone repository:
   ```bash
   git clone [https://github.com/JapanOmega/Agenda.git](https://github.com/JapanOmega/Agenda.git)
   cd Agenda
