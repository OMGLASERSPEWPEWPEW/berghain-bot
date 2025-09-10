// File: src/web/server.ts (relative to project root)
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { config } from '../config/defaults';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, '../../public')));

// Main dashboard route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
});

// WebSocket connection handling
io.on('connection', (socket) => {
  const fn = "connection";
  console.log("src/web/server.ts:%s - client connected: %s", fn, socket.id);
  
  socket.on('disconnect', () => {
    console.log("src/web/server.ts:%s - client disconnected: %s", fn, socket.id);
  });
});

// Export io for use by bot
export { io };

// Start server
const PORT = process.env.WEB_PORT || 3001;
server.listen(PORT, () => {
  const fn = "server.listen";
  console.log("src/web/server.ts:%s - Berghain Dashboard running on http://localhost:%d", fn, PORT);
});

// File length: 1,028 characters