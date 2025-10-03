const express = require('express')
const cors = require('cors')
const { v4: uuidv4 } = require('uuid')
const { createServer } = require('http')
const { Server } = require('socket.io')
const path = require('path')

const app = express()
const server = createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
})

// In-memory database
const inMemoryDB = {
  users: [],
  tournaments: [],
  players: [],
  rounds: [],
  pairings: []
}

// Simple password hashing (in production, use bcrypt)
const hashPassword = (password) => {
  return Buffer.from(password).toString('base64')
}

// Simple password verification
const verifyPassword = (password, hash) => {
  return hashPassword(password) === hash
}

// Generate JWT-like token (simplified for demo)
const generateToken = (userId) => {
  return Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString('base64')
}

// Verify token
const verifyToken = (token) => {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString())
    return decoded.userId
  } catch {
    return null
  }
}

// Middleware to check authentication
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Access token required' })
  }

  const userId = verifyToken(token)
  if (!userId) {
    return res.status(403).json({ error: 'Invalid token' })
  }

  const user = inMemoryDB.users.find(u => u.id === userId)
  if (!user) {
    return res.status(403).json({ error: 'User not found' })
  }

  req.user = user
  next()
}

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static('dist'))

// Authentication routes
app.post('/api/auth/register', (req, res) => {
  const { firstName, lastName, email, password } = req.body

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' })
  }

  // Check if user already exists
  const existingUser = inMemoryDB.users.find(u => u.email === email)
  if (existingUser) {
    return res.status(400).json({ error: 'User with this email already exists' })
  }

  // Create new user
  const user = {
    id: uuidv4(),
    firstName,
    lastName,
    email,
    password: hashPassword(password),
    createdAt: new Date().toISOString()
  }

  inMemoryDB.users.push(user)

  // Generate token
  const token = generateToken(user.id)

  res.json({
    message: 'User registered successfully',
    token,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    }
  })
})

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  // Find user
  const user = inMemoryDB.users.find(u => u.email === email)
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  // Generate token
  const token = generateToken(user.id)

  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    }
  })
})

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email
    }
  })
})

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id)

  socket.on('joinTournament', (tournamentId) => {
    socket.join(`tournament-${tournamentId}`)
    console.log(`User ${socket.id} joined tournament ${tournamentId}`)
  })

  socket.on('tournamentUpdate', (tournamentId) => {
    socket.to(`tournament-${tournamentId}`).emit('tournamentUpdated', { tournamentId })
  })

  socket.on('roundUpdate', (tournamentId) => {
    socket.to(`tournament-${tournamentId}`).emit('roundUpdated', { tournamentId })
  })

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
  })
})

// API Routes (all protected with authentication)

// Get all tournaments
app.get('/api/tournaments', authenticateToken, (req, res) => {
  const tournaments = inMemoryDB.tournaments.map(tournament => ({
    id: tournament.id,
    name: tournament.name,
    maxRounds: tournament.maxRounds,
    timeControl: tournament.timeControl,
    playerCount: inMemoryDB.players.filter(p => p.tournamentId === tournament.id).length,
    roundCount: inMemoryDB.rounds.filter(r => r.tournamentId === tournament.id).length,
    createdAt: tournament.createdAt
  }))
  res.json(tournaments)
})

