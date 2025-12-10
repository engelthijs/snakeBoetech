const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const finalScoreElement = document.getElementById('final-score');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const restartBtn = document.getElementById('restart-btn');

// Resizing game as requested
const GRID_SIZE = 30;
const PROPOSED_WIDTH = 600; // Smaller screen as requested
// Snap to grid
const CANVAS_WIDTH = Math.floor(PROPOSED_WIDTH / GRID_SIZE) * GRID_SIZE;
const CANVAS_HEIGHT = CANVAS_WIDTH;
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

const TILE_COUNT = CANVAS_WIDTH / GRID_SIZE;

let score = 0;
let gameSpeed = 100; // ms per frame
let lastTime = 0;
let gameRunning = false;
let gameLoopId;

let snake = [];
let velocity = { x: 0, y: 0 };
let nextVelocity = { x: 0, y: 0 }; // Buffer input to prevent self-collision via quick turns
let food = { x: 5, y: 5 };

// --- Asset Processing Section ---
const cowImages = [
    'cow_1.png', 'cow_2.png', 'cow_3.png',
    'cow_4.png', 'cow_5.png', 'cow_6.png'
];

function processTransparency(imgSrc, canvasId) {
    const img = new Image();
    img.src = imgSrc;
    img.onload = () => {
        const c = document.getElementById(canvasId);
        if (!c) return;
        const cx = c.getContext('2d');
        c.width = 400; // High res for background
        c.height = 400; // Assume square generation

        // Draw image
        cx.drawImage(img, 0, 0, c.width, c.height);

        // Get data
        const imageData = cx.getImageData(0, 0, c.width, c.height);
        const data = imageData.data;

        // Green Screen Removal (Chroma Key)
        // Target Green: ~ (0, 255, 0)
        // Adjust threshold as needed
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // If Green is dominant and bright
            if (g > 100 && g > r * 1.4 && g > b * 1.4) {
                data[i + 3] = 0; // Set Alpha to 0
            }
        }

        cx.putImageData(imageData, 0, 0);
    };
}

// Initialize Background Cows
cowImages.forEach((src, idx) => {
    processTransparency(src, `cow-${idx + 1}`);
});
// --------------------------------

// --- Multiplayer Logic ---
const socket = io();

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const roomInput = document.getElementById('room-code-input');
const roomCodeDisplay = document.getElementById('room-code-display');
const gameCodeSpan = document.getElementById('game-code');
const errorMsg = document.getElementById('error-msg');
const waitingScreen = document.getElementById('waiting-screen');
const winnerDisplay = document.getElementById('winner-display');
const scoreP1 = document.getElementById('score-p1');
const scoreP2 = document.getElementById('score-p2');

let roomId = null;
let playerId = null;
let playerRole = null;
let currentGameState = null;

// --- Cow Selection Logic ---
let selectedCow = 0;
const cowOptions = document.querySelectorAll('.cow-option');

cowOptions.forEach(opt => {
    opt.addEventListener('click', () => {
        // UI Update
        cowOptions.forEach(c => c.classList.remove('selected'));
        opt.classList.add('selected');
        selectedCow = parseInt(opt.getAttribute('data-cow'));
    });
});

// Lobby Events
createBtn.addEventListener('click', () => {
    socket.emit('createRoom', selectedCow);
});

joinBtn.addEventListener('click', () => {
    const code = roomInput.value.trim().toUpperCase();
    if (code) {
        socket.emit('joinRoom', { roomId: code, cowId: selectedCow });
    } else {
        showError('Please enter a room code');
    }
});

restartBtn.addEventListener('click', () => {
    location.reload();
});

// ... Socket Events kept same ...

// Rendering Updates
// Preload the "Head" images for the game
const snakeHeadImages = [
    new Image(), new Image(), new Image(), new Image()
];
snakeHeadImages[0].src = 'cow_1.png';
snakeHeadImages[1].src = 'cow_2.png';
snakeHeadImages[2].src = 'cow_3.png';
snakeHeadImages[3].src = 'cow_4.png';

// Cow Colors Mapping (Body colors matching the images roughly)
const cowColors = [
    { base: '#f0f0f0', spot: '#1a1a1a' }, // Cow 1: Black/White
    { base: '#e69b59', spot: '#783812' }, // Cow 2: Highland (Orange/Brown)
    { base: '#f5f5dc', spot: '#8b4513' }, // Cow 3: Beige/Brown
    { base: '#d3d3d3', spot: '#555555' }  // Cow 4: Grey Tech
];

