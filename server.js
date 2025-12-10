const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, '/')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Game State
const rooms = {};
const GRID_SIZE = 30;
const CANVAS_WIDTH = 600; // As requested
const TILE_COUNT = CANVAS_WIDTH / GRID_SIZE;
const FRAME_RATE = 8; // 8 FPS for "BoeTech Heavy" premium feel

function createGameRoom(roomId) {
    return {
        roomId,
        players: {}, // { socketId: { x, y, velX, velY, score, color, body: [] } }
        food: spawnFood(),
        gameRunning: false,
        timer: null
    };
}

function spawnFood() {
    return {
        x: Math.floor(Math.random() * TILE_COUNT),
        y: Math.floor(Math.random() * TILE_COUNT)
    };
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', () => {
        const roomId = Math.random().toString(36).substring(7).toUpperCase();
        rooms[roomId] = createGameRoom(roomId);

        // Auto-join creator as Player 1
        const room = rooms[roomId];
        room.players[socket.id] = {
            id: socket.id,
            x: 5,
            y: 10,
            velX: 0,
            velY: 0,
            score: 0,
            color: 'p1',
            body: [
                { x: 5, y: 10 },
                { x: 4, y: 10 },
                { x: 3, y: 10 }
            ]
        };

        socket.join(roomId);
        socket.emit('roomCreated', roomId);
        socket.emit('joinedRoom', { roomId, playerId: socket.id, role: 'p1' });

        // Send initial state so they can render
        socket.emit('gameState', {
            players: room.players,
            food: room.food
        });
    });

    socket.on('joinRoom', (data) => {
        // Handle both old string format (if cached) and new object format
        const roomId = typeof data === 'string' ? data : data.roomId;
        const cowId = typeof data === 'object' ? data.cowId : 0;

        const room = rooms[roomId];
        if (!room) {
            socket.emit('error', 'Room not found');
            return;
        }

        const playerCount = Object.keys(room.players).length;
        if (playerCount >= 2) {
            socket.emit('error', 'Room is full');
            return;
        }

        // Initialize player
        room.players[socket.id] = {
            id: socket.id,
            cowId: cowId || 0, // Store Selected Cow
            x: playerCount === 0 ? 5 : 15, // Different starting positions
            y: 10,
            velX: 0,
            velY: 0,
            score: 0,
            color: playerCount === 0 ? 'p1' : 'p2',
            body: [
                { x: playerCount === 0 ? 5 : 15, y: 10 },
                { x: playerCount === 0 ? 4 : 14, y: 10 },
                { x: playerCount === 0 ? 3 : 13, y: 10 }
            ]
        };

        socket.join(roomId);
        socket.emit('joinedRoom', { roomId, playerId: socket.id, role: playerCount === 0 ? 'p1' : 'p2' });

        io.to(roomId).emit('playerJoined', { playerCount: playerCount + 1 });

        // Start game if 2 players
        if (Object.keys(room.players).length === 2 && !room.gameRunning) {
            startGame(roomId);
        }
    });

    socket.on('playerInput', ({ roomId, velX, velY }) => {
        const room = rooms[roomId];
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            // Prevent 180 turn
            if (player.velX === -velX && player.velY === -velY && (velX !== 0 || velY !== 0)) return;
            player.velX = velX;
            player.velY = velY;
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clean up rooms... simplistic approach for now
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                io.to(roomId).emit('playerLeft');
                if (Object.keys(rooms[roomId].players).length === 0) {
                    clearInterval(rooms[roomId].timer);
                    delete rooms[roomId];
                }
            }
        }
    });
});

function startGame(roomId) {
    const room = rooms[roomId];
    room.gameRunning = true;
    io.to(roomId).emit('gameStart');

    room.timer = setInterval(() => {
        if (!room.gameRunning) return;
        updateGame(room);
        io.to(roomId).emit('gameState', {
            players: room.players,
            food: room.food
        });
    }, 1000 / FRAME_RATE);
}

function updateGame(room) {
    const players = Object.values(room.players);
    if (players.length === 0) return;

    players.forEach(player => {
        if (player.velX === 0 && player.velY === 0) return;

        player.x += player.velX;
        player.y += player.velY;

        // Collision with walls
        if (player.x < 0 || player.x >= TILE_COUNT || player.y < 0 || player.y >= TILE_COUNT) {
            resetPlayer(player); // Simple respawn or game over? Let's say respawn but lose score
            player.score = 0;
        }

        // Move Body
        player.body.unshift({ x: player.x, y: player.y });

        // Eating Food
        if (player.x === room.food.x && player.y === room.food.y) {
            player.score += 10;
            room.food = spawnFood();
        } else {
            player.body.pop();
        }

        // Self Collision & Other Player Collision
        // ... (Simplified for this sprint: Check body collisions)
    });

    // Check collisions AFTER movement
    players.forEach(p1 => {
        players.forEach(p2 => {
            // Check if p1 head hits p2 body
            if (p2.body.some((segment, idx) => {
                // Ignore p1's own head (index 0) if p1 === p2
                if (p1 === p2 && idx === 0) return false;
                return segment.x === p1.x && segment.y === p1.y;
            })) {
                io.to(room.roomId).emit('playerDied', { playerId: p1.id });
                resetPlayer(p1);
                p1.score = 0;
            }
        });
    });
}

function resetPlayer(player) {
    player.x = Math.floor(Math.random() * TILE_COUNT);
    player.y = Math.floor(Math.random() * TILE_COUNT);
    player.velX = 0;
    player.velY = 0;
    player.body = [
        { x: player.x, y: player.y },
        { x: player.x, y: player.y + 1 },
        { x: player.x, y: player.y + 2 }
    ];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
