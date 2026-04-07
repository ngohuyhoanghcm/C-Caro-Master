import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Track rooms and players
  const rooms = new Map<string, { players: string[], board: (string | null)[] }>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("joinRoom", (roomID: string) => {
      let room = rooms.get(roomID);
      
      if (!room) {
        room = { players: [socket.id], board: Array(15 * 15).fill(null) };
        rooms.set(roomID, room);
        socket.join(roomID);
        socket.emit("playerAssigned", { symbol: "X", roomID });
        console.log(`User ${socket.id} created room ${roomID} as X`);
      } else if (room.players.length === 1) {
        room.players.push(socket.id);
        socket.join(roomID);
        socket.emit("playerAssigned", { symbol: "O", roomID });
        io.to(roomID).emit("gameStarted", { players: room.players });
        console.log(`User ${socket.id} joined room ${roomID} as O`);
      } else {
        socket.emit("error", "Phòng đã đầy!");
      }
    });

    socket.on("makeMove", ({ roomID, index, symbol }: { roomID: string, index: number, symbol: string }) => {
      const room = rooms.get(roomID);
      if (room && room.players.includes(socket.id)) {
        room.board[index] = symbol;
        // Broadcast move to everyone in the room EXCEPT the sender
        socket.to(roomID).emit("opponentMove", { index, symbol });
      }
    });

    socket.on("resetGame", (roomID: string) => {
      const room = rooms.get(roomID);
      if (room) {
        // Instead of immediate reset, we notify the other player
        socket.to(roomID).emit("rematchRequested", { from: socket.id });
      }
    });

    socket.on("acceptRematch", (roomID: string) => {
      const room = rooms.get(roomID);
      if (room) {
        room.board = Array(15 * 15).fill(null);
        io.to(roomID).emit("gameReset");
      }
    });

    socket.on("declineRematch", (roomID: string) => {
      socket.to(roomID).emit("rematchDeclined");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Clean up rooms
      rooms.forEach((room, roomID) => {
        if (room.players.includes(socket.id)) {
          io.to(roomID).emit("opponentDisconnected");
          rooms.delete(roomID);
        }
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