function drawSnake(player) {
    const isP1 = player.color === 'p1';
    const cowId = player.cowId || 0;
    const colors = cowColors[cowId] || cowColors[0];

    player.body.forEach((segment, index) => {
        const x = segment.x * GRID_SIZE;
        const y = segment.y * GRID_SIZE;

        if (index === 0) {
            // --- HEAD ROTATION LOGIC ---
            // Calculate angle based on next segment (neck)
            let angle = 0;
            if (player.body.length > 1) {
                const neck = player.body[1];
                const dx = segment.x - neck.x;
                const dy = segment.y - neck.y;

                // Normal movement
                if (dx === 1) angle = 0;             // Right
                else if (dx === -1) angle = Math.PI; // Left
                else if (dy === 1) angle = Math.PI / 2; // Down
                else if (dy === -1) angle = -Math.PI / 2; // Up
            }

            // Draw Head with Rotation
            ctx.save();
            ctx.translate(x + GRID_SIZE / 2, y + GRID_SIZE / 2);
            ctx.rotate(angle);

            // Shadow for depth
            ctx.shadowBlur = 15;
            ctx.shadowColor = 'rgba(0,0,0,0.5)';

            const img = snakeHeadImages[cowId];
            // Draw centered
            // slightly larger (1.5x) to look like a character head
            const headSize = GRID_SIZE * 1.5;
            ctx.drawImage(img, -headSize / 2, -headSize / 2, headSize, headSize);

            ctx.restore();

            // Player Indicator (Floating above, non-rotated)
            ctx.fillStyle = isP1 ? '#ff0055' : '#00ff88';
            ctx.font = 'bold 14px Nunito';
            ctx.shadowColor = 'black';
            ctx.shadowBlur = 4;
            ctx.fillText(isP1 ? "P1" : "P2", x + 5, y - 10);
            ctx.shadowBlur = 0;

        } else {
            // --- BODY 3D SHADER ---
            // Simple checkerboard for pattern, but with gradient
            const isSpot = (segment.x + segment.y) % 2 === 0;

            const cx = x + GRID_SIZE / 2;
            const cy = y + GRID_SIZE / 2;
            const rad = GRID_SIZE / 2; // Circular segments for smoothness

            const grad = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, rad);
            if (isSpot) {
                grad.addColorStop(0, colors.spot); // Highlight
                grad.addColorStop(1, '#000000'); // Darker base
            } else {
                grad.addColorStop(0, colors.base);
                grad.addColorStop(1, '#999999');
            }

            ctx.beginPath();
            ctx.fillStyle = grad;
            ctx.arc(cx, cy, rad * 1.1, 0, Math.PI * 2); // Circles overlap to form a tube (seamless)
            ctx.fill();

            // Shine/Gloss
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.beginPath();
            ctx.arc(cx - 6, cy - 6, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

// Socket Events
socket.on('roomCreated', (id) => {
    // Room created, but we wait for 'joinedRoom' to confirm entry for consistency
    roomId = id;
});

socket.on('joinedRoom', (data) => {
    roomId = data.roomId;
    playerId = data.playerId;
    playerRole = data.role; // 'p1' or 'p2'

    // Hide Lobby Logic
    lobbyScreen.classList.add('hidden');

    // Show Waiting Screen Logic
    if (playerRole === 'p1') {
        waitingScreen.classList.remove('hidden');
        gameCodeSpan.textContent = roomId;
    } else {
        // Player 2 joined, might move to waiting state briefly or start immediately
        waitingScreen.classList.remove('hidden');
        waitingScreen.querySelector('h2').textContent = "Connecting...";
        gameCodeSpan.parentElement.classList.add('hidden');
    }
});

socket.on('playerJoined', (data) => {
    if (data.playerCount === 2) {
        // Ready to start
        waitingScreen.classList.add('hidden');
        roomCodeDisplay?.classList.add('hidden');
        // Game starts automatically from server
    }
});

socket.on('gameStart', () => {
    lobbyScreen.classList.add('hidden');
    waitingScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    gameRunning = true;
});

socket.on('gameState', (state) => {
    currentGameState = state;
    requestAnimationFrame(drawGame);
    updateScores(state.players);
});

socket.on('playerDied', (data) => {
    // You died or they died, handled by updateScores mostly, but we can animate/sound
});

socket.on('playerLeft', () => {
    showError('Opponent disconnected. Refreshing...');
    setTimeout(() => location.reload(), 2000);
});

socket.on('error', (msg) => {
    showError(msg);
});

function showError(msg) {
    errorMsg.textContent = msg;
    setTimeout(() => errorMsg.textContent = '', 3000);
}

function showLobbyWait(code) {
    createBtn.parentElement.querySelector('.join-group').classList.add('hidden');
    createBtn.classList.add('hidden');
    document.querySelector('.separator-text').classList.add('hidden');

    roomCodeDisplay.classList.remove('hidden');
    gameCodeSpan.textContent = code;
}

function updateScores(players) {
    const p1 = Object.values(players).find(p => p.color === 'p1');
    const p2 = Object.values(players).find(p => p.color === 'p2');

    if (p1) scoreP1.textContent = p1.score;
    if (p2) scoreP2.textContent = p2.score;
}

// Input Handling
document.addEventListener('keydown', (e) => {
    if (!gameRunning || !roomId) return;

    let velX = 0;
    let velY = 0;

    switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            velX = 0; velY = -1;
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            velX = 0; velY = 1;
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            velX = -1; velY = 0;
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
            velX = 1; velY = 0;
            break;
        default:
            return;
    }

    socket.emit('playerInput', { roomId, velX, velY });
});

// Drawing
function drawGame() {
    if (!currentGameState) return;

    // Clear background (Transparent to let CSS background show)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Subtle Tech Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; // Very faint white
    ctx.lineWidth = 1;
    // Optional: Use dots instead of lines for a cleaner tech look?
    // Let's stick to lines but make them barely visible glass lines.
    for (let i = 0; i < TILE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(i * GRID_SIZE, 0);
        ctx.lineTo(i * GRID_SIZE, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * GRID_SIZE);
        ctx.lineTo(canvas.width, i * GRID_SIZE);
        ctx.stroke();
    }

    // Players
    Object.values(currentGameState.players).forEach(player => {
        drawSnake(player);
    });

    // Food
    const food = currentGameState.food;
    drawFood(food);
}

function drawSnake(player) {
    const isP1 = player.color === 'p1';

    // Cow Settings
    const baseColor = '#ffffff'; // White base for both (ish)
    const spotColor = isP1 ? '#000000' : '#8B4513'; // Black vs SaddleBrown
    const hornColor = '#d2b48c'; // Tan

    player.body.forEach((segment, index) => {
        // Draw Base Body (Rounded rect for softness)
        ctx.fillStyle = baseColor;
        // Introduce simple "random" spots based on position hash
        // We use position so the spots move WITH the snake segment
        const posHash = (segment.x * 7 + segment.y * 13) % 10;

        ctx.beginPath();
        ctx.roundRect(segment.x * GRID_SIZE, segment.y * GRID_SIZE, GRID_SIZE, GRID_SIZE, 8);
        ctx.fill();

        // Draw Cow Spots
        ctx.fillStyle = spotColor;
        if (posHash % 3 === 0) {
            // Big Spot
            ctx.beginPath();
            ctx.ellipse(
                segment.x * GRID_SIZE + GRID_SIZE / 2,
                segment.y * GRID_SIZE + GRID_SIZE / 2,
                10, 8, Math.PI / 4, 0, 2 * Math.PI
            );
            ctx.fill();
        } else if (posHash % 2 === 0) {
            // Corner Spot
            ctx.beginPath();
            ctx.arc(segment.x * GRID_SIZE + 5, segment.y * GRID_SIZE + 5, 8, 0, Math.PI * 2);
            ctx.fill();
        }

        // Border (Subtle)
        ctx.strokeStyle = isP1 ? '#333' : '#5a3a22';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Head Logic (Face)
        if (index === 0) {
            // Snout / Nose
            ctx.fillStyle = '#ffc0cb'; // Pink
            ctx.beginPath();
            ctx.roundRect(segment.x * GRID_SIZE + 4, segment.y * GRID_SIZE + 15, 22, 12, 5);
            ctx.fill();

            // Eyes
            ctx.fillStyle = 'black';
            ctx.beginPath();
            ctx.arc(segment.x * GRID_SIZE + 8, segment.y * GRID_SIZE + 10, 3, 0, Math.PI * 2); // Left
            ctx.arc(segment.x * GRID_SIZE + 22, segment.y * GRID_SIZE + 10, 3, 0, Math.PI * 2); // Right
            ctx.fill();

            // Horns
            ctx.fillStyle = hornColor;
            ctx.beginPath();
            ctx.moveTo(segment.x * GRID_SIZE + 4, segment.y * GRID_SIZE + 5);
            ctx.lineTo(segment.x * GRID_SIZE - 2, segment.y * GRID_SIZE - 2);
            ctx.lineTo(segment.x * GRID_SIZE + 8, segment.y * GRID_SIZE + 5);
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(segment.x * GRID_SIZE + 26, segment.y * GRID_SIZE + 5);
            ctx.lineTo(segment.x * GRID_SIZE + 32, segment.y * GRID_SIZE - 2);
            ctx.lineTo(segment.x * GRID_SIZE + 22, segment.y * GRID_SIZE + 5);
            ctx.fill();


            // Player Indicator Tag
            ctx.fillStyle = isP1 ? '#ff0055' : '#00ff88';
            ctx.font = 'bold 12px Nunito';
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 2;
            ctx.strokeText(isP1 ? "P1" : "P2", segment.x * GRID_SIZE, segment.y * GRID_SIZE - 8);
            ctx.fillText(isP1 ? "P1" : "P2", segment.x * GRID_SIZE, segment.y * GRID_SIZE - 8);
        }
    });
}

function drawFood(food) {
    const x = food.x * GRID_SIZE;
    const y = food.y * GRID_SIZE;
    const size = GRID_SIZE;

    // Gift Box Base
    ctx.fillStyle = '#ff0055';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff4d88'; // glow
    ctx.fillRect(x + 2, y + 2, size - 4, size - 4);

    // Ribbon
    ctx.fillStyle = '#ffd700'; // Gold
    ctx.shadowBlur = 0;

    // Vertical Ribbon
    ctx.fillRect(x + size / 2 - 2, y + 2, 4, size - 4);
    // Horizontal Ribbon
    ctx.fillRect(x + 2, y + size / 2 - 2, size - 4, 4);

    // Bow
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2 - 5, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0; // Reset
}

// Initial Canvas Clear
ctx.fillStyle = '#f8f9fa';
ctx.fillRect(0, 0, canvas.width, canvas.height);