// Create tournament
app.post('/api/tournaments', authenticateToken, (req, res) => {
  const { name, maxRounds, timeControl } = req.body
  
  if (!name || !maxRounds || !timeControl) {
    return res.status(400).json({ message: 'Missing required fields' })
  }

  const tournament = {
    id: uuidv4(),
    name,
    maxRounds,
    timeControl,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.tournaments.push(tournament)

  res.json({
    ...tournament,
    players: [],
    rounds: []
  })
})

// Get tournament details
app.get('/api/tournaments/:id', authenticateToken, (req, res) => {
  const { id } = req.params
  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  
  if (!tournament) {
    return res.status(404).json({ message: 'Tournament not found' })
  }

  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Join tournament
app.post('/api/tournaments/:id/join', authenticateToken, (req, res) => {
  const { id } = req.params
  const { name, rating, email } = req.body

  if (!name || !rating) {
    return res.status(400).json({ message: 'Name and rating are required' })
  }

  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  if (!tournament) {
    return res.status(404).json({ message: 'Tournament not found' })
  }

  const player = {
    id: uuidv4(),
    tournamentId: id,
    name,
    rating,
    email,
    score: 0,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.players.push(player)

  // Return updated tournament
  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Add player to tournament
app.post('/api/tournaments/:id/players', authenticateToken, (req, res) => {
  const { id } = req.params
  const { name, rating, email } = req.body

  if (!name || !rating) {
    return res.status(400).json({ message: 'Name and rating are required' })
  }

  const player = {
    id: uuidv4(),
    tournamentId: id,
    name,
    rating,
    email,
    score: 0,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.players.push(player)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Start new round
app.post('/api/tournaments/:id/rounds', authenticateToken, (req, res) => {
  const { id } = req.params
  const { roundNumber, pairings } = req.body

  const round = {
    id: uuidv4(),
    tournamentId: id,
    roundNumber,
    createdAt: new Date().toISOString()
  }

  inMemoryDB.rounds.push(round)

  // Add pairings
  const newPairings = pairings.map(pairing => ({
    id: uuidv4(),
    roundId: round.id,
    white: pairing.white,
    black: pairing.black,
    whiteName: pairing.whiteName,
    blackName: pairing.blackName,
    result: pairing.result,
    createdAt: new Date().toISOString()
  }))

  inMemoryDB.pairings.push(...newPairings)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Update pairing result
app.put('/api/tournaments/:id/pairings/:pairingId', authenticateToken, (req, res) => {
  const { pairingId } = req.params
  const { result } = req.body

  const pairing = inMemoryDB.pairings.find(p => p.id === pairingId)
  if (pairing) {
    pairing.result = result
  }

  // Update player scores
  updatePlayerScores(req.params.id)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === req.params.id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === req.params.id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === req.params.id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Delete player
app.delete('/api/tournaments/:id/players/:playerId', authenticateToken, (req, res) => {
  const { playerId } = req.params
  
  // Remove player from database
  const playerIndex = inMemoryDB.players.findIndex(p => p.id === playerId)
  if (playerIndex !== -1) {
    inMemoryDB.players.splice(playerIndex, 1)
  }

  // Remove all pairings involving this player
  inMemoryDB.pairings = inMemoryDB.pairings.filter(p => 
    p.white !== playerId && p.black !== playerId
  )

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === req.params.id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === req.params.id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === req.params.id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Update player
app.put('/api/tournaments/:id/players/:playerId', authenticateToken, (req, res) => {
  const { playerId } = req.params
  const { name, rating, disabled } = req.body

  const player = inMemoryDB.players.find(p => p.id === playerId)
  if (player) {
    if (name) player.name = name
    if (rating !== undefined) player.rating = rating
    if (disabled !== undefined) player.disabled = disabled
  }

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === req.params.id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === req.params.id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === req.params.id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Delete round
app.delete('/api/tournaments/:id/rounds/:roundId', authenticateToken, (req, res) => {
  const { roundId } = req.params
  
  // Remove round from database
  const roundIndex = inMemoryDB.rounds.findIndex(r => r.id === roundId)
  if (roundIndex !== -1) {
    inMemoryDB.rounds.splice(roundIndex, 1)
  }

  // Remove all pairings for this round
  inMemoryDB.pairings = inMemoryDB.pairings.filter(p => p.roundId !== roundId)

  // Update player scores
  updatePlayerScores(req.params.id)

  // Return updated tournament
  const tournament = inMemoryDB.tournaments.find(t => t.id === req.params.id)
  const players = inMemoryDB.players.filter(p => p.tournamentId === req.params.id)
  const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === req.params.id).map(round => ({
    ...round,
    pairings: inMemoryDB.pairings.filter(p => p.roundId === round.id)
  }))

  res.json({
    ...tournament,
    players,
    rounds
  })
})

// Helper function to update player scores
const updatePlayerScores = (tournamentId) => {
  const players = inMemoryDB.players.filter(p => p.tournamentId === tournamentId)
  
  players.forEach(player => {
    let score = 0
    const rounds = inMemoryDB.rounds.filter(r => r.tournamentId === tournamentId)
    
    rounds.forEach(round => {
      const pairings = inMemoryDB.pairings.filter(p => p.roundId === round.id)
      pairings.forEach(pairing => {
        if (pairing.white === player.id) {
          if (pairing.result === '1-0') score += 1
          else if (pairing.result === '0.5-0.5') score += 0.5
        } else if (pairing.black === player.id) {
          if (pairing.result === '0-1') score += 1
          else if (pairing.result === '0.5-0.5') score += 0.5
        }
      })
    })
    
    player.score = score
  })
}

// Serve React app (only in production)
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

const PORT = process.env.PORT || 5000

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
  console.log(`📱 Frontend should be available at http://localhost:3000`)
  console.log(`🔧 Backend API available at http://localhost:${PORT}`)
})
